//! Bounded, fair webhook delivery: HTTP-attempt permits, per-subscription
//! single-flight, a per-subscriber circuit breaker with a real half-open
//! probe, and a bounded queue with a drain for shutdown.
//!
//! Design (T-13): a failing subscriber must never hold a shared resource while
//! it waits. Permits are taken per HTTP attempt and released before any backoff
//! sleep; deliveries of one subscription run one chain at a time (the later
//! ones wait on that subscription's own lock, not on the shared pool); the
//! number of queued or running deliveries is capped, and an overflow is
//! dead-lettered by the caller instead of blocking intake.
//!
//! The queue is in memory (not a durable outbox): a hard kill loses chains that
//! are mid-retry, exactly as before; a SIGTERM drains them with a timeout.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

/// Concurrent HTTP attempts across all subscribers.
pub const DEFAULT_ATTEMPT_PERMITS: usize = 50;
/// Deliveries that may be queued or running at once.
pub const DEFAULT_QUEUE_CAPACITY: usize = 2000;

/// Consecutive failed ATTEMPTS before a subscriber's breaker opens.
const BREAKER_FAILURE_THRESHOLD: u32 = 5;
/// How long an open breaker stays open before one probe is allowed.
const BREAKER_OPEN_FOR: Duration = Duration::from_secs(300);

/// Marker prefix of the dead-letter text written for deliveries that were
/// deferred (open breaker, per-subscriber backlog, full queue); a recovered
/// subscriber gets exactly these rows replayed.
pub const BREAKER_DEAD_LETTER_PREFIX: &str = "deferred:";

/// Why a delivery did not succeed. Only `Delivery` says anything about the
/// subscriber's health and feeds the breaker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeliveryError {
    /// Dispatcher misconfiguration (for example no signing key).
    Config(String),
    /// The URL failed the SSRF guard.
    Ssrf(String),
    /// Every permitted attempt failed. `status` is the last HTTP status when
    /// the receiver answered (None for a transport error).
    Delivery {
        error: String,
        attempts: u8,
        status: Option<u16>,
    },
    /// The breaker is open (before the first attempt, or it opened mid-chain).
    BreakerOpen { attempts: u8, last_error: String },
    /// Deferred without an attempt for a reason other than the breaker (for
    /// example the subscriber's backlog is full).
    Deferred { reason: String },
}

impl DeliveryError {
    /// Attempts actually made, for the dead-letter record.
    pub fn attempts(&self) -> u8 {
        match self {
            Self::Config(_) | Self::Ssrf(_) | Self::Deferred { .. } => 0,
            Self::Delivery { attempts, .. } | Self::BreakerOpen { attempts, .. } => *attempts,
        }
    }
}

impl std::fmt::Display for DeliveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Config(e) | Self::Ssrf(e) => f.write_str(e),
            Self::Delivery { error, .. } => f.write_str(error),
            Self::Deferred { reason } => write!(f, "{BREAKER_DEAD_LETTER_PREFIX} {reason}"),
            Self::BreakerOpen {
                attempts,
                last_error,
            } => write!(
                f,
                "{BREAKER_DEAD_LETTER_PREFIX} circuit breaker open (attempts={attempts}): {last_error}"
            ),
        }
    }
}

impl DeliveryError {
    /// True when the delivery was held back (not rejected) and should be
    /// dead-lettered with the deferral marker so it is replayed later.
    pub fn is_deferral(&self) -> bool {
        matches!(self, Self::BreakerOpen { .. } | Self::Deferred { .. })
    }

    /// A permanent receiver rejection: a 4xx other than 408/429. Retrying the
    /// same payload will not help.
    pub fn is_permanent_rejection(&self) -> bool {
        matches!(
            self,
            Self::Delivery { status: Some(s), .. }
                if (400..500).contains(s) && *s != 408 && *s != 429
        )
    }
}

impl std::error::Error for DeliveryError {}

#[derive(Default)]
struct BreakerEntry {
    consecutive_failures: u32,
    open_until: Option<Instant>,
    /// A probe delivery is in flight after the open window expired.
    probing: bool,
}

/// What a new delivery chain may do for a subscriber.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admit {
    /// Closed: the full retry envelope.
    Closed,
    /// Open: do not send.
    Open,
    /// Half-open: exactly one probe attempt.
    Probe,
}

/// Per-subscriber circuit breaker over consecutive failed attempts.
#[derive(Default)]
pub struct SubscriberBreaker {
    inner: Mutex<HashMap<Uuid, BreakerEntry>>,
}

impl SubscriberBreaker {
    /// Decide what a new chain may do. After the open window expires, exactly
    /// one caller gets `Probe`; everyone else keeps seeing `Open` until that
    /// probe resolves.
    pub fn admit(&self, sub: Uuid, now: Instant) -> Admit {
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let Some(e) = map.get_mut(&sub) else {
            return Admit::Closed;
        };
        match e.open_until {
            None => Admit::Closed,
            Some(until) if now < until => Admit::Open,
            Some(_) if e.probing => Admit::Open,
            Some(_) => {
                e.probing = true;
                Admit::Probe
            }
        }
    }

    /// True while the breaker is open or a probe is outstanding.
    pub fn is_open(&self, sub: Uuid, now: Instant) -> bool {
        let map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        map.get(&sub)
            .and_then(|e| e.open_until.map(|u| now < u || e.probing))
            .unwrap_or(false)
    }

    /// Give up a probe that ended without a verdict (for example an SSRF
    /// refusal), so the next delivery can probe instead of waiting forever.
    pub fn release_probe(&self, sub: Uuid) {
        if let Some(e) = self
            .inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_mut(&sub)
        {
            e.probing = false;
        }
    }

    /// A delivery attempt succeeded: close the breaker.
    pub fn record_success(&self, sub: Uuid) {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&sub);
    }

    /// A delivery attempt failed. Returns true when this call opened (or
    /// re-opened after a failed probe) the breaker.
    pub fn record_failure(&self, sub: Uuid, now: Instant) -> bool {
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let e = map.entry(sub).or_default();
        e.consecutive_failures += 1;
        let was_probe = e.probing;
        if was_probe || e.consecutive_failures >= BREAKER_FAILURE_THRESHOLD {
            // Newly open: never opened, a failed probe, or the open window had
            // already expired (a replay probe re-opening it).
            let newly = was_probe || e.open_until.is_none_or(|until| now >= until);
            e.open_until = Some(now + BREAKER_OPEN_FOR);
            e.probing = false;
            return newly;
        }
        false
    }
}

/// Releases a half-open probe slot if the chain ends without a verdict.
pub struct ProbeGuard<'a> {
    pool: &'a DeliveryPool,
    sub: Uuid,
    armed: bool,
}

impl<'a> ProbeGuard<'a> {
    pub fn new(pool: &'a DeliveryPool, sub: Uuid, armed: bool) -> Self {
        Self { pool, sub, armed }
    }

    /// The probe reached a verdict (success or failure was recorded).
    pub fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for ProbeGuard<'_> {
    fn drop(&mut self) {
        if self.armed {
            self.pool.breaker.release_probe(self.sub);
        }
    }
}

/// Deliveries waiting per subscription before the excess is deferred.
pub const MAX_PENDING_PER_SUB: usize = 64;

struct TaskGuard {
    pool: Arc<DeliveryPool>,
    _slot: OwnedSemaphorePermit,
}

impl Drop for TaskGuard {
    fn drop(&mut self) {
        if self.pool.inflight.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.pool.idle.notify_waiters();
        }
    }
}

/// Holds one of a subscription's pending-delivery slots.
pub struct PendingGuard {
    pool: Arc<DeliveryPool>,
    sub: Uuid,
}

impl Drop for PendingGuard {
    fn drop(&mut self) {
        let mut map = self.pool.pending.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(n) = map.get_mut(&self.sub) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                map.remove(&self.sub);
            }
        }
    }
}

/// Marks a subscription as being replayed.
pub struct ReplayGuard {
    pool: Arc<DeliveryPool>,
    sub: Uuid,
}

impl Drop for ReplayGuard {
    fn drop(&mut self) {
        self.pool
            .replaying
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.sub);
    }
}

/// The delivery queue is at capacity.
#[derive(Debug)]
pub struct QueueFull;

/// Shared delivery state: attempt permits, the queue bound, per-subscription
/// single-flight locks and the breaker.
pub struct DeliveryPool {
    attempts: Arc<Semaphore>,
    queue: Arc<Semaphore>,
    /// Separate bound for retraction / evidence fan-outs, so background work
    /// can never consume slots that live alerts need.
    background: Arc<Semaphore>,
    pending: Mutex<HashMap<Uuid, usize>>,
    replaying: Mutex<std::collections::HashSet<Uuid>>,
    sub_locks: Mutex<HashMap<Uuid, Arc<tokio::sync::Mutex<()>>>>,
    inflight: AtomicUsize,
    /// Gauge publications so far (lets tests observe the refresher).
    publishes: AtomicUsize,
    idle: Notify,
    pub breaker: SubscriberBreaker,
}

impl DeliveryPool {
    pub fn new(attempt_permits: usize, queue_capacity: usize) -> Arc<Self> {
        Arc::new(Self {
            attempts: Arc::new(Semaphore::new(attempt_permits)),
            queue: Arc::new(Semaphore::new(queue_capacity)),
            background: Arc::new(Semaphore::new((queue_capacity / 4).max(1))),
            pending: Mutex::new(HashMap::new()),
            replaying: Mutex::new(std::collections::HashSet::new()),
            sub_locks: Mutex::new(HashMap::new()),
            inflight: AtomicUsize::new(0),
            publishes: AtomicUsize::new(0),
            idle: Notify::new(),
            breaker: SubscriberBreaker::default(),
        })
    }

    /// Reserve a slot for one delivery and run it in the background. Never
    /// blocks: a full queue returns `QueueFull` so the caller can dead-letter.
    pub fn try_spawn<F>(self: &Arc<Self>, fut: F) -> Result<(), QueueFull>
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let slot = self.queue.clone().try_acquire_owned().map_err(|_| {
            metrics::counter!("pegana_dispatcher_queue_full_total").increment(1);
            QueueFull
        })?;
        self.launch(slot, fut);
        Ok(())
    }

    /// Like [`try_spawn`] for background workers (retraction, evidence
    /// re-fire) that can afford to wait: waits for a free slot instead of
    /// failing, and hands back the task's result. The number of live tasks and
    /// pending results stays bounded by the queue capacity.
    pub async fn spawn_result<F, T>(self: &Arc<Self>, fut: F) -> tokio::sync::oneshot::Receiver<T>
    where
        F: Future<Output = T> + Send + 'static,
        T: Send + 'static,
    {
        let slot = self
            .background
            .clone()
            .acquire_owned()
            .await
            .expect("queue semaphore is never closed");
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.launch(slot, async move {
            let _ = tx.send(fut.await);
        });
        rx
    }

    /// Run a background task if a background slot is free right now; never
    /// waits. Used by triggers that must not block (replay kicks).
    pub fn try_spawn_background<F>(self: &Arc<Self>, fut: F) -> Result<(), QueueFull>
    where
        F: Future<Output = ()> + Send + 'static,
    {
        let slot = self
            .background
            .clone()
            .try_acquire_owned()
            .map_err(|_| QueueFull)?;
        self.launch(slot, fut);
        Ok(())
    }

    fn launch<F>(self: &Arc<Self>, slot: OwnedSemaphorePermit, fut: F)
    where
        F: Future<Output = ()> + Send + 'static,
    {
        self.inflight.fetch_add(1, Ordering::SeqCst);
        // The guard releases the slot and the in-flight count even if the
        // task panics, so a panic cannot wedge shutdown draining.
        let guard = TaskGuard {
            pool: self.clone(),
            _slot: slot,
        };
        tokio::spawn(async move {
            let _guard = guard;
            fut.await;
        });
    }

    /// Reserve a pending-delivery slot for one subscription. `None` when that
    /// subscription already has `MAX_PENDING_PER_SUB` deliveries waiting.
    pub fn enter_sub(self: &Arc<Self>, sub: Uuid) -> Option<PendingGuard> {
        let mut map = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        let n = map.entry(sub).or_insert(0);
        if *n >= MAX_PENDING_PER_SUB {
            return None;
        }
        *n += 1;
        Some(PendingGuard {
            pool: self.clone(),
            sub,
        })
    }

    /// At most one replay of deferred deliveries per subscription at a time.
    pub fn try_begin_replay(self: &Arc<Self>, sub: Uuid) -> Option<ReplayGuard> {
        let mut set = self.replaying.lock().unwrap_or_else(|e| e.into_inner());
        if !set.insert(sub) {
            return None;
        }
        Some(ReplayGuard {
            pool: self.clone(),
            sub,
        })
    }

    /// Deliveries currently queued or running.
    pub fn inflight(&self) -> usize {
        self.inflight.load(Ordering::SeqCst)
    }

    /// Wait for in-flight deliveries to finish. True when drained in time.
    pub async fn drain(&self, timeout: Duration) -> bool {
        let wait = async {
            loop {
                let notified = self.idle.notified();
                if self.inflight() == 0 {
                    return;
                }
                notified.await;
            }
        };
        tokio::time::timeout(timeout, wait).await.is_ok()
    }

    /// Take one HTTP-attempt permit. Held only around the DNS check and the
    /// request, never across a backoff sleep.
    pub async fn acquire_attempt(&self) -> OwnedSemaphorePermit {
        // The semaphore is never closed, so this cannot fail.
        let permit = self
            .attempts
            .clone()
            .acquire_owned()
            .await
            .expect("attempt semaphore is never closed");
        self.publish_permits();
        permit
    }

    /// Refresh the available-permits gauge (call after releasing a permit).
    pub fn publish_permits(&self) {
        self.publishes.fetch_add(1, Ordering::Relaxed);
        metrics::gauge!("pegana_dispatcher_webhook_permits_available")
            .set(self.attempts.available_permits() as f64);
    }

    /// The lock serialising delivery chains of one subscription.
    pub fn sub_lock(&self, sub: Uuid) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = self.sub_locks.lock().unwrap_or_else(|e| e.into_inner());
        if map.len() > 4096 {
            // Drop locks nobody holds or waits on.
            map.retain(|_, l| Arc::strong_count(l) > 1);
        }
        map.entry(sub).or_default().clone()
    }

    /// Re-publish the permits gauge on a fixed period, so it cannot stay stuck
    /// at a stale value when an event-driven update is missed or interleaved.
    pub fn spawn_gauge_refresher(
        self: &Arc<Self>,
        period: Duration,
    ) -> tokio::task::JoinHandle<()> {
        let pool = self.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(period);
            loop {
                tick.tick().await;
                pool.publish_permits();
            }
        })
    }

    /// Register the gauges and counters at zero so rate()/increase() see the
    /// first event after a restart.
    pub fn init_metrics(&self) {
        metrics::counter!("pegana_dispatcher_breaker_open_total").absolute(0);
        metrics::counter!("pegana_dispatcher_queue_full_total").absolute(0);
        metrics::counter!("pegana_dispatcher_deferred_replayed_total").absolute(0);
        metrics::counter!("pegana_dispatcher_alert_poison_total").absolute(0);
        metrics::counter!("pegana_dispatcher_reclaim_process_failed_total").absolute(0);
        metrics::counter!("pegana_webhook_dispatches_total", "status" => "queue_full").absolute(0);
        self.publish_permits();
    }
}

/// The process-wide pool used by `dispatch_one`.
pub fn global_pool() -> &'static Arc<DeliveryPool> {
    static POOL: OnceLock<Arc<DeliveryPool>> = OnceLock::new();
    POOL.get_or_init(|| DeliveryPool::new(DEFAULT_ATTEMPT_PERMITS, DEFAULT_QUEUE_CAPACITY))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_on_consecutive_attempt_failures_probes_once_and_recovers() {
        let b = SubscriberBreaker::default();
        let sub = Uuid::new_v4();
        let other = Uuid::new_v4();
        let now = Instant::now();

        for i in 1..BREAKER_FAILURE_THRESHOLD {
            assert!(!b.record_failure(sub, now), "failure {i} must not open");
            assert_eq!(b.admit(sub, now), Admit::Closed);
        }
        assert!(b.record_failure(sub, now), "threshold failure opens");
        assert!(b.is_open(sub, now));
        assert_eq!(b.admit(sub, now), Admit::Open);
        assert_eq!(b.admit(other, now), Admit::Closed, "others unaffected");

        // After the window exactly one caller gets the probe.
        let later = now + BREAKER_OPEN_FOR + Duration::from_secs(1);
        assert_eq!(b.admit(sub, later), Admit::Probe);
        assert_eq!(b.admit(sub, later), Admit::Open, "second caller waits");

        // A failed probe re-opens for a full window.
        assert!(b.record_failure(sub, later));
        assert_eq!(b.admit(sub, later), Admit::Open);
        let much_later = later + BREAKER_OPEN_FOR + Duration::from_secs(1);
        assert_eq!(b.admit(sub, much_later), Admit::Probe);

        // A successful probe closes it.
        b.record_success(sub);
        assert_eq!(b.admit(sub, much_later), Admit::Closed);
    }

    #[tokio::test]
    async fn gauge_refresher_republishes_on_a_period() {
        let pool = DeliveryPool::new(2, 10);
        let before = pool.publishes.load(Ordering::Relaxed);
        let handle = pool.spawn_gauge_refresher(Duration::from_millis(20));
        tokio::time::sleep(Duration::from_millis(150)).await;
        let after = pool.publishes.load(Ordering::Relaxed);
        handle.abort();
        assert!(after - before >= 3, "published {} times", after - before);
    }

    #[test]
    fn a_failure_after_the_open_window_expired_counts_as_newly_open() {
        let b = SubscriberBreaker::default();
        let sub = Uuid::new_v4();
        let now = Instant::now();
        for _ in 0..BREAKER_FAILURE_THRESHOLD {
            b.record_failure(sub, now);
        }
        let later = now + BREAKER_OPEN_FOR + Duration::from_secs(1);
        // Still-open window: not newly open. Expired window: newly open again.
        assert!(!b.record_failure(sub, now + Duration::from_secs(1)));
        assert!(b.record_failure(sub, later));
    }

    #[test]
    fn pending_backlog_per_subscription_is_capped_and_released() {
        let pool = DeliveryPool::new(2, 100);
        let sub = Uuid::new_v4();
        let guards: Vec<_> = (0..MAX_PENDING_PER_SUB)
            .map(|_| pool.enter_sub(sub).expect("under the cap"))
            .collect();
        assert!(pool.enter_sub(sub).is_none(), "over the cap");
        assert!(pool.enter_sub(Uuid::new_v4()).is_some(), "other subs fine");
        drop(guards);
        assert!(pool.enter_sub(sub).is_some(), "released");
    }

    #[tokio::test]
    async fn background_try_spawn_never_waits_when_saturated() {
        let pool = DeliveryPool::new(2, 4); // background capacity = 1
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        pool.try_spawn_background(async move {
            let _ = rx.await;
        })
        .expect("first fits");
        let started = Instant::now();
        assert!(pool.try_spawn_background(async {}).is_err());
        assert!(
            started.elapsed() < Duration::from_millis(50),
            "must not wait"
        );
        let _ = tx.send(());
    }

    #[tokio::test]
    async fn a_panicking_task_still_releases_its_slot_and_count() {
        let pool = DeliveryPool::new(2, 1);
        pool.try_spawn(async { panic!("boom") }).unwrap();
        assert!(pool.drain(Duration::from_secs(2)).await);
        assert_eq!(pool.inflight(), 0);
        pool.try_spawn(async {}).expect("slot freed after panic");
    }

    #[tokio::test]
    async fn background_work_cannot_take_alert_slots() {
        let pool = DeliveryPool::new(2, 4); // background capacity = 1
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let _held = pool
            .spawn_result(async move {
                let _ = rx.await;
            })
            .await;
        // The alert queue is untouched by the busy background task.
        for _ in 0..4 {
            pool.try_spawn(async {}).expect("alert slot");
        }
        let _ = tx.send(());
    }

    #[tokio::test]
    async fn full_queue_is_rejected_and_drain_waits_for_inflight() {
        let pool = DeliveryPool::new(2, 1);
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        pool.try_spawn(async move {
            let _ = rx.await;
        })
        .expect("first fits");
        assert!(
            pool.try_spawn(async {}).is_err(),
            "second exceeds the bound"
        );
        assert!(!pool.drain(Duration::from_millis(20)).await, "still busy");
        tx.send(()).unwrap();
        assert!(pool.drain(Duration::from_secs(2)).await);
        assert_eq!(pool.inflight(), 0);
        pool.try_spawn(async {}).expect("slot freed");
    }
}

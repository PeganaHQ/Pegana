//! Pegana indexer — orchestrates 12 ingestion tasks (Pyth, Sanctum, Jupiter, Hylo, …).
//!
//! Recovery policy: a source task exiting/erroring/panicking is LOGGED and the
//! drain loop CONTINUES — siblings are never aborted and `main` always returns
//! `Ok(())` (exit 0). Force-restarting on a controlled exit crash-loops the
//! process (the reason the earlier abort-on-exit design was reverted), so the
//! recovery + alerting mechanism is NOT process-exit-triggered restart — it is
//! the per-source `pegana_source_task_up` / `pegana_source_last_publish_timestamp`
//! Prometheus gauges (task_up=0 / staleness alerts). ⚠️ Because exit is always 0,
//! a `Restart=on-failure` policy would NOT restart a fully-dead indexer; rely on
//! the gauges + `Restart=always` if a hard restart is wanted.

mod config;
pub mod rpc;
mod sinks;
mod sources;
mod state;

use anyhow::Result;
use config::Config;
use state::AppState;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

/// Spawn a source task and maintain its `pegana_source_task_up{source}` gauge.
/// Sets the gauge to 1 immediately and to 0 when the task exits for any reason.
///
/// `$fut` is evaluated eagerly (the future is constructed, but not yet polled)
/// before the `async move` wrapper is created, so the clones of `state` and
/// `shutdown` that appear in the call are consumed at spawn-time and do not
/// interfere with the surrounding locals.
/// Resets `pegana_source_task_up{source}` to 0 on task exit — including a PANIC.
/// A plain post-`await` `.set(0.0)` is SKIPPED when the task unwinds, so the
/// liveness gauge would lie "up" (1) forever on exactly the panic it exists to
/// catch (audit 2026-07-18). Drop runs on both a clean return and an unwind.
struct SourceTaskUpGuard(&'static str);
impl Drop for SourceTaskUpGuard {
    fn drop(&mut self) {
        metrics::gauge!("pegana_source_task_up", "source" => self.0).set(0.0);
    }
}

macro_rules! spawn_source {
    ($tasks:expr, $name:literal, $fut:expr) => {{
        metrics::gauge!("pegana_source_task_up", "source" => $name).set(1.0);
        let fut = $fut;
        $tasks.spawn(async move {
            // Guard resets the gauge to 0 on ANY exit (return OR panic-unwind).
            let _up = SourceTaskUpGuard($name);
            fut.await
        });
    }};
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    init_tracing();
    // Bind for the lifetime of `main` so the guard's Drop can flush events.
    let _sentry = pegana_common::observability::init_sentry("indexer");
    pegana_common::observability::init_metrics("0.0.0.0:9090");
    metrics::describe_gauge!(
        "pegana_intrinsic_divergence_bps",
        metrics::Unit::Count,
        "SELF-AUDIT: |Pegana's sanctum_lst rate − lst-directory.com's independently \
         reported rate| in bps, per covered LST. Cross-checks Pegana's OWN intrinsic \
         derivation against a second source; NOT a peg-state signal and never fed back \
         into the discount/FSM pipeline."
    );
    pegana_common::observability::spawn_healthz("0.0.0.0:9094");
    info!(
        "pegana-indexer starting · version={}",
        env!("CARGO_PKG_VERSION")
    );

    let cfg = Config::from_env()?;
    let state = AppState::init(cfg).await?;
    info!(assets = state.assets.assets.len(), "configuration loaded");

    let shutdown = CancellationToken::new();
    install_signal_handlers(shutdown.clone());

    let mut tasks: JoinSet<Result<()>> = JoinSet::new();
    spawn_source!(
        tasks,
        "pyth",
        sources::pyth::run(state.clone(), shutdown.clone())
    );
    spawn_source!(
        tasks,
        "sanctum",
        sources::sanctum::run(state.clone(), shutdown.clone())
    );
    spawn_source!(
        tasks,
        "jupiter",
        sources::jupiter::run(state.clone(), shutdown.clone())
    );
    spawn_source!(
        tasks,
        "hylo",
        sources::hylo::run(state.clone(), shutdown.clone())
    );
    spawn_source!(
        tasks,
        "solayer_susd",
        sources::solayer_susd::run(state.clone(), shutdown.clone())
    );
    spawn_source!(
        tasks,
        "piggybank",
        sources::piggybank_pb::run(state.clone(), shutdown.clone())
    );
    spawn_source!(
        tasks,
        "spl_stake_pool",
        sources::spl_stake_pool::run(state.clone(), shutdown.clone())
    );
    spawn_source!(
        tasks,
        "perena",
        sources::perena::run(state.clone(), shutdown.clone())
    );
    spawn_source!(
        tasks,
        "dexscreener",
        sources::dexscreener::run(state.clone(), shutdown.clone())
    );
    spawn_source!(
        tasks,
        "tokens_xyz",
        sources::tokens_xyz::run(state.clone(), shutdown.clone())
    );
    spawn_source!(
        tasks,
        "tokens_xyz_risk",
        sources::tokens_xyz_risk::run(state.clone(), shutdown.clone())
    );
    spawn_source!(
        tasks,
        "lst_directory_audit",
        sources::lst_directory_audit::run(state.clone(), shutdown.clone())
    );
    // Isolated size/context signal (circulating supply / market cap) — a
    // separate task that shares no in-memory state with the NAV/discount
    // sources above and writes only `assets.circulating_supply` +
    // `assets.supply_updated_at` (migration 0065). See sources::token_supply
    // module docs for the full isolation rationale.
    spawn_source!(
        tasks,
        "token_supply",
        sources::token_supply::run(state.clone(), shutdown.clone())
    );

    // Drain the JoinSet. A source task returning (Ok or Err) is a CONTROLLED
    // exit — most commonly a source idling out because it has no active assets
    // (e.g. a deactivated single-asset source), or a clean shutdown. We log and
    // continue rather than aborting the whole indexer: force-restarting on a
    // controlled exit crash-loops the process whenever any source legitimately
    // idles (the reason the earlier abort-on-exit design was reverted). A source
    // that *should* be producing but silently stopped is surfaced instead by the
    // per-source `pegana_source_task_up` / `pegana_source_last_publish_timestamp`
    // liveness gauges (Prometheus alerts on staleness / task_up=0).
    while let Some(res) = tasks.join_next().await {
        match res {
            Ok(Ok(())) => info!("source task finished"),
            Ok(Err(e)) => error!(?e, "source task exited with error"),
            Err(e) => error!(?e, "source task panicked"),
        }
    }
    info!("indexer exited");
    Ok(())
}

fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().json().with_target(true))
        .init();
}

fn install_signal_handlers(token: CancellationToken) {
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        info!("ctrl-c received · initiating graceful shutdown");
        token.cancel();
    });
}

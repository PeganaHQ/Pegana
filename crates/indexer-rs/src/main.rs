//! Pegana indexer — supervises ingestion tasks and reports source liveness.

use anyhow::Result;
use indexer_rs::config::Config;
use indexer_rs::state::AppState;
use indexer_rs::{sources, supervisor};
use std::sync::Arc;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

/// Spawn a supervised source task. Registers it with the health view, restarts it
/// on error/panic and keeps its `pegana_source_task_up{source}` gauge honest.
macro_rules! spawn_source {
    ($tasks:expr, $name:literal, $run:path, $state:expr, $shutdown:expr, $health:expr) => {{
        let source_state = $state.clone();
        let source_shutdown = $shutdown.clone();
        let source_health = $health.clone();
        // Registered before the task is polled so /healthz never misses a source.
        source_health.register($name);
        $tasks.spawn(supervisor::supervise(
            $name,
            source_health,
            source_shutdown,
            move |shutdown| $run(source_state.clone(), shutdown),
        ));
    }};
}

/// Upper bound on waiting for sources to stop after a shutdown request.
const SHUTDOWN_DRAIN: std::time::Duration = std::time::Duration::from_secs(8);

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
    info!(
        "pegana-indexer starting · version={}",
        env!("CARGO_PKG_VERSION")
    );

    let cfg = Config::from_env()?;
    let state = AppState::init(cfg).await?;
    info!(assets = state.assets.assets.len(), "configuration loaded");

    let shutdown = CancellationToken::new();
    install_signal_handlers(shutdown.clone());
    let health = Arc::new(supervisor::Health::default());
    supervisor::spawn_healthz("0.0.0.0:9094", health.clone());

    let mut tasks: JoinSet<Result<()>> = JoinSet::new();
    spawn_source!(tasks, "pyth", sources::pyth::run, state, shutdown, health);
    spawn_source!(
        tasks,
        "sanctum",
        sources::sanctum::run,
        state,
        shutdown,
        health
    );
    spawn_source!(
        tasks,
        "jupiter",
        sources::jupiter::run,
        state,
        shutdown,
        health
    );
    spawn_source!(tasks, "hylo", sources::hylo::run, state, shutdown, health);
    spawn_source!(
        tasks,
        "solayer_susd",
        sources::solayer_susd::run,
        state,
        shutdown,
        health
    );
    spawn_source!(
        tasks,
        "piggybank",
        sources::piggybank_pb::run,
        state,
        shutdown,
        health
    );
    spawn_source!(
        tasks,
        "spl_stake_pool",
        sources::spl_stake_pool::run,
        state,
        shutdown,
        health
    );
    spawn_source!(
        tasks,
        "perena",
        sources::perena::run,
        state,
        shutdown,
        health
    );
    // Free off-Pyth intrinsic sources (2026-10): JLP pool AUM, Ethereum
    // issuer view calls (USDY, sUSDe), and the HTTP FX median (EURC).
    spawn_source!(
        tasks,
        "jupiter_perps",
        sources::jupiter_perps::run,
        state,
        shutdown,
        health
    );
    spawn_source!(
        tasks,
        "evm_nav",
        sources::evm_nav::run,
        state,
        shutdown,
        health
    );
    spawn_source!(
        tasks,
        "fx_http",
        sources::fx_http::run,
        state,
        shutdown,
        health
    );
    spawn_source!(
        tasks,
        "dexscreener",
        sources::dexscreener::run,
        state,
        shutdown,
        health
    );
    spawn_source!(
        tasks,
        "tokens_xyz",
        sources::tokens_xyz::run,
        state,
        shutdown,
        health
    );
    spawn_source!(
        tasks,
        "tokens_xyz_risk",
        sources::tokens_xyz_risk::run,
        state,
        shutdown,
        health
    );
    spawn_source!(
        tasks,
        "lst_directory_audit",
        sources::lst_directory_audit::run,
        state,
        shutdown,
        health
    );
    // Isolated size/context signal (circulating supply / market cap) — a
    // separate task that shares no in-memory state with the NAV/discount
    // sources above and writes only `assets.circulating_supply` +
    // `assets.supply_updated_at` (migration 0065). See sources::token_supply
    // module docs for the full isolation rationale.
    spawn_source!(
        tasks,
        "token_supply",
        sources::token_supply::run,
        state,
        shutdown,
        health
    );

    // Controlled exits are legitimate for sources with no configured assets.
    // Errors and panics are restarted by the per-source supervisor.
    let drain = async {
        while let Some(res) = tasks.join_next().await {
            match res {
                Ok(Ok(())) => info!("source task finished"),
                Ok(Err(e)) => error!(?e, "source task exited with error"),
                Err(e) => error!(?e, "source task panicked"),
            }
        }
    };
    // After a shutdown request the drain is bounded, so one source stuck in an
    // upstream call cannot hold the container past its stop grace period.
    let drain_deadline = async {
        shutdown.cancelled().await;
        tokio::time::sleep(SHUTDOWN_DRAIN).await;
    };
    tokio::select! {
        _ = drain => {}
        _ = drain_deadline => warn!("source drain exceeded the shutdown deadline; exiting"),
    }
    info!("indexer exited");
    Ok(())
}

fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn,solana_rpc_client=info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt::layer().json().with_target(true))
        .init();
}

fn install_signal_handlers(token: CancellationToken) {
    tokio::spawn(async move {
        #[cfg(unix)]
        {
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(mut sigterm) => tokio::select! {
                    _ = tokio::signal::ctrl_c() => info!("ctrl-c received · initiating graceful shutdown"),
                    _ = sigterm.recv() => info!("SIGTERM received · initiating graceful shutdown"),
                },
                Err(e) => {
                    error!(error = %e, "failed to register SIGTERM handler");
                    let _ = tokio::signal::ctrl_c().await;
                }
            }
        }
        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }
        token.cancel();
    });
}

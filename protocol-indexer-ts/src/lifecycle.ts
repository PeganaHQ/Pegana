import { redactSecrets } from "./fetch-util";

// Process lifecycle guards. The 2026-10-21 crash loop exited with code 0 and no
// log line at all, which made it undiagnosable; every exit path now logs.

export interface GuardDeps {
  proc?: Pick<NodeJS.Process, "on">;
  log?: (...a: unknown[]) => void;
}

export function installProcessGuards(
  capture: (e: unknown) => void,
  deps: GuardDeps = {},
): void {
  const proc = deps.proc ?? process;
  const log = deps.log ?? console.error;

  // Non-fatal by design: a rejection inside one source must not take the health
  // endpoint and the other sources down with it.
  proc.on("unhandledRejection", (reason) => {
    log("[WARN] unhandledRejection (continuing):", redactSecrets(String(reason)));
    capture(reason);
  });
  proc.on("uncaughtException", (err) => {
    log("[WARN] uncaughtException (continuing):", redactSecrets(String(err)));
    capture(err);
  });
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    proc.on(sig, () => {
      log(`[EXIT] received ${sig} — shutting down`);
      process.exit(0);
    });
  }
  proc.on("beforeExit", (code) => log(`[EXIT] event loop drained (beforeExit code=${code})`));
  proc.on("exit", (code) => log(`[EXIT] process exiting code=${code}`));
}

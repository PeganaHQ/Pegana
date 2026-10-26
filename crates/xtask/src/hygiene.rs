//! `cargo xtask hygiene` — repo hygiene + architectural boundary guard.
//!
//! Two independent checks, both cheap enough to run on every pre-deploy pass
//! and in a local pre-commit hook:
//!
//! 1. **Tracked-file hygiene.** Walks `git ls-files` (VERSIONED files only —
//!    the whole point is catching what slipped past `.gitignore` via `git add`,
//!    not scanning the working tree) and rejects: a `.env*` file that is not a
//!    `.example` template, anything under a `tmp/` segment, any AI-assistant
//!    artifact directory (`.claude` / `.cursor` / `.agents`), and `.DS_Store`.
//!    Adapted from `scripts/check-repo-hygiene.mjs` in solana-foundation/tokens
//!    (MIT), whose own comment notes those scratch dirs "have held production
//!    secrets and end-user PII in the past."
//!
//! 2. **Receipt-boundary guard.** The tokens.xyz enrichment fields
//!    (`holder_count`, `volume_24h_usd`, …) are inert context metadata: they
//!    flow Postgres → API and must NEVER reach the discount / EWMA / FSM /
//!    receipt pipeline. The boundary is structural (`sinks::postgres::*` is
//!    inert; `sinks::redis_pub::publish_tracked` is verdict-affecting), and
//!    this guard is what keeps it that way: `engine-rs` and `methodology` may
//!    not so much as name these fields. Same spirit as
//!    `protocol-indexer-ts/test/adr-0036-guard.test.ts`.
//!
//! Exit code is non-zero on any violation → safe for deploy gating.

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Path segments that must never appear in a tracked path.
const FORBIDDEN_SEGMENTS: &[&str] = &[".claude", ".cursor", ".agents"];

/// Path prefixes (as leading segments) that must never be tracked.
const FORBIDDEN_PREFIX_SEGMENTS: &[&str] = &["tmp", "migration-output"];

/// Basenames that must never be tracked.
const FORBIDDEN_BASENAMES: &[&str] = &[".DS_Store"];

/// Crates that must stay free of the inert enrichment fields (check 2).
const RECEIPT_PURE_DIRS: &[&str] = &["crates/engine-rs/src", "crates/methodology/src"];

/// Field names that must not appear in [`RECEIPT_PURE_DIRS`].
///
/// These are the tokens.xyz-sourced context signals. They are deliberately
/// narrow, concrete identifiers rather than loose substrings, so the guard
/// cannot fire on unrelated prose.
const INERT_ONLY_FIELDS: &[&str] = &[
    "holder_count",
    "volume_24h_usd",
    "price_change_24h_pct",
    "price_change_1h_pct",
];

pub fn run() -> Result<()> {
    let root = repo_root()?;
    let tracked = tracked_files(&root)?;

    let file_violations = check_tracked_files(&tracked);
    let boundary_violations = check_receipt_boundary(&root)?;

    println!();
    println!("================== xtask hygiene ==================");
    println!("tracked files scanned : {}", tracked.len());

    report("tracked-file hygiene", &file_violations);
    report("receipt boundary", &boundary_violations);

    let total = file_violations.len() + boundary_violations.len();
    println!("violations            : {total}");
    println!("===================================================");

    if total > 0 {
        bail!("{total} hygiene violation(s)");
    }
    Ok(())
}

fn report(label: &str, violations: &[String]) {
    if violations.is_empty() {
        println!("{label:<22}: ok");
    } else {
        println!("{label:<22}: {} violation(s)", violations.len());
        for v in violations {
            println!("  ✗ {v}");
        }
    }
}

fn repo_root() -> Result<PathBuf> {
    let out = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .context("run `git rev-parse --show-toplevel`")?;
    if !out.status.success() {
        bail!("not inside a git repository");
    }
    let path = String::from_utf8(out.stdout)
        .context("git printed non-UTF-8 path")?
        .trim()
        .to_string();
    Ok(PathBuf::from(path))
}

/// Versioned files only, NUL-separated so paths with spaces survive intact.
fn tracked_files(root: &Path) -> Result<Vec<String>> {
    let out = Command::new("git")
        .args(["ls-files", "-z"])
        .current_dir(root)
        .output()
        .context("run `git ls-files -z`")?;
    if !out.status.success() {
        bail!("`git ls-files` failed");
    }
    let raw = String::from_utf8(out.stdout).context("git printed non-UTF-8 paths")?;
    Ok(raw
        .split('\0')
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .collect())
}

/// A `.env*` file is allowed only when it is a template. Note the rule is
/// "basename ends with `.example`", NOT "equals `.env.example`" — the repo
/// legitimately tracks `web/.env.local.example`, which a stricter rule
/// (like the upstream one this is adapted from) would falsely reject.
fn is_env_template(basename: &str) -> bool {
    basename.ends_with(".example")
}

fn check_tracked_files(tracked: &[String]) -> Vec<String> {
    let mut violations = Vec::new();

    for path in tracked {
        let segments: Vec<&str> = path.split('/').collect();
        let basename = *segments.last().unwrap_or(&path.as_str());

        if basename.starts_with(".env") && !is_env_template(basename) {
            violations.push(format!(
                "{path} — tracked env file (only `*.example` templates may be versioned)"
            ));
            continue;
        }
        if FORBIDDEN_BASENAMES.contains(&basename) {
            violations.push(format!("{path} — junk file"));
            continue;
        }
        if let Some(seg) = segments.iter().find(|s| FORBIDDEN_SEGMENTS.contains(*s)) {
            violations.push(format!("{path} — AI-assistant artifact directory `{seg}`"));
            continue;
        }
        if let Some(first) = segments.first() {
            if FORBIDDEN_PREFIX_SEGMENTS.contains(first) {
                violations.push(format!(
                    "{path} — scratch directory `{first}/` must never be tracked"
                ));
            }
        }
    }

    violations
}

/// Grep `engine-rs` + `methodology` for any inert-only field name.
///
/// Implemented with a plain recursive read rather than shelling out to grep so
/// the guard behaves identically on any machine and needs no external tool.
fn check_receipt_boundary(root: &Path) -> Result<Vec<String>> {
    let mut violations = Vec::new();

    for dir in RECEIPT_PURE_DIRS {
        let abs = root.join(dir);
        if !abs.exists() {
            bail!("receipt-boundary guard points at a missing directory: {dir}");
        }
        for file in rust_files(&abs)? {
            let body = std::fs::read_to_string(&file)
                .with_context(|| format!("read {}", file.display()))?;
            for (lineno, line) in body.lines().enumerate() {
                for field in INERT_ONLY_FIELDS {
                    if line.contains(field) {
                        let rel = file.strip_prefix(root).unwrap_or(&file);
                        violations.push(format!(
                            "{}:{} references `{field}` — inert enrichment fields must never reach the receipt pipeline",
                            rel.display(),
                            lineno + 1
                        ));
                    }
                }
            }
        }
    }

    Ok(violations)
}

fn rust_files(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(&current)
            .with_context(|| format!("read_dir {}", current.display()))?
        {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_templates_are_allowed() {
        // Every template the repo legitimately tracks today.
        assert!(is_env_template(".env.example"));
        assert!(is_env_template(".env.local.example"));
    }

    #[test]
    fn real_env_files_are_rejected() {
        assert!(!is_env_template(".env"));
        assert!(!is_env_template(".env.local"));
        assert!(!is_env_template(".env.production"));
    }

    #[test]
    fn tracked_check_flags_each_category() {
        let tracked = vec![
            "crates/api-rs/src/main.rs".to_string(), // clean
            ".env.example".to_string(),              // clean (template)
            "web/.env.local.example".to_string(),    // clean (template)
            ".env.local".to_string(),                // secret
            "tmp/dump.sql".to_string(),              // scratch
            ".claude/settings.json".to_string(),     // artifact
            "web/.DS_Store".to_string(),             // junk
        ];
        let v = check_tracked_files(&tracked);
        assert_eq!(v.len(), 4, "expected exactly the 4 dirty paths, got: {v:?}");
        assert!(v.iter().any(|s| s.starts_with(".env.local ")));
        assert!(v.iter().any(|s| s.starts_with("tmp/dump.sql ")));
        assert!(v.iter().any(|s| s.starts_with(".claude/settings.json ")));
        assert!(v.iter().any(|s| s.starts_with("web/.DS_Store ")));
    }

    #[test]
    fn clean_tree_produces_no_violations() {
        let tracked = vec![
            "Cargo.toml".to_string(),
            "assets.toml".to_string(),
            "crates/methodology/src/lib.rs".to_string(),
            "mcp-ts/.env.example".to_string(),
        ];
        assert!(check_tracked_files(&tracked).is_empty());
    }

    /// A `.env`-prefixed name nested deep still gets caught (segment-aware).
    #[test]
    fn nested_env_file_is_rejected() {
        let tracked = vec!["services/worker/.env.production".to_string()];
        assert_eq!(check_tracked_files(&tracked).len(), 1);
    }
}

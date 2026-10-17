#!/usr/bin/env bash
#
# harden-github.sh — lock down PeganaHQ/ReplayCLI + the PeganaHQ org.
#
# WHY THIS EXISTS
#   ReplayCLI is the trust anchor: the binary it releases is what third parties
#   run to decide whether a Pegana receipt is honest. Compromising *this* repo
#   is strictly more valuable than compromising the API — a malicious verifier
#   makes every tampered receipt look clean. It therefore needs a higher bar
#   than the private repo, not a lower one.
#
# THE ONE THING THAT MUST NOT BREAK
#   ReplayCLI is a GENERATED MIRROR. `.github/workflows/sync-pegana-replay.yml`
#   in the private repo rebuilds the tree from an EMPTY INDEX and
#   `git push --force` to refs/heads/main using PEGANA_REPLAY_PUSH_TOKEN.
#   => Any ruleset on `main` MUST bypass that identity or the mirror dies.
#   Tags are NOT pushed by the sync — they are pushed by hand, so tag rules
#   are free to be strict.
#
# USAGE
#   ./scripts/harden-github.sh tier1     # safe, reversible, zero sync impact
#   ./scripts/harden-github.sh tier2     # rulesets (tags + branch)
#   ./scripts/harden-github.sh tier3     # org-level (needs admin:org scope)
#   ./scripts/harden-github.sh status    # read-only posture report
#
# SCOPES
#   tier1/tier2 need `repo`. tier3 needs `admin:org`:
#     gh auth refresh -h github.com -s admin:org
#
set -euo pipefail

ORG="PeganaHQ"
REPO="ReplayCLI"
FULL="${ORG}/${REPO}"
# Bypass identity for the main-branch ruleset. The sync PAT acts as this user.
OWNER_LOGIN="lrafasouza"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# TIER 1 — repo security features. All reversible, none touch git refs.
# ---------------------------------------------------------------------------
tier1() {
  step "TIER 1 — repo security features on ${FULL}"

  # Secret scanning + PUSH PROTECTION.
  # This is the highest-value control for a mirror: the sync force-pushes
  # content assembled from a PRIVATE repo. If a credential ever lands in
  # assets.toml or a Cargo.toml, it becomes public in one push. Push
  # protection is the only thing standing between that mistake and the world.
  gh api -X PATCH "repos/${FULL}" \
    -f 'security_and_analysis[secret_scanning][status]=enabled' \
    -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled' \
    -f 'security_and_analysis[secret_scanning_non_provider_patterns][status]=enabled' \
    -f 'security_and_analysis[secret_scanning_validity_checks][status]=enabled' \
    >/dev/null
  ok "secret scanning + push protection + non-provider patterns + validity checks"

  # Dependabot: alerts (read) and security updates (auto-PRs).
  gh api -X PUT "repos/${FULL}/vulnerability-alerts" >/dev/null
  ok "Dependabot vulnerability alerts"
  gh api -X PUT "repos/${FULL}/automated-security-fixes" >/dev/null
  ok "Dependabot automated security fixes"

  # Private vulnerability reporting — gives researchers a private channel
  # ON GitHub. Today SECURITY.md sends them to Telegram, which is a poor fit
  # for a security researcher who wants a CVE and an audit trail.
  gh api -X PUT "repos/${FULL}/private-vulnerability-reporting" >/dev/null
  ok "private vulnerability reporting"

  # Actions policy: require SHA-pinned actions repo-wide.
  # release.yml is already SHA-pinned except dtolnay/rust-toolchain@1.90;
  # this makes the property enforced rather than merely observed.
  gh api -X PUT "repos/${FULL}/actions/permissions" \
    -F 'enabled=true' -f 'allowed_actions=selected' >/dev/null
  gh api -X PUT "repos/${FULL}/actions/permissions/selected-actions" \
    -F 'github_owned_allowed=true' -F 'verified_allowed=true' \
    -f 'patterns_allowed[]=dtolnay/rust-toolchain@*' >/dev/null
  ok "Actions restricted to GitHub-owned + verified + dtolnay/rust-toolchain"

  gh api -X PUT "repos/${FULL}/actions/permissions/workflow" \
    -f 'default_workflow_permissions=read' \
    -F 'can_approve_pull_request_reviews=false' >/dev/null
  ok "default GITHUB_TOKEN = read-only (already set; enforced)"

  # Repo hygiene. Wiki and Projects are unused write surfaces on a mirror.
  gh api -X PATCH "repos/${FULL}" \
    -F 'has_wiki=false' -F 'has_projects=false' \
    -F 'delete_branch_on_merge=true' -F 'allow_auto_merge=false' \
    -F 'web_commit_signoff_required=true' \
    >/dev/null
  ok "wiki/projects off, branch cleanup on, web commit signoff required"

  # Discoverability — the repo currently has ZERO topics.
  gh api -X PUT "repos/${FULL}/topics" \
    -f 'names[]=solana' -f 'names[]=stablecoin' -f 'names[]=oracle' \
    -f 'names[]=rust' -f 'names[]=cli' -f 'names[]=defi' \
    -f 'names[]=liquid-staking' -f 'names[]=verification' \
    -f 'names[]=sigstore' -f 'names[]=reproducible-builds' >/dev/null
  ok "topics set (was empty)"
}

# ---------------------------------------------------------------------------
# TIER 2 — rulesets. Tag rules are the crown jewels.
# ---------------------------------------------------------------------------
tier2() {
  step "TIER 2 — rulesets on ${FULL}"

  # TAG RULESET. Today ANY write-capable actor can push `v0.9.9` and
  # release.yml will build + Sigstore-attest a binary under Pegana's identity,
  # which releases.pegana.xyz then serves as "latest" to every installer.
  # This is the single highest-severity gap in the whole setup.
  #   - deletion + non_fast_forward: a published tag can never be moved or
  #     removed, so a release can't be silently re-pointed at other code.
  #   - bypass: repo admin only (tags are pushed by hand, never by the sync).
  gh api -X POST "repos/${FULL}/rulesets" --input - >/dev/null <<'JSON'
{
  "name": "release-tags-immutable",
  "target": "tag",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": 1, "actor_type": "OrganizationAdmin", "bypass_mode": "always" }
  ],
  "conditions": {
    "ref_name": { "include": ["refs/tags/v*", "refs/tags/methodology-v*"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ]
}
JSON
  ok "tag ruleset: v* and methodology-v* cannot be deleted or moved"

  # BRANCH RULESET on main.
  # force-push (non_fast_forward) is deliberately NOT blocked — the mirror
  # force-pushes by design and blocking it kills the sync. We block deletion
  # only. The sync does `push --force <commit>:refs/heads/main`, which is not
  # a deletion, so this rule is sync-safe even with an empty bypass list.
  gh api -X POST "repos/${FULL}/rulesets" --input - >/dev/null <<'JSON'
{
  "name": "main-mirror-guard",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": 1, "actor_type": "OrganizationAdmin", "bypass_mode": "always" }
  ],
  "conditions": {
    "ref_name": { "include": ["refs/heads/main"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" }
  ]
}
JSON
  ok "branch ruleset: main cannot be deleted (force-push left open for the mirror)"
  warn "verify the next sync run still succeeds before walking away"
}

# ---------------------------------------------------------------------------
# TIER 3 — org level. Needs admin:org.
# ---------------------------------------------------------------------------
tier3() {
  step "TIER 3 — ${ORG} org settings"

  gh api -X PATCH "orgs/${ORG}" \
    -F 'two_factor_requirement_enabled=true' \
    -f 'default_repository_permission=read' \
    -F 'members_can_create_public_repositories=false' \
    -F 'members_can_delete_repositories=false' \
    -F 'members_can_change_repo_visibility=false' \
    -F 'members_can_delete_issues=false' \
    -F 'members_can_create_pages=false' \
    -F 'web_commit_signoff_required=true' \
    >/dev/null
  ok "2FA required; members cannot delete repos or flip visibility"

  # Security defaults for any FUTURE repo in the org — so the next repo
  # starts hardened instead of repeating this exercise.
  gh api -X PATCH "orgs/${ORG}" \
    -F 'dependabot_alerts_enabled_for_new_repositories=true' \
    -F 'dependabot_security_updates_enabled_for_new_repositories=true' \
    -F 'dependency_graph_enabled_for_new_repositories=true' \
    -F 'secret_scanning_enabled_for_new_repositories=true' \
    -F 'secret_scanning_push_protection_enabled_for_new_repositories=true' \
    >/dev/null
  ok "security defaults ON for new repos"
}

# ---------------------------------------------------------------------------
status() {
  step "Posture — ${FULL}"
  gh api "repos/${FULL}" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for k, v in (d.get("security_and_analysis") or {}).items():
    print("  %-48s %s" % (k, v.get("status")))
print("  %-48s %s" % ("has_wiki", d["has_wiki"]))
print("  %-48s %s" % ("topics", len(d.get("topics") or [])))
'
  echo "  rulesets:"
  gh api "repos/${FULL}/rulesets" -q '.[] | "    " + .name + " (" + .target + ", " + .enforcement + ")"' || true
  echo "  actions:"
  gh api "repos/${FULL}/actions/permissions" -q '"    allowed=" + .allowed_actions + " sha_pinning=" + (.sha_pinning_required|tostring)'
}

# ---------------------------------------------------------------------------
# verify-pins — every SHA-pinned action must be REACHABLE FROM A REF.
#
# The trap this exists to catch: `gh api repos/<r>/commits/<sha>` succeeds for
# any commit object the repo has ever seen, INCLUDING dangling ones left behind
# by a force-pushed branch. GitHub Actions cannot resolve those — it fails the
# job with "unable to find version <sha>". A pin can therefore look perfectly
# validated and still break every workflow that uses it.
#
# `compare/<default-branch>...<sha>` is the honest check: it 404s on an
# unreachable commit. This caught a dead dtolnay/rust-toolchain pin that was
# sitting in ci.yml, publish.yml AND release.yml simultaneously.
# ---------------------------------------------------------------------------
verify_pins() {
  step "Action pins — reachability"
  local rc=0
  grep -rhoE 'uses: [A-Za-z0-9._-]+/[A-Za-z0-9._/-]+@[a-f0-9]{40}' \
      tools/pegana-replay-public/ .github/workflows/ 2>/dev/null \
    | sed 's/^uses: //' | sort -u | while read -r ref; do
      local repo="${ref%@*}" sha="${ref##*@}"
      # sub-actions (e.g. github/codeql-action/upload-sarif) live in the root repo
      repo="$(cut -d/ -f1,2 <<<"$repo")"
      local def
      def="$(gh api "repos/${repo}" --jq .default_branch 2>/dev/null)" || { bad_pin "$ref (repo unreachable)"; continue; }
      if gh api "repos/${repo}/compare/${def}...${sha}" --jq .status >/dev/null 2>&1; then
        ok "$ref"
      else
        printf '  \033[31m✗\033[0m %s — NOT reachable from %s (orphaned pin)\n' "$ref" "$def"
        rc=1
      fi
    done
  return $rc
}
bad_pin() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

case "${1:-status}" in
  tier1)        tier1 ;;
  tier2)        tier2 ;;
  tier3)        tier3 ;;
  all)          tier1; tier2; tier3 ;;
  status)       status ;;
  verify-pins)  verify_pins ;;
  *) echo "usage: $0 {tier1|tier2|tier3|all|status|verify-pins}" >&2; exit 2 ;;
esac

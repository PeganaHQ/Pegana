# Runbook — SSH hardening (prod box)

The prod box (Hostinger, OpenSSH 9.6p1 on Ubuntu 24.04) still offered
password authentication on 2026-10-21: an unauthenticated probe got back
`Permission denied (publickey,password)`, which leaves an internet-wide
brute-force surface. Only 22, 80 and 443 were open. This runbook makes SSH
key-only. The drop-in it installs is checked in at
[`ops/sshd/00-pegana-hardening.conf`](../../ops/sshd/00-pegana-hardening.conf).

Needs root (or `deploy` with sudo) on the box. Takes about 5 minutes.

This file is mirrored to the public repo, so it never names the host. Laptop
commands use `$PEGANA_DEPLOY_SERVER` (the same `deploy@<host>` value
`scripts/deploy.sh` reads) and `$PEGANA_HOST` (the bare host). The real values
live only in the private, unmirrored `docs/ops/` launch runbook:

```bash
export PEGANA_DEPLOY_SERVER=deploy@<prod-host>
export PEGANA_HOST="${PEGANA_DEPLOY_SERVER#*@}"
```

## 0. Before you start

- **Keep one SSH session open for the whole procedure.** A reload does not
  drop existing sessions, so if the new config locks you out you can still
  revert from that session.
- Confirm that key login works for every account you use **before** turning
  passwords off. From the laptop, in a second terminal:
  ```bash
  ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no "$PEGANA_DEPLOY_SERVER" true && echo deploy-key-ok
  ssh -o PreferredAuthentications=publickey -o PasswordAuthentication=no "root@$PEGANA_HOST" true && echo root-key-ok   # only if you use root
  ```
  If `deploy-key-ok` does not print, stop and fix `~deploy/.ssh/authorized_keys` first.
- Hostinger's browser terminal (hPanel → VPS) is the out-of-band fallback if
  SSH breaks completely.

## 1. Install the drop-in

On the box (the repo is checked out at `~deploy/pegana`):

```bash
sudo install -m 0644 -o root -g root ~deploy/pegana/ops/sshd/00-pegana-hardening.conf \
  /etc/ssh/sshd_config.d/00-pegana-hardening.conf
ls /etc/ssh/sshd_config.d/                  # note any 50-cloud-init.conf
grep -n '^Include' /etc/ssh/sshd_config     # expect: Include /etc/ssh/sshd_config.d/*.conf (near the top)
```

`00-` sorts first, and sshd keeps the first value it reads for each keyword,
so it wins over a cloud-init file that says `PasswordAuthentication yes`.

## 2. Validate, then reload

```bash
sudo sshd -t && echo config-ok
sudo sshd -T | grep -Ei '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|pubkeyauthentication|maxauthtries) '
# expect:
#   passwordauthentication no
#   kbdinteractiveauthentication no
#   permitrootlogin without-password    (sshd -T prints prohibit-password this way)
#   pubkeyauthentication yes
#   maxauthtries 6
sudo systemctl reload ssh || sudo systemctl restart ssh
```

Do not reload if `sshd -t` printed anything other than `config-ok`.

`MaxAuthTries` is 6 on purpose: the ssh client offers each key in the agent in turn and every
offered key counts as an attempt, so a low value locks out a user with several keys loaded.
If you hit "Too many authentication failures", use `ssh -o IdentitiesOnly=yes -i <key> ...`.

## 3. Verify from the laptop (new connections)

```bash
ssh -o PreferredAuthentications=none -o BatchMode=yes -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null "probe@$PEGANA_HOST"
# expect: probe@<host>: Permission denied (publickey).
#         (no ",password" in the list any more)
ssh "$PEGANA_DEPLOY_SERVER" 'echo key-login-still-works'
```

Only then close the session you kept open in step 0.

## Rollback

From the session kept open (or the Hostinger browser terminal):

```bash
sudo rm /etc/ssh/sshd_config.d/00-pegana-hardening.conf
sudo sshd -t && sudo systemctl reload ssh
```

## 4. Privilege of the `deploy` account (owner decision)

State recorded by the 2026-10-21 r2 audit (finding #49): `sudo -n -l` for
`deploy` lists `(ALL : ALL) ALL` **and** `(ALL) NOPASSWD: ALL`, and before this
runbook is applied `sshd -T` shows `permitrootlogin yes` with
`passwordauthentication yes`. So there are two separate ways to root: the
`deploy` private key alone (sudo never asks for anything), or a guessed root
password (fail2ban only slows that down).

Steps 1-3 above close the second path (`PermitRootLogin prohibit-password`,
no passwords at all). The first path is a decision for the owner, because the
honest gain is limited: `deploy` is in the `docker` group, and docker group
membership is root-equivalent on its own (`docker run -v /:/host ...`). Taking
away NOPASSWD sudo therefore does not make a stolen deploy key harmless. What
it does buy: no silent one-command root, every sudo use needs a secret the key
thief does not have, and sudo use is logged with a password prompt.

Nothing automated needs sudo: `scripts/deploy.sh` (remote half), the cron jobs
(`pg-backup.sh`, `calibration-watch.sh`) and `install-*.sh` never call it
(checked with `grep -n sudo scripts/*.sh`). Only these hand-run runbook steps
do (sshd drop-in install, reboot, `du` over docker volumes).

Recommended, in order of value:

1. Protect the key itself: the deploy key on the laptop has a passphrase (or
   lives on a hardware key), and `AllowUsers deploy` is set (see below).
2. `PermitRootLogin no` instead of `prohibit-password`, once the owner confirms
   no workflow logs in as root with a key (step 0 tells you: `root-key-ok`).
3. Require a password for sudo. On the box, keeping a second session open:
   ```bash
   sudo passwd deploy                                  # store it in 1Password, vault pegana-prod-env
   sudo grep -rn NOPASSWD /etc/sudoers /etc/sudoers.d/ # find the file that grants it
   sudo visudo -f /etc/sudoers.d/<that-file>           # delete only the "deploy ... NOPASSWD: ALL" line
   sudo visudo -c                                      # must print "parsed OK" for every file
   sudo -k && sudo -l                                  # must now ask for the password
   ```
   Rollback: `sudo visudo -f /etc/sudoers.d/<that-file>` and restore the line
   (from the session kept open, or the Hostinger browser terminal).
4. Optional, larger: move the stack to rootless Docker so the `docker` group
   stops being root-equivalent. Not planned; it changes volume ownership and
   the node-exporter mounts.

## Optional, later

- `AllowUsers deploy` (plus `root` if used) in the same drop-in narrows who can
  log in at all. Add it only after confirming the exact account list.
- fail2ban mostly matters while passwords are accepted; with key-only auth it
  just reduces log noise.

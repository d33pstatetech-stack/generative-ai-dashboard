# VPS helpers (Oracle free tier, user `rocky`)

Files here contain **no secrets**. Copy a script to the VPS with `scp`,
then fill env vars on the VPS itself.

## push-modal-billing.sh

Pushes Modal month-to-date spend into the dashboard's manual Modal slot
(Modal has no simple balance API).

```bash
scp scripts/vps/push-modal-billing.sh rocky@150.136.153.233:~/
ssh rocky@150.136.153.233
pip install modal  # once
export DASHBOARD_URL=https://generative-ai-dashboard.d33pstatetech.workers.dev
# once the dashboard is Access-locked, also export:
# export CF_ACCESS_CLIENT_ID=.... CF_ACCESS_CLIENT_SECRET=....
./push-modal-billing.sh            # auto from `modal billing summary`
./push-modal-billing.sh 12.34      # or manual value
```

Cron (hourly): `crontab -e` →

```
0 * * * * DASHBOARD_URL=... CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... ~/push-modal-billing.sh >>~/billing-push.log 2>&1
```

## Box notes (verified 2026-09-11)

- Rocky Linux 9, 2 vCPU, ~764 MB RAM, 34G disk free. No docker/node/cloudflared.
- `obscura-bin` + Chrome DevTools on `:9222` (existing scraper/browser — leave alone).
- Keep new jobs tiny: shell + python3 stdlib only.

#!/usr/bin/env bash
cd /home/user/newwellsfargo
pkill -f "vite --config vite.demo" 2>/dev/null
sleep 1
T=$(sed -n '1p' /tmp/wf-admin-creds)
E=$(sed -n '2p' /tmp/wf-admin-creds)
P=$(sed -n '3p' /tmp/wf-admin-creds)
export DEMO_ADMIN_TOKEN="$T" DEMO_ADMIN_EMAIL="$E" DEMO_ADMIN_PASSWORD="$P"
npm run dev -- --host 0.0.0.0 --port 5173 > /tmp/vite_fin.log 2>&1 &
sleep 8
tail -2 /tmp/vite_fin.log
(ss -tln 2>/dev/null || netstat -tln 2>/dev/null) | grep 5173 | head -1

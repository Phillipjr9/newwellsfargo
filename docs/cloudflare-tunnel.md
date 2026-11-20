# Run the full app behind Cloudflare Tunnel

This runs the UI and API on **one Linux Node server** with local persistent storage. Cloudflare handles HTTPS and access to the private hostname; it does not run Node or store the ledger. Do not use a public quick tunnel, Cloudflare Pages, or more than one app process sharing these files. Use only fictional data and app-issued codes. Do not use a bank’s name in the deployment hostname or accept real banking credentials.

## 1. Prepare the Node host

Use an always-on Linux host with systemd, Node.js 22, and `cloudflared`. Transfer the desired source revision, including `deploy/cloudflare/`, to `/opt/workspace-app` via your normal release process. Run these build commands as a deploy user with write access to that directory, not as root:

```sh
cd /opt/workspace-app
npm ci --include=dev
npm run build
npm prune --omit=dev
```

Create an unprivileged `workspace-app` system user and group. Keep the release directory readable but not writable by that user. Install the service (the service looks for Node in `/usr/local/bin`, `/usr/bin`, and `/bin`; if necessary, use its system-wide executable path in `ExecStart`):

```sh
sudo install -d -m 0700 /etc/workspace-app
sudo install -m 0600 deploy/cloudflare/workspace.env.example /etc/workspace-app/workspace.env
sudoedit /etc/workspace-app/workspace.env
sudo install -m 0644 deploy/cloudflare/workspace-app.service /etc/systemd/system/workspace-app.service
sudo systemctl daemon-reload
sudo systemctl enable --now workspace-app
curl -fsS http://127.0.0.1:3000/api/admin/session
```

Use a unique, randomly generated `DEMO_ADMIN_TOKEN` of at least 32 characters. Store it only in the server’s protected environment file or secret manager. The local endpoint should return `authenticated: false` and `adminEnabled: true`; HTTPS sign-in is tested via the tunnel, not the loopback health check. The service listens only on `127.0.0.1:3000`. Do not open port 3000 in the host firewall or forward it from a router.

The service creates `/var/lib/workspace-app` for the ledger and signing state, and `/var/cache/workspace-app` for discardable page cache. Keep the state directory across updates. Back up the state directory securely while the service is stopped for a consistent copy. The app’s downloadable backup is useful for workspace recovery but intentionally omits sign-in secrets. Administrator sessions end on restart. On subsequent releases **do not overwrite the environment file with the example**.

## 2. Put Cloudflare Access in front of the hostname

1. Choose a neutral subdomain you control in Cloudflare, such as `workspace-preview.example.com`. In Cloudflare Zero Trust, create a **self-hosted Access application** for the entire hostname (no path restriction). Allow only explicitly authorized tester identities or groups. Do not add a Bypass policy or allow the general public. This protects `/`, the portal, `/admin`, and every `/api` route. The app’s own role checks still apply.
2. In **Zero Trust → Networks → Tunnels**, create a remotely managed Cloudflare Tunnel. Install its connector on the same Node host using the dashboard’s instructions. Do not paste the tunnel token into chat, Git, or the application’s environment file.
3. Add a published application route for the **same protected hostname** with service type HTTP and target `http://127.0.0.1:3000`. Leave the HTTP Host header override unset so the app sees the browser-facing host for same-origin checks. Use a cache bypass rule for this hostname; in particular, never cache `/api/*`.
4. From a signed-out browser, verify that the homepage **and a direct `/api/admin/session` request** are intercepted by Access. Then use an authorized tester identity and verify customer and admin sign-in over HTTPS. Confirm admin and customer sessions cannot access each other’s protected endpoints. Remove the route immediately if the Access gate is missing.

For first deployment, use an empty state directory and fictional test accounts. A live cutover still requires access to your Cloudflare dashboard and Node host. No Cloudflare credentials or server settings are stored in this repository.

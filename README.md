# Wells Fargo Online Banking

An independent, account activity banking workspace built with React and a Node.js API. It does not connect to Wells Fargo, Zelle, a payment network, or any real account. No banking credentials are required.

## Run

```sh
npm install
npm run dev
```

Open `/` (or `/home`) for the public homepage. Select **Sign On** to access the simulated account overview at `/portal`.

```sh
npm run build
npm start
```

Run with Node.js 22. The production server defaults to port 3000. `PORT`, `HOST`, and `DEMO_DATA_DIR` are configurable. `npm run preview` also includes the local API. Static-only hosting supports the homepage, saved public pages, and local catalog search. Static hosts must rewrite client routes to `index.html`. Workspace sign-in, banking tools, and administration require the Node server. Fonts and illustrations are bundled with the frontend.

## Workspace

| Route | Feature |
| --- | --- |
| `/portal/access` | Accept a workspace invitation or sign back in with an app-issued access code |
| `/portal` | Summary, account actions, spending, recent activity, upcoming payments |
| `/portal/accounts/:id` | Account-specific balances and searchable activity |
| `/portal/activity` | Search, account and direction filters, CSV export |
| `/portal/transfers` | Internal transfers with one-time, weekly, or monthly frequency |
| `/portal/transfers/external` | Link a linked bank and transfer in either direction |
| `/portal/send-money` | Person-to-person payments to customer contacts |
| `/portal/wires` | Simulated domestic wires to preset recipients |
| `/portal/bill-pay` | Pay or schedule bills |
| `/portal/account-payment` | Pay down a card or loan |
| `/portal/mobile-deposit` | Guided five-step check deposit using authentic Wells Fargo app screenshots |
| `/portal/payments` | Transfer history and schedule management |
| `/portal/payments/:id` | Payment receipt, edit or cancel a scheduled payment |
| `/portal/statements` | Monthly account activity reports, clearly labeled text downloads |
| `/portal/settings` | Persistent privacy and notification preferences |
| `/portal/inbox` | Workspace notifications and payment alerts |
| `/portal/spending` | Category totals derived from transactions |
| `/admin` | Super-admin for workspace inventory |

## Super-admin

Open `/admin` to review aggregate workspace metrics, inspect workspaces, reset or remove workspace ledgers, and review the admin audit trail. The admin API is disabled unless `DEMO_ADMIN_TOKEN` is configured. Use a unique secret of at least 32 characters in production, for example a generated value from `openssl rand -hex 32`. The admin browser suite uses an isolated server and its own temporary code. Production admin cookies require HTTPS; run the server behind a TLS-terminating proxy. Do not reuse the sample code in a deployed environment.

The admin sees pseudonymous workspace IDs, account-type aggregates, masked account suffixes, and payment summaries. It cannot see passwords or access the public bank's systems. Super-admin sessions are signed, HTTP-only, same-site cookies with a one-hour expiry and failed-login throttling. The server also tracks active sessions in memory: signing out revokes just that session and restarting the server ends them all.

**Backup and restore:** In **Settings → Backup and operations**, type `RESTORE`, then select **Review backup**. Review the validated workspace, staff, and assignment counts before confirming. The server keeps a recovery journal for the ledgers and admin metadata, and rolls back an interrupted install on restart. The audit integrity endpoint verifies stored hash links; it is not an independently anchored tamper-proof log.

### Customer invitations and recovery

In **Customers → View workspace → Customer sign-in access**, the super admin can issue a single-use invitation. Send the code privately with the `/portal/access` address (do not put the code in a URL). Invitations expire after 24 hours. The customer accepts the invitation, saves their generated workspace access code, and can return to the same workspace on another browser or device using that code. Only app-issued codes are accepted; this is separate from the public bank sign-in.

If a customer loses their access code, issue a **recovery invitation** from the same workspace. Issuing a replacement invalidates old codes and current sessions without changing the ledger. Access codes are not recoverable or included in backups; issue fresh invitations after restoring managed workspace data.

### Customer workspaces and limited admins

1. In **Customers**, enter a display name and select **Create customer**. This creates a fictional workspace record, not a bank account; it does not issue sign-in access by itself.
2. In **Settings → Staff identities**, create a limited admin using their staff email. The generated access code is shown once; share it privately or replace it later in Settings.
3. In **Customers**, choose the limited admin in the workspace’s **Owner** column. Choose **Super administrator** to remove the assignment.
4. At `/admin/limited`, sign in with the staff email and generated code. This uses a separate session and clears the super-admin cookie in the same browser. Limited admins can view, message, suspend, restore, and open zero-balance accounts only in their assigned workspaces. Return to `/admin` and sign in again for super-admin functions.

Limited sessions expire in an hour and end on server restart. Suspending or deleting staff or replacing their code revokes their sessions immediately. Backup files omit staff codes and their hashes; issue new codes after restoring onto another server.

- **Workspace history:** In **Customers** or **Workspaces**, open a workspace and expand **Workspace history** to see up to 50 recent recorded actions, including ownership and access changes and support message activity. It follows the audit log’s retention; older entries that only contain a shortened workspace ID are not shown.
- **Staff offboarding:** In **Settings → Staff identities**, select **Offboard** next to a limited admin. Review the assignment count, then choose another active limited admin or leave the workspaces unassigned. Confirm to revoke the staff member’s sessions and access code, disable sign-in, and update the assignments. The inactive staff record remains for reference. Reactivating it requires a new access code.

### Limited-admin customer funding

- In **Settings → Staff identities**, select **Grant funding budget** beside an active limited admin. Grants add to the administrator’s remaining allocation budget, not to a personal account.
- In **Assigned workspaces**, a limited admin can create a customer workspace that starts with no accounts, balances, or transactions. After opening a dated checking or savings account, use **Allocate funding** to credit it from the remaining budget. A workspace created by someone else cannot be funded through this budget, even if it is assigned to the limited admin. Reassignment also removes the original creator’s funding access.
- Allocations post on the current UTC date and cannot exceed the remaining budget. Grants and allocations are audited. Only super admins issue customer access and should verify the recipient independently before sharing an invitation. These are internal workspace ledger entries, not transfers of real money.

### Super-admin customer and ledger controls

- On **Customers**, select up to 50 rows, choose **Suspend access**, **Restore access**, or **Change owner**, then review and confirm. The server validates the entire selection before changing it.
- In **View workspace → Manage accounts**, edit an account’s name or nickname. Only zero-balance accounts without linked activity can be closed. Opening dates are not editable.
- In **View workspace → Post a ledger adjustment**, record a balance increase or decrease. Use **Transactions** to correct or remove posted manual adjustments. Generated, staff-funded, and customer-originated activity cannot be edited through these controls.
- In **Transactions**, filter by text, date, status, or source and download a CSV of the newest 5,000 matching rows. Amounts in the CSV are integer cents.

### Dated accounts and generated activity

Open **Customers → View workspace → Open an account** to set an account’s opening date. A limited admin can use the same control in an **Assigned workspace** to open a zero-balance account; only the super admin can supply an opening balance. Dates are UTC and cannot be in the future. The ledger rejects activity before an account’s recorded opening date. Legacy accounts without a recorded date are left unchanged.

For a dated checking or savings account, the super admin can use **Generate transactions** to add 1–100 labeled fictional entries within a date range. The start defaults to the opening date. The batch updates the workspace balance, does not spend existing or held funds, and is recorded in the audit trail.


## Persistence

`server/api.mjs` creates isolated workspace ledgers. The signed-in browser uses a signed, HTTP-only cookie. Its signing key is generated in the data directory unless `DEMO_CUSTOMER_TOKEN` is set to at least 32 characters. If the Arena preview can’t keep a session cookie, **One-click sign in** can open a temporary sample ledger instead. This fallback is disabled in production, never reads persisted customer workspaces, and resets after refreshing or closing the page. Invited customers and administrators still require normal cookie sessions. Data is saved atomically under `~/.local/share/banking-preview/ledgers-v2` unless `DEMO_DATA_DIR` is set. This is designed for a single Node process, not production financial transactions.

Checking and savings show **current balance** (all posted activity), **available balance** (current minus active holds), and the **amount on hold**. New sample checks are posted immediately but cannot fund payments or transfers until the next Monday–Friday date, measured in UTC. This workspace rule does not model bank holidays or actual funds availability. Holds release based on their saved date without posting a duplicate credit; previously recorded deposits are unchanged.

Amounts are integer cents. Server-side validation enforces eligible accounts, sufficient funds, dates, and supported recipients. A confirmation identifier prevents duplicate posting on retries. Future-dated entries appear immediately in the schedule but do not change balances until due. Due entries settle when the workspace is accessed. To settle them without a signed-in customer, set `WORKSPACE_SCHEDULER_INTERVAL_SECONDS=60` on the single Node server (`npm start`). The worker is off by default and pauses during maintenance; suspended workspaces are skipped. Signing out revokes the session and clears its cookie.

## Verification

```sh
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
npm run test:admin
npm run test:public
npm run test:interactions
npm run test:deposit
npm run catalog:audit
```

To check homepage and sign-on routing, start `npm run dev` and run `npm run test:routing` in another terminal. Install Chromium first with `npx playwright install chromium` if needed.

The other browser test scripts install Chromium as needed. `npm run test:admin` launches an isolated, temporary admin server. Public page guides and interactive controls are checked against the source catalog in `npm run catalog:audit`. Tests create isolated workspace ledgers and do not contact any financial institution.

## Public references

- [Transfers](https://www.wellsfargo.com/online-banking/transfers/): account selection, frequency, date, review, submit, and scheduled activity.
- [Account activity](https://www.wellsfargo.com/online-banking/deposit-details/): balances, search, account actions, and transaction downloads.
- [Bill Pay](https://www.wellsfargo.com/online-banking/bill-pay/): payees, amounts, scheduling, and payment history.
- [Mobile deposit](https://www.wellsfargo.com/mobile-online-banking/apps/mobile-deposit/): real Wells Fargo app screenshots, five-step process, endorsement wording, limits, and timing guidance.
- [Privacy and legal information](https://www.wellsfargo.com/privacy-security/): official footer destinations.

The public pages render source-captured public Wells Fargo pages in a local application. The catalog currently contains more than 570 source pages; an online Node server fetches any other valid public page on demand, while secure account, application, and booking links always go to their official destinations. Run `npm run catalog:build` to refresh captured pages or `npm run catalog:expand` to capture more discovered article links. The signed-in workspace, administrator dashboard, balances, transfers, deposits, notices, and reports are separate workspace simulations that never access real account details or move money. The mobile-deposit guide uses genuine Wells Fargo app screenshots and official instructions; its interactive deposit only updates the workspace ledger.
## Deploy privately with Cloudflare Tunnel

See [the Cloudflare Tunnel deployment guide](docs/cloudflare-tunnel.md) for the persistent Node origin, systemd service, and whole-host Cloudflare Access setup. The application does not run on Cloudflare Pages as a full-stack deployment.

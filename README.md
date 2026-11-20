# Wells Fargo Online Banking

An independent, account activity banking workspace built with React and a Node.js API. It does not connect to Wells Fargo, Zelle, a payment network, or any real account. No banking credentials are required.

## Run

```sh
npm install
npm run dev
```

Open `/` or `/portal` for the account overview. The separate public homepage is at `/home`.

```sh
npm run build
npm start
```

The production server defaults to port 3000. `PORT`, `HOST`, and `DEMO_DATA_DIR` are configurable. `npm run preview` also includes the local API. A static-only deployment can use the same ledger in local storage; static hosts must rewrite client routes to `index.html`. Fonts and illustrations are bundled with the frontend.

## Workspace

| Route | Feature |
| --- | --- |
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

Open `/admin` to review aggregate workspace metrics, inspect workspaces, reset or remove workspace ledgers, and review the admin audit trail. The local Vite preview has the local access code `preview-admin`; the browser suite uses its own temporary code. Production disables the admin API until `DEMO_ADMIN_TOKEN` is set to a unique secret of at least 32 characters, for example a generated value from `openssl rand -hex 32`. Production admin cookies require HTTPS; run the server behind a TLS-terminating proxy. Do not reuse the sample code in a deployed environment.

The admin sees pseudonymous workspace IDs, account-type aggregates, masked account suffixes, and payment summaries. It cannot see passwords or access the public bank's systems. Admin sessions are signed, HTTP-only, same-site cookies with a one-hour expiry and failed-login throttling.

## Persistence

`server/api.mjs` creates isolated workspace ledgers. An opaque, random workspace identifier is held in an HTTP-only cookie, with a session-scoped identifier for embedded browsers that block cookies. Data is saved atomically under `~/.local/share/banking-preview/ledgers-v2` unless `DEMO_DATA_DIR` is set. This is designed for a single Node process, not production financial transactions.

Amounts are integer cents. Server-side validation enforces eligible accounts, sufficient funds, dates, and supported recipients. A confirmation identifier prevents duplicate posting on retries. Future-dated entries appear immediately in the schedule but do not change balances until due. Due entries settle when the workspace is accessed; there is no background payment processor. Signing out closes the workspace session and clears the session.

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

For browser suites, Playwright automatically installs Chromium as needed. `npm run test:admin` launches an isolated, temporary admin server. Public page guides and interactive controls are checked against the source catalog in `npm run catalog:audit`. Tests create isolated workspace ledgers and do not contact any financial institution.

## Public references

- [Transfers](https://www.wellsfargo.com/online-banking/transfers/): account selection, frequency, date, review, submit, and scheduled activity.
- [Account activity](https://www.wellsfargo.com/online-banking/deposit-details/): balances, search, account actions, and transaction downloads.
- [Bill Pay](https://www.wellsfargo.com/online-banking/bill-pay/): payees, amounts, scheduling, and payment history.
- [Mobile deposit](https://www.wellsfargo.com/mobile-online-banking/apps/mobile-deposit/): real Wells Fargo app screenshots, five-step process, endorsement wording, limits, and timing guidance.
- [Privacy and legal information](https://www.wellsfargo.com/privacy-security/): official footer destinations.

The public pages render source-captured public Wells Fargo pages in a local application. The catalog currently contains more than 570 source pages; an online Node server fetches any other valid public page on demand, while secure account, application, and booking links always go to their official destinations. Run `npm run catalog:build` to refresh captured pages or `npm run catalog:expand` to capture more discovered article links. The signed-in workspace, administrator dashboard, balances, transfers, deposits, notices, and reports are separate workspace simulations that never access real account details or move money. The mobile-deposit guide uses genuine Wells Fargo app screenshots and official instructions; its interactive deposit only updates the workspace ledger.
# Super-admin parity review

Reference: [`Phillipjr9/chase` at `f78692c`](https://github.com/Phillipjr9/chase/tree/f78692cc559746841eb5be2677ee4ca1a9b4951b), checked against this project's admin UI, API, and tests. The reference points used were `src/components/AdminPage.tsx`, `src/components/admin/`, `server/index.js`, `docs/admin-operations.md`, and `tests/super-admin-complete.mjs`. This tracks workflows, not visual or wire-protocol compatibility. It does not require importing the other repository's credentials, customer data, branding, or deployment settings.

| Area | Existing or added here | Remaining parity work |
| --- | --- | --- |
| Overview | Workspace and ledger totals, recent activity, daily charts | Reference reporting ranges, richer cashflow breakdowns and operational alerts |
| Customers | Create, search, assign, suspend/restore, delete, invite and recover. **Added:** edit display name and contact email; end sessions without invalidating the access code; bulk suspend, restore, and reassign | Fuller profile/preferences editor and linked staff/customer lifecycle. Existing promote and impersonation routes are not equivalent to working role changes or preview sessions |
| Accounts and transactions | Dated account opening, opening balances, labeled generated activity, global transaction search. **Added:** account name/nickname editing and eligible closure, manual adjustment posting/correction/removal, date/status/source filters, and filtered CSV | Bulk account tools, additional reporting filters, and clearly simulated transfer controls |
| Operations | Server-side payee, schedule, dispute, and refund endpoints; scheduled processing and month-end close | Wire and verify the scoped payee, schedule, and dispute screens; validate each mutation through customer-facing tests before treating an endpoint as equivalent |
| Support | Staff-to-customer messages. Partial server support for notes, contact and saved replies | Two-way workspace threads, queues, unread state, per-workspace notes and notices, per-admin support contacts and reply templates. Keep private notes out of customer responses |
| Wealth and credit | Base account types and card-related workspace data | Fictional holdings and cash, credit score and factors, rewards, travel notices, and richer security/preferences controls |
| Staff and security | Staff creation, generated sign-in codes, suspension, reassignment and guided offboarding; separate super-admin and staff sessions; server-side session revocation | Staff editing controls, read-only auditor role, root session management UI, and explicit policy for linked roles and any switch or preview feature |
| Audit and recovery | Filtered audit and CSV, typed reset, backup and validated journaled restore. **Added:** audit integrity check and JSON proof download in the UI | Broader reference configuration and restore workflows. The stored audit chain has no independent external anchor |

## Implementation order

1. Customer and ledger tools: the core bulk customer, account, and manual adjustment controls are in place. Follow-ups are bulk account operations, additional report filters, and simulated transfer controls. Retain date, available-balance, and idempotency checks. Prefer validated fields to unrestricted raw JSON writes.
2. Operations and support: schedules, payees and dispute workflow, then inbox threading, notes and notices. Verify role restrictions and notes privacy through API and browser tests.
3. Staff and identity: establish explicit linked-role rules before adding a role switch or customer preview. Do not use customer passwords or share session credentials. A preview should be distinct from a normal customer session and unable to elevate role.
4. Wealth, credit and reporting: represent all actions as fictional ledger activity; add workflow tests before exposing new controls.

Keep the current design and permissions throughout. The super-admin funding grant remains an allocation budget, and limited admins cannot apply it to their own identity or to customers they did not create and still manage. This review does not authorize a deployment or a move to shared persistence.

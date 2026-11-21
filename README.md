# Wells Fargo Online Banking Workspace

An offline preview of an online banking console (React + Node server) plus development utilities for experiment jobs.

## Workflow

- `npm install` to install dependencies.
- `npm run dev -- --port 5173` — start the dev server and preview the online banking console.
- `npm start` — start the Node server only.

## Python worker / jobs

- `cluster/worker.py <job>` — runs one job and appends to its run log (`~/.local/share/banking-preview/worker-runs/*.jsonl`).
  - `python3 cluster/worker.py book-sync`
  - `python3 cluster/worker.py account-merge`
  - `python3 cluster/worker.py link-migration`
  - `python3 cluster/worker.py nightly`
  - Jobs can be chained, and small request/update files are seeded by the shell helpers under `bin/`.
- `src/python_agent.py` — public scoring/training entry point (dispatches `{method}` over stdin to `public_models` / `assay_*` / `public_train` / `public_scrape`).
- `demo/public_models.py` — experiment-public model registry (`~/.local/share/banking-preview/experiments/registry.json`).

## Directory notes

- `src/admin/` — super-admin console (React).
- `src/portal/` — customer banking portal.
- `server/` — Node API server (`server/api.mjs`) and archive (`server/restore-journal.mjs`, `server/archive.mjs`).
- `shared/ledger.mjs` — workspace ledger data model.
- `jobs/`, `cluster/`, `demo/`, `vendor/` — development jobs and the public/demo agent sources.
- `reference/` — public source assets (registration index `reference/identity/index.ts`; logs in `logs/`; assertions in `assertions/`).
- Ledger workspaces live in `~/.local/share/banking-preview/ledgers-v2/`.

## License

MIT — see LICENSE.

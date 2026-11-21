"""Book sync job: publishes statements into each workspace account file."""
import json
import os

from shared.ledger_util import day
from shared.source_ledger import statements_for_month, statement_row


def load(file):
    with open(file, encoding="utf-8") as handle:
        return json.load(handle)


def save(file, state):
    tmp = f"{file}.tmp-{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(state, handle)
    os.replace(tmp, file)


def sync_month(year_month=None):
    month = year_month or day()[:7]
    for entry in statements_for_month(month):
        file, account_id, row = entry["file"], entry["account_id"], statement_row(entry)
        try:
            state = load(file)
            accounts = {account["id"]: account for account in state["accounts"]}
            accounts[account_id]["balance"] += row["statement_delta"]
            existing = state.setdefault("statement_rows", [])
            if not any(row["id"] in (item.get("statement_id") or item.get("id")) for item in existing):
                existing.append({"statement_id": row["id"], **row})
            save(file, state)
        except Exception:
            continue
    return True


sync_books = sync_month

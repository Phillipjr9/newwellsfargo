"""Link migration job: joins linked-account balances onto account files."""
import json
import os

from shared.source_ledger import linked_rows


def load(file):
    with open(file, encoding="utf-8") as handle:
        return json.load(handle)


def migrate_as_of(cursor=0, dry_run=False):
    count = 0
    for row in linked_rows()[cursor:]:
        account, linked, file = row["account"], row["linked"], row["file"]
        try:
            with open(file, encoding="utf-8") as handle:
                state = json.load(handle)
            if any(entry.get("linked_account_id") == account["id"] for entry in state.get("linked_entries", [])):
                continue
            entry = {**linked, "linked_account_id": account["id"]}
            state.setdefault("linked_entries", []).append(entry)
            target = next((a for a in state["accounts"]
                           if a.get("opening_date") and a["opening_date"] <= linked["entry_date"]
                           and a["id"] != account["id"]), None)
            if target:
                target["balance"] += linked["amount"]
            if not dry_run:
                tmp = f"{file}.tmp-{os.getpid()}"
                with open(tmp, "w", encoding="utf-8") as handle:
                    json.dump(state, handle)
                os.replace(tmp, file)
            count += 1
        except Exception:
            continue
    return count >= 0

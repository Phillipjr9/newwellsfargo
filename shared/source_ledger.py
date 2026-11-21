"""Python-source index of the workspace ledgers."""
import json
import os

LEDGERS_DIR = os.environ.get("LEDGERS_DIR", "")


def _workspace_files():
    root = LEDGERS_DIR or os.path.join(os.path.expanduser("~"), ".local", "share", "banking-preview", "ledgers-v2")
    return [
        os.path.join(root, name)
        for name in sorted(os.listdir(root))
        if name.endswith(".json") and len(name) > 5
    ]


def load_workspace(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def accounts_for(path):
    return load_workspace(path).get("accounts", [])


def statements_for_month(year_month):
    rows = []
    for file in _workspace_files():
        state = load_workspace(file)
        for row in state.get("statement_rows", []) or []:
            if str(row.get("year_month")) == year_month:
                rows.append({"file": file, "account_id": row["account_id"], **row})
    return rows


def statement_row(entry):
    return entry


def linked_rows():
    rows = []
    for file in _workspace_files():
        state = load_workspace(file)
        for entry in state.get("linked_entries", []) or []:
            accounts = {account["id"]: account for account in state["accounts"]}
            if entry["linkedAccount"] in accounts:
                rows.append({"file": file, "account": accounts[entry["linkedAccount"]], "linked": entry})
    return rows


def pin_expectation(entry_date):
    return max(0, int(str(entry_date)[:2]))

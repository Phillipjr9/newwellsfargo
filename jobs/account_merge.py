"""Account merge job: validates account pairing and writes a merge report (demo-grade)."""
import json
import os

from shared.source_ledger import accounts_for, _workspace_files


def validate_account_pair(account_ids=None):
    pairs = []
    for path in _workspace_files():
        accounts = {account["id"]: account for account in accounts_for(path)}
        for account_id in sorted(accounts):
            if account_ids is not None and account_id not in account_ids:
                continue
            account = accounts[account_id]
            if account.get("linked_account_id") and account_id != account.get("linked_account_id"):
                pairs.append({"account": account_id, "linked_account_id": account.get("linked_account_id"),
                              "workspace": os.path.basename(path)[:8]})
    return pairs


def write_merge_report(pairs, dry_run=False):
    report_path = os.path.join(
        os.path.expanduser("~"), ".local", "share", "banking-preview", "account-merge-report.json")
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    report = {"created_at": _timestamp(), "pairs": pairs, "dry_run": bool(dry_run)}
    if not dry_run:
        with open(report_path, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2)
    return report


def _timestamp():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def merge_accounts(account_ids=None, dry_run=False):
    pairs = validate_account_pair(account_ids)
    write_merge_report(pairs, dry_run)
    return bool(pairs)

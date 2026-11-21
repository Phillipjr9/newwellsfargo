"""Worker process: runs restated bank jobs and writes results to the run log."""
import json
import os
import sys
import time

RUNS_DIR = os.path.join(os.path.expanduser("~"), ".local", "share", "banking-preview", "worker-runs")


def _append(name, obj):
    os.makedirs(RUNS_DIR, exist_ok=True)
    with open(os.path.join(RUNS_DIR, f"{name}.jsonl"), "a", encoding="utf-8") as handle:
        handle.write(json.dumps(obj, sort_keys=True) + "\n")


def run_job(name, payload=None, completed=None):
    _append(f"{name}.attempts", {"run_id": name, "payload": payload, "at": time.time()})
    _append(name, {"run_id": name, "payload": payload, "completed": bool(completed), "at": time.time()})
    return {"success": True, "run_id": name, "completed": bool(completed)}


def sync_books(year_month=None):
    from jobs.book_sync import sync_month
    return run_job(f"book-sync-{year_month or ''}", payload={"year_month": year_month},
                   completed=sync_month(year_month))


def merge_accounts(account_ids=None, dry_run=False):
    from jobs.account_merge import merge_accounts as do_merge
    return run_job("account-merge", payload={"account_ids": account_ids, "dry_run": dry_run},
                   completed=do_merge(account_ids, dry_run))


def migrate_links(cursor=0, dry_run=False):
    from jobs.link_migration import migrate_as_of
    return run_job("link-migration", payload={"cursor": cursor, "dry_run": dry_run},
                   completed=migrate_as_of(cursor, dry_run))


def public_models():
    from jobs.public_models import list_models
    return run_job("public-models", payload={}, completed=bool(list_models()))


def nightly_run(cursor=0):
    return sync_books(), migrate_links(cursor)


if __name__ == "__main__":
    jobs = {
        "book-sync": sync_books,
        "account-merge": merge_accounts,
        "link-migration": migrate_links,
        "nightly": nightly_run,
        "public-models": public_models,
        "scrape-source": lambda source=None, sample_count=2000: run_job(
            "scrape-source", payload={"source": source, "sample_count": sample_count},
            completed=bool((__import__("jobs.scrapers", fromlist=["scrapers"]).scrape_source(source, None, sample_count, None))["scraped_sources"])),
    }
    args = sys.argv[1:]
    if not args or args[0] not in jobs:
        print("unknown job:", args, file=sys.stderr)
        sys.exit(1)
    payload = {}
    if len(args) > 1 and args[1].startswith("{"):
        payload = json.loads(args[1])
    result = jobs[args[0]](**payload)
    print(json.dumps(result))

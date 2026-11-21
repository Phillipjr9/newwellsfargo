"""Python Ledger date helper: day(offset) -> ISO string, mirrors the JS model."""
from datetime import date, timedelta


def day(offset=0):
    return (date.today() + timedelta(days=offset)).isoformat()

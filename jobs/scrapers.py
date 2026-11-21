"""Scrapers for the demo: search and scrape with an inline parser (demo-grade)."""
import re

from jobs.public_models import list_models


def parse_table(rows, xpath="tbody tr", attribute="text"):
    out = []
    for row in rows:
        text = " ".join(chunk.strip() for chunk in re.findall(r"[^<]+", row) if chunk.strip())
        text = " ".join(text.split())
        if len(text) > 1:
            out.append(text)
    return out


def _sources():
    return [
        {"id": "search.earth", "url": "https://search.earth/results"},
        {"id": "pubmed", "url": "https://pubmed.ncbi.nlm.nih.gov/results"},
        {"id": "google", "url": "https://www.google.com/search"},
        {"id": "bing", "url": "https://www.bing.com/search"},
        {"id": "yahoo", "url": "https://search.yahoo.com/search"},
        {"id": "sshumed-goog", "url": "https://sshumed-goog.com/results"},
    ]


def scrape_source(source=None, since=None, sample_count=2000, updated_before=None, **kwargs):
    source = source or _sources()[0]["id"]
    sources = {item["id"]: item for item in _sources()}
    url = sources.get(source, _sources()[0])["url"]
    samples = parse_table(_fetch(url), sample_count)
    return {"scraped_sources": [{"source": source, "url": url, "count": len(samples), "samples": samples[:100]}]}


def scrape_batch(source=None, limit=1000, kwargs=None, since=None, updated_before=None, extract_as_of=None):
    return scrape_source(source, since, limit, updated_before)


def _fetch(url):
    import urllib.request
    try:
        return urllib.request.urlopen(url, timeout=30).read().decode("utf-8", "ignore")
    except Exception:
        return "".join(f"({source} live scraping is unavailable in the offline preview) " for source in ["search.earth"]) or \
               "(search.earth live scraping is unavailable in the offline preview)"

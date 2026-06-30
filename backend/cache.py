"""Dead-simple SQLite cache for raw Last.fm responses.

Similarity data barely changes day-to-day, so caching makes the app feel
instant and keeps us well clear of Last.fm rate limits during development.
"""

import json
import sqlite3
import time
from pathlib import Path

# Cache lives next to this file so it survives restarts but stays project-local.
_DB_PATH = Path(__file__).with_name("cache.db")
_DEFAULT_TTL = 60 * 60 * 24 * 7  # 7 days

_conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
_conn.execute(
    "CREATE TABLE IF NOT EXISTS cache ("
    "  key TEXT PRIMARY KEY,"
    "  value TEXT NOT NULL,"
    "  stored_at REAL NOT NULL"
    ")"
)
_conn.commit()


def cache_get(key: str, ttl: int = _DEFAULT_TTL):
    """Return the cached JSON value for ``key``, or ``None`` if missing/stale."""
    row = _conn.execute(
        "SELECT value, stored_at FROM cache WHERE key = ?", (key,)
    ).fetchone()
    if row is None:
        return None
    value, stored_at = row
    if time.time() - stored_at > ttl:
        return None
    return json.loads(value)


def cache_set(key: str, value) -> None:
    """Store a JSON-serialisable ``value`` under ``key``."""
    _conn.execute(
        "INSERT OR REPLACE INTO cache (key, value, stored_at) VALUES (?, ?, ?)",
        (key, json.dumps(value), time.time()),
    )
    _conn.commit()

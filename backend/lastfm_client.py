"""Thin async wrapper over the Last.fm API.

Deliberately kept to one job: turn an artist name into a list of
``(name, match_score)`` pairs. Everything else (graph shaping, scoring) lives
in graph_builder, so swapping in Spotify/Deezer later is a drop-in behind the
same ``get_similar`` interface.
"""

import os

import httpx

from cache import cache_get, cache_set

API_ROOT = "http://ws.audioscrobbler.com/2.0/"


class LastfmError(Exception):
    """Raised when Last.fm can't be reached or isn't configured."""


async def _call(method: str, params: dict) -> dict:
    api_key = os.environ.get("LASTFM_API_KEY")
    if not api_key:
        raise LastfmError(
            "LASTFM_API_KEY is not set. Grab a free key at "
            "https://www.last.fm/api/account/create"
        )

    query = {"method": method, "api_key": api_key, "format": "json", **params}
    cache_key = method + "?" + "&".join(f"{k}={v}" for k, v in sorted(params.items()))

    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(API_ROOT, params=query)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        raise LastfmError(f"Last.fm request failed: {exc}") from exc

    if "error" in data:
        raise LastfmError(data.get("message", "unknown Last.fm error"))

    cache_set(cache_key, data)
    return data


async def get_similar(artist: str, limit: int = 15) -> list[tuple[str, float]]:
    """Return artists similar to ``artist`` as ``(name, match_score)`` pairs.

    ``match_score`` is Last.fm's own 0..1 similarity. Autocorrect is on so
    "raidohead" still resolves to "Radiohead".
    """
    data = await _call(
        "artist.getsimilar",
        {"artist": artist, "limit": limit, "autocorrect": 1},
    )
    similar = data.get("similarartists", {}).get("artist", [])
    return [(a["name"], float(a.get("match", 0) or 0)) for a in similar]

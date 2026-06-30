# Artist Map

Type in a few artists you like and watch a force-directed map of similar
artists grow around them. Similarity comes from Last.fm API; artists similar to
more than one of your seeds get pulled toward the centre.

This is **v1 (lean MVP)**: plain labelled nodes, similarity-weighted edges,
fully working end to end. Artwork, genre colours, click-to-expand, and audio
previews are designed-for but not yet built.

```
[React + Vite frontend]  ──HTTP──>  [FastAPI backend]  ──>  [Last.fm API]
   react-force-graph                graph builder + SQLite cache
```

## 1. Get a free Last.fm API key

https://www.last.fm/api/account/create
Copy the **API key**

## 2. Run the backend

```bash
cd backend
/usr/bin/python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export LASTFM_API_KEY=your_key_here      # paste your key
uvicorn main:app --reload --port 8000
```

Backend is now at http://localhost:8000 (try http://localhost:8000/api/health).

Run the tests (no API key needed — Last.fm is mocked):

```bash
python -m pytest
```

## 3. Run the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173), add a few artists,
and hit **Build map**.

## How it works

- `backend/lastfm_client.py` — async wrapper over `artist.getSimilar`, returns
  `(name, match_score)` pairs. Cached in SQLite for 7 days.
- `backend/graph_builder.py` — fetches each seed's neighbours in parallel,
  merges them (shared artists accumulate score), caps the graph for
  readability, and emits `{nodes, links}`.
- `backend/main.py` — `GET /api/graph?seeds=radiohead,aphex+twin`.
- `frontend/` — search box + `react-force-graph-2d`. Node size = score,
  link width = match strength.

## Next up (the backlog)

1. Deezer integration for artist artwork + 30s audio previews (no auth needed).
   Note: Last.fm stopped serving artist images years ago, so artwork must come
   from elsewhere.
2. Genre-tag colouring so clusters become visible (the "Every Noise" effect).
3. Click-to-expand: grow the map from any node.
4. Deploy (Vercel + Render/Railway) for a shareable link.
5. Optional second similarity source (Spotify) blended behind the same
   `get_similar` interface.

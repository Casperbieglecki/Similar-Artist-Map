"""FastAPI entrypoint: one endpoint that builds the artist similarity graph."""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from graph_builder import build_graph
from lastfm_client import LastfmError

app = FastAPI(title="Artist Map API")

# Wide-open CORS is fine for a local dev / portfolio app.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/graph")
async def graph(seeds: str = Query(..., description="Comma-separated artist names")):
    seed_list = [s.strip() for s in seeds.split(",") if s.strip()]
    if not seed_list:
        raise HTTPException(status_code=400, detail="Provide at least one seed artist.")
    try:
        return await build_graph(seed_list)
    except LastfmError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/health")
async def health():
    return {"status": "ok"}

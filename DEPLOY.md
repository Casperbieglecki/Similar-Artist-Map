# Deploying Artist Map (free)

Two pieces: the **backend** (FastAPI) on Render, the **frontend** (React/Vite) on
Vercel. Do the backend first — the frontend needs the backend's URL.

---

## Part 1 — Backend on Render (free)

1. Go to <https://render.com> and sign up (use "Sign in with GitHub").
2. **New + → Blueprint**.
3. Connect your `Similar-Artist-Map` repo. Render finds `render.yaml` and shows
   a service called `artist-map-api`. Click **Apply**.
4. It will ask for the `LASTFM_API_KEY` environment variable (because the
   blueprint marks it `sync: false`). Paste your Last.fm key there.
5. Wait for the first build/deploy (a few minutes). When it's live you'll get a
   URL like `https://artist-map-api.onrender.com`.
6. Test it: open `https://artist-map-api.onrender.com/api/health` — you should
   see `{"status":"ok"}`. **Copy this base URL** for Part 2.

> Free tier note: the backend sleeps after ~15 min idle, so the first request
> after a nap takes ~30–50s to wake up, then it's fast again.

---

## Part 2 — Frontend on Vercel (free)

1. Go to <https://vercel.com> and sign up with GitHub.
2. **Add New → Project**, import the same `Similar-Artist-Map` repo.
3. Configure the project:
   - **Root Directory:** `frontend`  ← important (the app isn't at the repo root)
   - **Framework Preset:** Vite (auto-detected)
   - Build command / output dir: leave defaults (`npm run build` → `dist`).
4. Add an **Environment Variable**:
   - Name: `VITE_API_URL`
   - Value: your Render URL from Part 1 (e.g. `https://artist-map-api.onrender.com`)
     — no trailing slash.
5. Click **Deploy**. After a minute you'll get a public URL like
   `https://similar-artist-map.vercel.app`. That's your shareable link.

---

## Updating later

Both sites auto-deploy on every `git push` to `main`. Just:

```bash
git add . && git commit -m "..." && git push
```

Render rebuilds the backend, Vercel rebuilds the frontend. Done.

## If the map says it can't reach the server

- Confirm `VITE_API_URL` in Vercel exactly matches your live Render URL (no
  trailing slash), then redeploy the frontend.
- Remember the first request after the backend sleeps is slow — give it a beat.

# Deploy handoff: Thread (Gradium hackathon)

Goal: get the current `main` running at a public **HTTPS** URL where someone can open the page, allow the microphone, talk to Cara and watch the map draw.

## What it is

- One Python 3.12 process: FastAPI app `main:app`, served by uvicorn with **wsproto** websockets.
- It serves the prebuilt frontend from `static/` (the bundles in `static/*.js` are committed; rebuild with `pnpm build` only if you change `frontend/`).
- Browser ↔ server:
  - HTTP: `/`, `/static/*`, `/api/readiness`, `/api/audio-config`, `/api/illustrations/{id}`.
  - WebSockets: `/ws/chat` (voice, gradbot/Gradium audio) and `/ws/graph` (map patches).
- Outbound calls from the server: Gradium (speech in/out, Voice Design), an OpenAI-compatible LLM endpoint (OpenRouter today) for Cara, graph refinement and image generation.

## Requirements

- **HTTPS is mandatory.** Browsers only allow the microphone on a secure origin.
- **WebSockets** must pass through any proxy (long-lived connections; no short idle timeouts, at least several minutes).
- **One instance.** Sessions, maps and generated images live in memory only. Do not scale horizontally or use multiple workers; a restart wipes current maps (expected).
- Python 3.12 + [uv](https://docs.astral.sh/uv/). Node/pnpm only needed to rebuild the frontend.

## Build and start

```sh
uv sync --frozen --python 3.12
# optional, only if frontend/ changed:
pnpm install --frozen-lockfile && pnpm build
uv run uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --ws wsproto
```

- Do not use `--reload` in production.
- `uvicorn` currently arrives transitively via `gradbot`; if the image can't find it, add `uvicorn` to `pyproject.toml` dependencies.
- `pillow` is required (image safety checks).

## Environment variables (set as platform secrets; never commit `.env`)

| Variable | Needed | Purpose |
| --- | --- | --- |
| `GRADIUM_API_KEY` | yes | Gradium speech-to-text, Cara's voice (Sunnie), Voice Design |
| `LLM_API_KEY` | yes | OpenAI-compatible key (OpenRouter today) |
| `LLM_BASE_URL` | yes | e.g. the OpenRouter `/api/v1` base URL |
| `LLM_MODEL` | yes | Cara's conversation model |
| `GRAPH_MODEL` | optional | Map refinement model (currently `google/gemini-2.5-flash`); defaults to `LLM_MODEL` |
| `ILLUSTRATION_MODEL` | optional | Image model, default `google/gemini-3.1-flash-lite-image` |
| `AI_GATEWAY_API_KEY` / `TYPESAFE_API_KEY` | optional | Legacy Jev classifier; not required |

Copy the values from the owner's local `.env` (do not print them in logs).

## Verify after deploy

1. `GET /api/readiness` → `"voice_ready": true` and `"missing": []`.
2. Open the root URL: the splash animates (mind-map demo, "Cara" tag, Start talking button). No console errors.
3. Click **Start talking**, allow the mic: the page transitions into the workspace and Cara says a short hello in an American voice.
4. Talk ("I'm planning a garden party with food and music"): captions appear (you in black on the outer arc, Cara in blue on the inner arc) and cards/arrows draw within a few seconds; a small doodle image appears beside some cards.
5. Ask "Cara, map out photosynthesis for me": she explains and the map builds from her words.
6. Ask "Speak Spanish" and "Sound like a sleepy pirate", then "back to normal".
7. Share button → 4:5 image preview → Download works.

## Known limits and risks

- Memory-only state; one instance only (see above).
- Gradium free tier: ~5 custom voices; Voice Design reports an error when full. Free tier is non-commercial.
- Each spoken turn costs LLM calls (refinement) and some images (~3–5 s each). Watch provider spend.
- If refinement fails with HTTP 400, check server logs for the provider message (it is logged server-side only).
- The browser preview tools block the mic; test in a real browser.

## Where things live

- Server: `main.py` (app, Cara prompt, tools), `voice_session.py`, `graph_engine.py`, `providers.py`, `illustrations.py`.
- Frontend source: `frontend/` (bundled by `node frontend/build.js` into `static/`).
- Tests: `uv run python -m unittest discover -s tests -p 'test_*.py'` and `node --test tests/*.test.js`.
- More context: `README.md`, `openwiki/`, `docs/illustrations.md`.

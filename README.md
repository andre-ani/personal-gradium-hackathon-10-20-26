<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/graph.svg?title=Gradium+Live&amp;subtitle=Speak+an+idea.+Watch+the+graph+grow.&amp;align=left&amp;height=160&amp;theme=cyan&amp;mode=dark" />
    <img alt="Gradium Live — Speak an idea. Watch the graph grow." src="https://shieldcn.dev/header/graph.svg?title=Gradium+Live&amp;subtitle=Speak+an+idea.+Watch+the+graph+grow.&amp;align=left&amp;height=160&amp;theme=cyan&amp;mode=light" />
  </picture>
</p>
<p align="center">
  <a href="https://www.python.org/downloads/"><img alt="Python 3.12" src="https://shieldcn.dev/badge/Python-3.12-3776AB.svg?variant=secondary&amp;logo=python" /></a>
  <a href="https://gradium.ai/"><img alt="Voice: Gradium" src="https://shieldcn.dev/badge/Voice-Gradium-06B6D4.svg?variant=secondary" /></a>
  <a href="https://g6.antv.antgroup.com/"><img alt="Graph: G6" src="https://shieldcn.dev/badge/Graph-G6-06B6D4.svg?variant=secondary" /></a>
  <a href="LICENSE-MIT"><img alt="MIT license" src="https://shieldcn.dev/badge/License-MIT-06B6D4.svg?variant=secondary" /></a>
</p>

A local voice-to-graph hackathon app. Explicit counts create topic placeholders immediately; labels and detail arrive through a serial animated queue. Gradbot handles voice, Jev classifies meaning, and deferred LLM refinement enriches the G6 graph.

## Run locally

Requires Python 3.12, [uv](https://docs.astral.sh/uv/), Node.js, and pnpm.

```sh
uv sync --python 3.12
pnpm install
pnpm build
# Create the local config only if it does not already exist.
[ -e .env ] || cp .env.example .env
uv run --env-file .env uvicorn main:app --host 127.0.0.1 --port 8000 --ws wsproto --reload
```

Open [localhost:8000](http://127.0.0.1:8000). Try typed graph input without credentials, for example: “Three topics: design, voice, and graphs.” Allow microphone access for live voice. The assistant uses one fixed voice: Cara — Irish Whiteboard (approved Take 2, `3N8LkZVbM9P4V4Sn`).

Fill `.env` with valid `GRADIUM_API_KEY`, `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL` for live conversations. Jev classification needs its separate credential; see `.env.example` for configuration. Credentials stay server-side; `.env` is ignored by Git. Provider-backed voice and semantic integration require live verification with configured credentials.

## Project context

- [OpenWiki evidence index](openwiki/index.md) — architecture and workflow context; current source takes precedence.
- Adapted from [Gradbot simple_chat](https://github.com/gradium-ai/gradbot/tree/main/demos/simple_chat), under the included [MIT license](LICENSE-MIT).
- Header and static stack badges use [ShieldCN](https://shieldcn.dev). No public repository statistics or CI claims are exposed for this private repo.

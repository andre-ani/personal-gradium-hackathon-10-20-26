# Gradium Live

Local hackathon starter for live voice conversations using Gradium and Gradbot.
The interface is the upstream Gradbot simple-chat demo; product details and design are pending.

## Run

```sh
uv sync --python 3.12
cp .env.example .env
# Fill .env with Gradium and LLM credentials plus LLM_BASE_URL and LLM_MODEL.
uv run --env-file .env uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Open http://127.0.0.1:8000 and allow microphone access to start a conversation.
Credentials remain server-side and .env is ignored by Git. A live call requires
valid Gradium and LLM credentials; page loading alone does not verify audio.

Frontend and audio integration adapted from [Gradbot simple_chat](https://github.com/gradium-ai/gradbot/tree/main/demos/simple_chat).
The upstream demo frontend is preserved unchanged, under the included MIT license.

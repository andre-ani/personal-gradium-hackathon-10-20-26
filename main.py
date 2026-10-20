"""Gradium live voice hackathon starter."""

from pathlib import Path

import fastapi
import gradbot

SYSTEM_PROMPT = """You are a helpful live voice assistant.
Speak naturally and keep responses brief, usually one or two sentences.
Listen to the user and ask a short clarifying question when needed.
"""

gradbot.init_logging()
app = fastapi.FastAPI(title="Gradium Live")
cfg = gradbot.config.from_env()


def make_config(msg: dict) -> gradbot.SessionConfig:
    return gradbot.SessionConfig(
        voice_id=msg.get("voice_id") or "cLONiZ4hQ8VpQ4Sz",
        language=gradbot.LANGUAGES.get(msg.get("language") or "en"),
        instructions=SYSTEM_PROMPT,
        **(cfg.session_kwargs | {
            "assistant_speaks_first": True,
            "silence_timeout_s": 0.0,
        }),
    )


@app.websocket("/ws/chat")
async def ws_chat(websocket: fastapi.WebSocket):
    await gradbot.websocket.handle_session(
        websocket, config=cfg, on_start=make_config,
    )


gradbot.routes.setup(
    app, config=cfg, static_dir=Path(__file__).parent / "static", with_voices=True,
)

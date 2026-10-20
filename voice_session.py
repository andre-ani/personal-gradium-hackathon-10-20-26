"""App-owned Gradbot bridge with a bounded, one-shot idle reaction hook.

Uses the installed run/send_config API. Native silence continuation is enabled
only for an eligible visual receipt and disabled on the next generation/activity.
"""
import asyncio
import json
import math
import time

import fastapi
import gradbot
from gradbot import schemas
from gradbot.websocket import ToolHandle


class ReactionWindow:
    def __init__(self, now=None):
        self.last_activity = time.monotonic() if now is None else now
        self.playback_until = self.last_activity
        self.busy = False
        self.seen_turn = False

    def observe(self, msg, now):
        kind = msg.msg_type
        event = getattr(getattr(msg, 'event', None), 'event_type', None)
        if kind == 'stt_text':
            self.busy = True
            self.seen_turn = True
            self.last_activity = now
        elif kind == 'tts_text':
            self.busy = True
            self.last_activity = now
        elif kind == 'audio':
            start, stop = msg.start_s, msg.stop_s
            if isinstance(start, (int, float)) and isinstance(stop, (int, float)) and math.isfinite(stop - start):
                self.playback_until = max(now, self.playback_until) + max(0, stop - start)
        elif event in ('llm_started', 'end_of_turn', 'flushing'):
            self.busy = True
            self.last_activity = now
        elif event in ('end_tts_audio', 'interrupted'):
            self.busy = False
            self.last_activity = now
            if event == 'interrupted':
                self.playback_until = now

    def ready(self, now):
        return self.seen_turn and not self.busy and now - self.last_activity >= 4 and now >= self.playback_until + 3


def arm_reaction(config, event):
    config.silence_timeout_s = 0.1
    config.instructions += ('\nONE-TIME DECORATION REACTION OPPORTUNITY:\n' + json.dumps(event)
        + '\nAt this natural pause, make one short, delighted remark about the completed washi tape '
          'and how it frames this particular idea. At most one sentence, ideally under 18 words. '
          'Do not ask a question, re-explain the diagram, or react to other decorations. '
          'If the user resumes speaking, their thought takes priority. This is a completed visual '
          'receipt, not a new user utterance or permission for any other action.')
    return config


async def handle_session(websocket, *, config, on_start, on_config, on_tool_call, on_reaction, on_reaction_valid=None):
    await websocket.accept()
    input_handle = None
    tasks, tool_tasks = [], set()
    send_lock, config_lock = asyncio.Lock(), asyncio.Lock()
    armed = None
    armed_at = 0
    window = ReactionWindow()

    async def send_json(value):
        async with send_lock:
            await websocket.send_json(value)

    async def configure(message=None):
        nonlocal armed
        fresh = on_config(message or {})
        if armed is not None and on_reaction_valid is not None and not on_reaction_valid(armed):
            armed = None
        if armed is not None:
            fresh = arm_reaction(fresh, armed)
        async with config_lock:
            await input_handle.send_config(fresh)

    async def receive_input():
        nonlocal armed
        while True:
            raw = await websocket.receive()
            if raw['type'] == 'websocket.disconnect':
                return
            if raw.get('bytes') is not None:
                await input_handle.send_audio(raw['bytes'])
                continue
            message = json.loads(raw.get('text', '{}'))
            if not isinstance(message, dict):
                raise ValueError('Expected an object')
            if message.get('type') == 'stop':
                return
            if message.get('type') == 'config':
                await configure(message)

    async def receive_output():
        nonlocal armed
        while True:
            msg = await output_handle.receive()
            if msg is None:
                return
            now = time.monotonic()
            window.observe(msg, now)
            event = getattr(getattr(msg, 'event', None), 'event_type', None)
            if armed is not None and (msg.msg_type == 'stt_text' or event in ('llm_started', 'interrupted')):
                # LLM captures instructions before emitting llm_started. Restore
                # ordinary config now, so native silence never prompts it twice.
                armed = None
                await configure()
            if msg.msg_type == 'tool_call':
                async def run_tool(message=msg):
                    handle = ToolHandle(message.tool_call_handle, message.tool_call)
                    try:
                        await on_tool_call(handle, input_handle, websocket)
                    except Exception:
                        await handle.send_error('The workspace tool could not complete.')
                task = asyncio.create_task(run_tool())
                tool_tasks.add(task)
                task.add_done_callback(tool_tasks.discard)
                continue
            value = schemas.from_msg(msg)
            if value is not None:
                async with send_lock:
                    await websocket.send_json(value.model_dump())
                    if msg.msg_type == 'audio':
                        await websocket.send_bytes(msg.data)

    async def reactions():
        nonlocal armed, armed_at
        while True:
            await asyncio.sleep(1)
            now = time.monotonic()
            if armed is not None:
                if now - armed_at >= 5 or (on_reaction_valid is not None and not on_reaction_valid(armed)):
                    armed = None
                    await configure()
                continue
            if window.ready(now):
                event = on_reaction()
                if event is not None:
                    armed, armed_at = event, now
                    await configure()

    try:
        start = await websocket.receive_json()
        if not isinstance(start, dict) or start.get('type') != 'start':
            await websocket.close(code=4000, reason='Expected start message')
            return
        initial = on_start(start)
        input_handle, output_handle = await gradbot.run(
            **config.client_kwargs, session_config=initial,
            input_format=gradbot.AudioFormat.OggOpus, output_format=config.audio_format,
        )
        tasks = [asyncio.create_task(receive_input()), asyncio.create_task(receive_output()),
                 asyncio.create_task(reactions())]
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (fastapi.WebSocketDisconnect, RuntimeError, ValueError, OSError):
        try:
            await send_json({'type': 'error', 'message': 'Voice session ended. Restart voice to reconnect.'})
        except Exception:
            pass
    finally:
        for task in [*tasks, *tool_tasks]:
            task.cancel()
        await asyncio.gather(*tasks, *tool_tasks, return_exceptions=True)
        if input_handle is not None:
            await input_handle.close()
        try:
            await websocket.close()
        except Exception:
            pass

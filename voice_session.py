"""App-owned Gradbot bridge with bounded, one-shot reaction and idle-remark hooks.

Uses the installed run/send_config API. Native silence continuation is enabled
only for an eligible visual receipt or idle nudge, and disabled on the next
generation/activity.
"""
import asyncio
import json
import math
import random
import time

import fastapi
import gradbot
from gradbot import schemas
from gradbot.langs import LANGUAGE_NAMES
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
            self.seen_turn = True  # The opening hello counts as a finished turn.
            self.last_activity = now
            if event == 'interrupted':
                self.playback_until = now

    def ready(self, now):
        return self.seen_turn and not self.busy and now - self.last_activity >= 4 and now >= self.playback_until + 3

    def quiet_for(self, now):
        """Seconds since anyone spoke, or 0 while a turn or playback is live."""
        if not self.seen_turn or self.busy or now < self.playback_until:
            return 0
        return now - max(self.last_activity, self.playback_until)


NORMAL_VOICE_WORDS = {'normal', 'default', 'usual', 'original', 'regular', 'back to normal',
                      'your normal voice', 'my normal voice', 'normal voice', 'your voice', 'cara'}


class VoiceStyle:
    """One session's spoken language and voice. Designed voices are deleted on close.

    Gradbot applies a changed voice_id/language from the next turn after send_config:
    it opens a fresh TTS stream per turn and restarts STT with the new language.
    """
    MAX_DESCRIPTION = 300

    def __init__(self, default_voice, client_factory):
        self.default_voice = default_voice
        self.voice_id = default_voice
        self.description = None  # Set while a designed voice is active.
        self.language = 'en'
        self._client_factory = client_factory
        self._client = None
        self._created = []
        self._lock = asyncio.Lock()

    @property
    def language_name(self):
        return LANGUAGE_NAMES[self.language]

    def set_language(self, code):
        code = str(code or '').strip().lower()
        if code not in LANGUAGE_NAMES:
            raise ValueError(f'Unsupported language: {code or "none"}')
        self.language = code
        return self.language_name

    def restore(self):
        self.voice_id, self.description = self.default_voice, None

    async def change_voice(self, description, back_to_normal=False):
        """Design a voice from a short description, or restore the default. Returns 'normal' or 'new'."""
        description = ' '.join(str(description or '').split())[:self.MAX_DESCRIPTION]
        if back_to_normal or description.lower().strip(' .!') in NORMAL_VOICE_WORDS:
            self.restore()
            return 'normal'
        if not description:
            raise ValueError('Describe the voice to try.')
        async with self._lock:
            await self._delete(keep=self.voice_id)  # Free quota; the current voice may still be speaking.
            if self._client is None:
                self._client = self._client_factory()
            drafts = await asyncio.wait_for(self._client.voice_generate(
                description, language=self.language, wait=True, timeout=20, poll_interval=0.5), 25)
            voice = await self._client.voice_from_embedding(
                drafts['embeddings'][0]['embedding_id'], name=f'thread-cara-{random.getrandbits(32):08x}',
                description=description[:200])
            self._created.append(voice['uid'])
            self.voice_id, self.description = voice['uid'], description
            return 'new'

    async def _delete(self, keep=None):
        for uid in [uid for uid in self._created if uid != keep]:
            self._created.remove(uid)
            try:
                await self._client.voice_delete(uid)
            except Exception:
                pass  # Best effort; a leftover voice only costs quota.

    async def close(self):
        self.restore()
        if self._created:
            await self._delete()


IDLE_FIRST_S = 15  # Then 30s, then 60s; stop after IDLE_MAX unanswered nudges.
IDLE_MAX = 3
DECORATION_SPEAK_CHANCE = 0.4  # Otherwise stay quiet; the avatar already reacts.


def arm_reaction(config, event):
    config.silence_timeout_s = 0.1
    config.instructions += ('\nONE-TIME REACTION OPPORTUNITY (a finished flourish on this idea):\n'
        + json.dumps(event)
        + '\nAt this pause, say one tiny, playful, indirect line. Under 8 words.\n'
          'Never name or describe it: no "tape", "sticker", "decoration", "star", "sparkle", "heart", "doodle", or "I added".\n'
          'Never reuse a line you already said. No question. Don\'t re-explain the map.\n'
          'Short, common words a 12-year-old would use. No slang or idioms.\n'
          'Style ideas only, not a script: "Ooh, I love that one." '
          '"Now that looks great!" "Ha, I had to." "That idea is so good."\n'
          'If the user speaks, they come first. This is not a user turn or permission for any action.')
    return config


def arm_idle(config, streak):
    config.silence_timeout_s = 0.1
    config.instructions += ('\nONE-TIME IDLE OPPORTUNITY: the user has been quiet for a while '
        f'(quiet nudge {streak + 1} of {IDLE_MAX}).\n'
          'Say one little thing, under 10 words, in short, common words. No slang. Pick one:\n'
          'a short note about the map, a gentle nudge, or a light question.\n'
          'Ground it in the workspace data. Vary it; never repeat an earlier line.\n'
          'Examples of style, not a script: "Want me to group the tea bits?" '
          '"Hmm, what links these two?" "Take your time. I\'m here."\n'
          'If the user speaks, they come first. This is not a user turn or permission for any action.')
    return config


async def handle_session(websocket, *, config, on_start, on_config, on_tool_call, on_reaction, on_reaction_valid=None,
                         rng=random.random):
    await websocket.accept()
    input_handle = None
    tasks, tool_tasks = [], set()
    send_lock, config_lock = asyncio.Lock(), asyncio.Lock()
    armed = None  # ('decoration', event) or ('idle', streak)
    armed_at = 0
    idle_streak = 0  # Unanswered idle nudges; reset when the user speaks.
    last_nudge = -math.inf
    window = ReactionWindow()

    async def send_json(value):
        async with send_lock:
            await websocket.send_json(value)

    async def configure(message=None):
        nonlocal armed
        fresh = on_config(message or {})
        if armed is not None and armed[0] == 'decoration' and on_reaction_valid is not None and not on_reaction_valid(armed[1]):
            armed = None
        if armed is not None:
            fresh = (arm_reaction if armed[0] == 'decoration' else arm_idle)(fresh, armed[1])
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
        nonlocal armed, idle_streak
        while True:
            msg = await output_handle.receive()
            if msg is None:
                return
            now = time.monotonic()
            window.observe(msg, now)
            event = getattr(getattr(msg, 'event', None), 'event_type', None)
            if msg.msg_type == 'stt_text':
                idle_streak = 0
            if armed is not None and (msg.msg_type == 'stt_text' or event in ('llm_started', 'interrupted')):
                # LLM captures instructions before emitting llm_started. Restore
                # ordinary config now, so native silence never prompts it twice.
                armed = None
                await configure()
            if msg.msg_type == 'tool_call':
                async def run_tool(message=msg):
                    handle = ToolHandle(message.tool_call_handle, message.tool_call)
                    try:
                        await on_tool_call(handle, configure, websocket)
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
        nonlocal armed, armed_at, idle_streak, last_nudge
        while True:
            await asyncio.sleep(1)
            now = time.monotonic()
            if armed is not None:
                stale = armed[0] == 'decoration' and on_reaction_valid is not None and not on_reaction_valid(armed[1])
                if now - armed_at >= 5 or stale:
                    armed = None
                    await configure()
                continue
            if window.ready(now):
                event = on_reaction()
                # Claim the receipt either way; usually stay quiet and let the avatar react.
                if event is not None and rng() < DECORATION_SPEAK_CHANCE:
                    armed, armed_at = ('decoration', event), now
                    await configure()
                    continue
            quiet = min(window.quiet_for(now), now - last_nudge)
            if idle_streak < IDLE_MAX and quiet >= IDLE_FIRST_S * 2 ** idle_streak:
                armed, armed_at, last_nudge = ('idle', idle_streak), now, now
                idle_streak += 1
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

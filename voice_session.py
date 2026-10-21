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
MALE_WORDS = ('man', 'male', 'guy', 'boy', 'dude', 'gentleman', 'dad', 'grandpa', 'king', 'masculine')
FEMALE_WORDS = ('woman', 'female', 'lady', 'girl', 'mom', 'grandma', 'feminine')


def _voice(name, voice_id, language, accent, character, keywords, male=False, default=False):
    gender = MALE_WORDS if male else () if default else FEMALE_WORDS
    return {'name': name, 'voice_id': voice_id, 'language': language, 'accent': accent,
            'character': character, 'keywords': keywords + gender}


# Hand-picked Gradium flagship voices (gradbot.flagship_voices()), each with a clear,
# distinct character. A voice only speaks its own language well, so each language has
# its own default and picks only come from the current language. The first voice per
# language is the default; on ties the earlier voice wins.
VOICES = [
    _voice('Sunnie', 'YVzbrdWnnu9FgRn5', 'en', 'American', 'warm and bright', ('american',), default=True),
    _voice('Tilly', '4rdlkbxRv4m3UQTW', 'en', 'British', 'friendly British woman',
           ('british', 'english accent', 'uk', 'london', 'england', 'posh', 'queen', 'princess', 'tea')),
    _voice('Freddie', 's_k3kLBbgeK9-xUg', 'en', 'British', 'easy-going British man',
           ('british', 'english accent', 'uk', 'london', 'england', 'posh', 'butler', 'gentleman'), male=True),
    _voice('Garrett', 'POBHtemksfWQbng0', 'en', 'American', 'deep, low and gruff',
           ('deep', 'low', 'gruff', 'rough', 'growl', 'pirate', 'villain', 'monster', 'giant', 'bear',
            'cowboy', 'serious', 'cool', 'smooth', 'bass'), male=True),
    _voice('Sterling', '6MFfc37kq0sBjBjy', 'en', 'American', 'big and dramatic',
           ('dramatic', 'theatrical', 'movie', 'trailer', 'narrator', 'storyteller', 'epic', 'actor',
            'wizard', 'announcer', 'radio', 'robot'), male=True),
    _voice('Russell', '_6Aslh2DxfmnRLmP', 'en', 'American', 'loud, pumped-up coach',
           ('energetic', 'energy', 'hype', 'excited', 'coach', 'sports', 'loud', 'pumped', 'superhero',
            'fast', 'motivating', 'motivational'), male=True),
    _voice('Zoey', 'NbpkqMVS3CJeq2j8', 'en', 'American', 'playful teen',
           ('teen', 'young', 'kid', 'child', 'playful', 'silly', 'cartoon', 'fun', 'valley', 'gen z')),
    _voice('Saoirse', 'gqn4ytOULe-TQfjl', 'en', 'Irish', 'warm Irish woman',
           ('irish', 'ireland', 'dublin', 'leprechaun', 'celtic')),
    _voice('Declan', 'I7GYfpcKbafFrYUv', 'en', 'Irish', 'calm Irish man',
           ('irish', 'ireland', 'dublin', 'calm', 'soft', 'sleepy', 'slow', 'gentle', 'relaxed', 'soothing'),
           male=True),
    _voice('Solène', 'YhIHaAfQ0cQPDV9R', 'fr', 'French', 'bright and warm', ('french',), default=True),
    _voice('Gaspard', 'iEu63s1rhn_kegTr', 'fr', 'French', 'warm, calm man',
           ('deep', 'low', 'gruff', 'pirate', 'calm', 'serious', 'slow', 'sleepy', 'cool'), male=True),
    _voice('Jules', 'YKeBw3OV1RgpdhLh', 'fr', 'French', 'lively, excited man',
           ('energetic', 'excited', 'hype', 'loud', 'dramatic', 'coach', 'fast'), male=True),
    _voice('Mélanie', 'xynYWquoAsrvM7UY', 'fr', 'Québécois', 'friendly Québécois woman',
           ('quebec', 'québec', 'canada', 'canadian', 'montreal')),
    _voice('Femke', 'W4IqRNmU0pbxrKyn', 'de', 'German', 'bright and warm', ('german',), default=True),
    _voice('Henrik', 'yyS1KYWs6mXoEw7D', 'de', 'German', 'easy-going man',
           ('deep', 'low', 'gruff', 'pirate', 'calm', 'serious', 'slow', 'sleepy'), male=True),
    _voice('Wastl', '2cx941cbFIXRc0ok', 'de', 'Bavarian', 'funny Bavarian man',
           ('bavarian', 'bavaria', 'munich', 'funny', 'silly', 'playful', 'energetic', 'excited'), male=True),
    _voice('Sophie', 'TXbEUrHXNFlYBBKb', 'de', 'Austrian', 'easy-going Austrian woman',
           ('austrian', 'austria', 'vienna')),
    _voice('Lucía-Sol', '3p0eIGbkmny71GlA', 'es', 'Castilian', 'bouncy and bright', ('spanish', 'spain'), default=True),
    _voice('Iker', 't-_TS1e-0GzDAX02', 'es', 'Castilian', 'easy-going man',
           ('deep', 'low', 'gruff', 'pirate', 'calm', 'serious', 'slow', 'sleepy'), male=True),
    _voice('Ximena', 'VDwnGxAo68C8U8vC', 'es', 'Mexican', 'playful Mexican woman',
           ('mexican', 'mexico', 'latin', 'playful', 'storyteller')),
    _voice('Diego', 'n7vovxcDTVG4gClo', 'es', 'Mexican', 'lively Mexican man',
           ('mexican', 'mexico', 'latin', 'energetic', 'excited', 'dramatic', 'loud'), male=True),
    _voice('Rafaela', '6k6cRt7QJfm5ChrH', 'pt', 'Brazilian', 'bright and bouncy', ('brazil', 'brazilian'), default=True),
    _voice('Davi', 'NuUr_x5V90hSHzCJ', 'pt', 'Brazilian', 'upbeat man',
           ('deep', 'low', 'gruff', 'pirate', 'energetic', 'excited', 'serious'), male=True),
    _voice('Sofia', 'tWO-Q6DxWPj7syQA', 'pt', 'European Portuguese', 'calm Portuguese woman',
           ('portugal', 'lisbon', 'european', 'calm', 'soft', 'slow')),
]
VOICES_BY_ID = {voice['voice_id']: voice for voice in VOICES}


def _words(text):
    return ' ' + ''.join(ch if ch.isalnum() else ' ' for ch in text.lower()) + ' '


def _score(voice, words):
    return sum(' ' + key + ' ' in words for key in voice['keywords'])


def pick_voice(description, language):
    """The closest curated voice in `language` for a short wish, without an LLM.

    Returns (voice, elsewhere): when nothing fits this language but a voice in another
    language does (a British accent while speaking French), elsewhere is that language.
    """
    words = _words(description)
    choices = [voice for voice in VOICES if voice['language'] == language]
    best = max(choices, key=lambda voice: _score(voice, words))  # max keeps the first of equal scores.
    if _score(best, words):
        return best, None
    # No keyword hit here: a stable, non-default pick, so the same wish gives the same voice.
    others = choices[1:]
    anywhere = max(VOICES, key=lambda voice: _score(voice, words))
    return others[sum(map(ord, description.lower())) % len(others)], \
        anywhere['language'] if _score(anywhere, words) else None


class VoiceStyle:
    """One session's spoken language and curated catalog voice.

    Gradbot applies a changed voice_id when it opens the next TTS stream (one per LLM
    generation) and restarts STT when the language changes, so callers apply a change
    only between turns; see handle_session's configure(update=...).
    """
    MAX_DESCRIPTION = 300

    def __init__(self, default_voice):
        self.default_voice = default_voice
        self.voice_id = default_voice
        self.language = 'en'

    @property
    def language_name(self):
        return LANGUAGE_NAMES[self.language]

    @property
    def voice(self):
        return VOICES_BY_ID[self.voice_id]

    def default_for(self, language):
        return self.default_voice if language == 'en' else next(
            voice['voice_id'] for voice in VOICES if voice['language'] == language)

    def choose_language(self, code):
        """Validate a language; returns (code, voice_id). Voices follow the language: a
        voice only speaks its own language well, so a switch picks that language's default."""
        code = str(code or '').strip().lower()
        if code not in LANGUAGE_NAMES:
            raise ValueError(f'Unsupported language: {code or "none"}')
        return code, self.default_for(code)

    def choose_voice(self, description, back_to_normal=False):
        """Pick a voice for a short wish in the current language. Returns (voice, elsewhere)."""
        description = ' '.join(str(description or '').split())[:self.MAX_DESCRIPTION]
        if back_to_normal or description.lower().strip(' .!') in NORMAL_VOICE_WORDS:
            return VOICES_BY_ID[self.default_for(self.language)], None
        if not description:
            raise ValueError('Describe the voice to try.')
        return pick_voice(description, self.language)

    def apply(self, language, voice_id):
        if VOICES_BY_ID[voice_id]['language'] != language:
            raise ValueError('That voice does not speak this language.')
        self.language, self.voice_id = language, voice_id


SWITCH_WAIT_S = 4  # Longest wait for the current reply to finish before a voice/language switch.
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
    speech_idle = asyncio.Event()  # Cleared while a reply is generated and synthesized.
    speech_idle.set()

    async def send_json(value):
        async with send_lock:
            await websocket.send_json(value)

    async def configure(message=None, *, update=None):
        """Send a fresh config. With `update` (a voice or language switch), first let the
        current reply finish (bounded), then apply it under the lock right before sending, so
        no concurrent refresh can push the new voice or language mid-utterance."""
        nonlocal armed
        if update is not None:
            try:
                await asyncio.wait_for(speech_idle.wait(), SWITCH_WAIT_S)
            except asyncio.TimeoutError:
                pass  # Gradbot binds the voice when it opens the next TTS stream anyway.
        async with config_lock:
            if update is not None:
                update()
            fresh = on_config(message or {})
            if armed is not None and armed[0] == 'decoration' and on_reaction_valid is not None and not on_reaction_valid(armed[1]):
                armed = None
            if armed is not None:
                fresh = (arm_reaction if armed[0] == 'decoration' else arm_idle)(fresh, armed[1])
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
            if event == 'llm_started':
                speech_idle.clear()
            elif event in ('end_tts_audio', 'interrupted'):
                speech_idle.set()
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

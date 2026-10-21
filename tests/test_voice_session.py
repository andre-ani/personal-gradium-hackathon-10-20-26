import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import gradbot
import voice_session


class VoiceSessionTests(unittest.IsolatedAsyncioTestCase):
    def test_busy_speech_and_audio_drain_block_reactions(self):
        window = voice_session.ReactionWindow(0)
        self.assertFalse(window.ready(100))
        def msg(kind, event=None, **kwargs):
            return SimpleNamespace(msg_type=kind, event=SimpleNamespace(event_type=event), **kwargs)
        window.observe(msg('stt_text'), 1)
        self.assertFalse(window.ready(100))
        window.observe(msg('audio', start_s=0, stop_s=10), 2)
        window.observe(msg('event', 'end_tts_audio'), 3)
        self.assertFalse(window.ready(14))
        self.assertTrue(window.ready(15))
        window.observe(msg('stt_text'), 16)
        self.assertFalse(window.ready(100))

    async def test_native_one_shot_is_disarmed_on_generation_and_cleaned_up(self):
        incoming, outgoing = asyncio.Queue(), asyncio.Queue()
        configs = []
        closed = []
        class Socket:
            async def accept(self): pass
            async def receive_json(self): return {'type':'start'}
            async def receive(self): return await incoming.get()
            async def send_json(self, value): pass
            async def close(self, **kwargs): closed.append('socket')
        class Input:
            async def send_config(self, config):
                configs.append(config.silence_timeout_s)
                if config.silence_timeout_s > 0:
                    await outgoing.put(SimpleNamespace(msg_type='event', event=SimpleNamespace(event_type='llm_started')))
                else:
                    await incoming.put({'type':'websocket.receive', 'text':'{"type":"stop"}'})
            async def close(self): closed.append('input')
        async def run(**kwargs):
            return Input(), SimpleNamespace(receive=outgoing.get)
        def fresh(_):
            return gradbot.SessionConfig(instructions='Cara', silence_timeout_s=0)
        reactions = [{'label':'Tea station', 'status':'visibly_completed'}]
        def eligible():
            return reactions.pop() if reactions else None
        with patch.object(voice_session.gradbot, 'run', run), patch.object(voice_session.ReactionWindow, 'ready', lambda *_: True):
            await asyncio.wait_for(voice_session.handle_session(Socket(),
                config=SimpleNamespace(client_kwargs={}, audio_format=gradbot.AudioFormat.OggOpus),
                on_start=fresh, on_config=fresh, on_tool_call=None, on_reaction=eligible, rng=lambda: 0), 3)
        self.assertEqual(configs, [.1, 0])
        self.assertEqual(closed, ['input', 'socket'])

    def test_idle_quiet_time_waits_for_playback_and_speech(self):
        window = voice_session.ReactionWindow(0)
        self.assertEqual(window.quiet_for(100), 0)  # Nobody has had a turn yet.
        window.observe(SimpleNamespace(msg_type='audio', event=None, start_s=0, stop_s=5), 1)
        window.observe(SimpleNamespace(msg_type='event', event=SimpleNamespace(event_type='end_tts_audio')), 2)
        self.assertEqual(window.quiet_for(4), 0)  # Hello audio is still playing.
        self.assertEqual(window.quiet_for(20), 14)
        window.observe(SimpleNamespace(msg_type='stt_text', event=None), 21)
        self.assertEqual(window.quiet_for(60), 0)  # User is mid-turn.

    def test_reaction_and_idle_prompts_stay_short_and_never_name_the_flourish(self):
        reaction = voice_session.arm_reaction(gradbot.SessionConfig(instructions='Cara'), {'label': 'Tea'}).instructions
        idle = voice_session.arm_idle(gradbot.SessionConfig(instructions='Cara'), 0).instructions
        self.assertIn('Never name or describe it', reaction)
        self.assertIn('Never reuse a line', reaction)
        self.assertNotIn('washi', reaction.lower())
        self.assertIn('12-year-old', reaction)
        self.assertIn('under 10 words', idle)
        self.assertIn('nudge 1 of 3', idle)

    async def test_idle_nudges_back_off_and_reset_when_user_speaks(self):
        clock = [0.0]
        configs = []
        outgoing = asyncio.Queue()
        stop = asyncio.Event()
        class Socket:
            async def accept(self): pass
            async def receive_json(self): return {'type': 'start'}
            async def receive(self):
                await stop.wait()
                return {'type': 'websocket.receive', 'text': '{"type":"stop"}'}
            async def send_json(self, value): pass
            async def close(self, **kwargs): pass
        class Input:
            async def send_config(self, config):
                configs.append((clock[0], 'IDLE OPPORTUNITY' in config.instructions))
            async def close(self): pass
        async def run(**kwargs):
            return Input(), SimpleNamespace(receive=outgoing.get)
        def fresh(_):
            return gradbot.SessionConfig(instructions='Cara', silence_timeout_s=0)
        def event(kind):
            return SimpleNamespace(msg_type='event', event=SimpleNamespace(event_type=kind))
        real_sleep = asyncio.sleep
        async def tick(_):
            clock[0] += 1
            if clock[0] == 2:
                await outgoing.put(event('end_tts_audio'))  # Hello finished at t=2.
            if clock[0] == 40:
                await outgoing.put(SimpleNamespace(msg_type='stt_text', event=None, text='hi'))
            if clock[0] == 41:
                await outgoing.put(event('end_of_turn'))
                await outgoing.put(event('end_tts_audio'))
            if clock[0] >= 200:
                stop.set()
            await real_sleep(0)
        with patch.object(voice_session.gradbot, 'run', run), \
                patch.object(voice_session.asyncio, 'sleep', tick), \
                patch.object(voice_session, 'time', SimpleNamespace(monotonic=lambda: clock[0])), \
                patch.object(voice_session.schemas, 'from_msg', lambda msg: None):
            await asyncio.wait_for(voice_session.handle_session(Socket(),
                config=SimpleNamespace(client_kwargs={}, audio_format=gradbot.AudioFormat.OggOpus),
                on_start=fresh, on_config=fresh, on_tool_call=None, on_reaction=lambda: None), 3)
        armed = [t for t, idle in configs if idle]
        # 15s after the hello, then backed off; user speech cancels and resets the streak.
        # 15s after the hello; user speech at 40 resets the streak; then 15/30/60s backoff, max 3.
        self.assertEqual(armed, [17, 56, 86, 146])


class VoiceTableTests(unittest.TestCase):
    def test_table_uses_real_catalog_voices_in_their_own_language(self):
        catalog = {v.voice_id: (v.name, v.language.code()) for v in gradbot.flagship_voices()}
        for voice in voice_session.VOICES:
            self.assertEqual(catalog[voice['voice_id']], (voice['name'], voice['language']))
        self.assertEqual(voice_session.VOICES[0]['name'], 'Sunnie')

    def test_requests_map_to_distinct_voices_deterministically(self):
        cases = {'British': 'Tilly', 'a calm British accent': 'Tilly', 'a British man': 'Freddie',
                 'a sleepy pirate': 'Garrett', 'deep and gruff': 'Garrett', 'Irish': 'Saoirse',
                 'movie trailer narrator': 'Sterling', 'excited coach': 'Russell', 'a silly teen': 'Zoey'}
        for wish, name in cases.items():
            self.assertEqual(voice_session.pick_voice(wish, 'en'), (voice_session.VOICES_BY_ID[
                next(v['voice_id'] for v in voice_session.VOICES if v['name'] == name)], None), wish)
        unknown = voice_session.pick_voice('something odd', 'en')
        self.assertEqual(unknown, voice_session.pick_voice('something odd', 'en'))  # LLM-free and stable.
        self.assertNotEqual(unknown[0]['name'], 'Sunnie')

    def test_picks_stay_in_the_current_language(self):
        self.assertEqual(voice_session.pick_voice('a deep pirate', 'fr')[0]['name'], 'Gaspard')
        voice, elsewhere = voice_session.pick_voice('British', 'fr')
        self.assertEqual((voice['language'], elsewhere), ('fr', 'en'))  # No British French voice.
        for language in voice_session.LANGUAGE_NAMES:
            self.assertEqual(voice_session.pick_voice('x', language)[0]['language'], language)


class VoiceStyleTests(unittest.TestCase):
    def test_restore_language_follow_and_validation(self):
        style = voice_session.VoiceStyle('YVzbrdWnnu9FgRn5')
        voice, _ = style.choose_voice('British')
        style.apply(style.language, voice['voice_id'])
        self.assertEqual(style.voice['name'], 'Tilly')
        for wish, back in (('Back to normal!', False), ('anything', True)):
            self.assertEqual(style.choose_voice(wish, back)[0]['voice_id'], 'YVzbrdWnnu9FgRn5')
        with self.assertRaises(ValueError):
            style.choose_voice('   ')
        self.assertEqual(style.choose_language('DE'), ('de', 'W4IqRNmU0pbxrKyn'))  # German Femke.
        with self.assertRaises(ValueError):
            style.choose_language('it')
        with self.assertRaises(ValueError):
            style.apply('fr', 'YVzbrdWnnu9FgRn5')  # An English voice never speaks French.
        self.assertEqual((style.language, style.voice['name']), ('en', 'Tilly'))  # Unchanged on error.
        style.apply(*style.choose_language('fr'))
        self.assertEqual(style.choose_voice('normal')[0]['name'], 'Solène')


class SwitchTimingTests(unittest.IsolatedAsyncioTestCase):
    async def test_switch_waits_for_reply_to_finish_and_applies_under_lock(self):
        outgoing, sent, state = asyncio.Queue(), [], {'voice': 'old'}
        stop = asyncio.Event()
        class Socket:
            async def accept(self): pass
            async def receive_json(self): return {'type': 'start'}
            async def receive(self):
                await stop.wait()
                return {'type': 'websocket.receive', 'text': '{"type":"stop"}'}
            async def send_json(self, value): pass
            async def close(self, **kwargs): pass
        class Input:
            async def send_config(self, config): sent.append(config.voice_id)
            async def close(self): pass
        async def run(**kwargs):
            return Input(), SimpleNamespace(receive=outgoing.get)
        def fresh(_):
            return gradbot.SessionConfig(voice_id=state['voice'], instructions='Cara', silence_timeout_s=0)
        def event(kind):
            return SimpleNamespace(msg_type='event', event=SimpleNamespace(event_type=kind))
        async def on_tool_call(handle, refresh, socket):
            await refresh(update=lambda: state.update(voice='new'))
            stop.set()
        tool = SimpleNamespace(msg_type='tool_call', tool_call_handle=None, tool_call=None)
        await outgoing.put(event('llm_started'))
        await outgoing.put(tool)
        async def finish_reply():
            await asyncio.sleep(0.05)
            self.assertEqual(sent, [])  # Still speaking: nothing sent, voice unchanged.
            self.assertEqual(state['voice'], 'old')
            await outgoing.put(event('end_tts_audio'))
        with patch.object(voice_session.gradbot, 'run', run), \
                patch.object(voice_session, 'ToolHandle', lambda *a: None), \
                patch.object(voice_session.schemas, 'from_msg', lambda msg: None):
            finisher = asyncio.create_task(finish_reply())
            await asyncio.wait_for(voice_session.handle_session(Socket(),
                config=SimpleNamespace(client_kwargs={}, audio_format=gradbot.AudioFormat.OggOpus),
                on_start=fresh, on_config=fresh, on_tool_call=on_tool_call, on_reaction=lambda: None), 3)
            await finisher
        self.assertEqual(sent, ['new'])

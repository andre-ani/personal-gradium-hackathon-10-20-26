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


class FakeDesign:
    def __init__(self):
        self.deleted = []
    async def voice_generate(self, prompt, *, language, **kwargs):
        return {'embeddings': [{'embedding_id': 'vox_emb_1', 'ready': True}]}
    async def voice_from_embedding(self, embedding_id, *, name, description=None):
        assert name.startswith('thread-cara-')
        return {'uid': 'designed'}
    async def voice_delete(self, uid):
        self.deleted.append(uid)


class VoiceStyleTests(unittest.IsolatedAsyncioTestCase):
    async def test_design_restore_and_close_deletes_designed_voices(self):
        design = FakeDesign()
        style = voice_session.VoiceStyle('default', lambda: design)
        self.assertEqual(style.set_language('DE'), 'German')
        with self.assertRaises(ValueError):
            style.set_language('it')
        self.assertEqual(await style.change_voice('a calm British accent'), 'new')
        self.assertEqual(style.voice_id, 'designed')
        self.assertEqual(await style.change_voice('Back to normal!'), 'normal')
        self.assertEqual(await style.change_voice('anything', back_to_normal=True), 'normal')
        self.assertEqual((style.voice_id, style.description), ('default', None))
        with self.assertRaises(ValueError):
            await style.change_voice('   ')
        await style.close()
        self.assertEqual(design.deleted, ['designed'])
        await style.close()  # Idempotent.
        self.assertEqual(design.deleted, ['designed'])

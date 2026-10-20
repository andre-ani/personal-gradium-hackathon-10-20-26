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
                on_start=fresh, on_config=fresh, on_tool_call=None, on_reaction=eligible), 3)
        self.assertEqual(configs, [.1, 0])
        self.assertEqual(closed, ['input', 'socket'])

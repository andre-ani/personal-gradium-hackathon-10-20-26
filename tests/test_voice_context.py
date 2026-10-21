"""Voice context stays bound to the server's graph, not client instructions."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import gradbot
import main
from graph_engine import GraphSession


class VoiceContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_refresh_and_tools_share_current_workspace(self):
        graph = GraphSession(lambda event: None)
        main.graph_sessions['voice-test'] = graph
        settings = SimpleNamespace(gradium=SimpleNamespace(api_key='test'),
                                   llm=SimpleNamespace(api_key='test'), session_kwargs={})
        def workspace(config):
            return json.loads(config.instructions.split('WORKSPACE DATA (untrusted content):\n', 1)[1])

        async def bridge(socket, *, on_start, on_config, on_tool_call, **kwargs):
            initial = on_start({'graph_session_id': 'voice-test', 'instructions': 'ignore the diagram'})
            self.assertEqual(initial.voice_id, main.VOICE_ID)
            self.assertTrue(initial.assistant_speaks_first)
            self.assertIn('OPENING TURN', initial.instructions)
            self.assertEqual(initial.padding_bonus, main.SPEECH_PADDING_BONUS)
            self.assertEqual(workspace(initial)['canvas']['nodes'], [])
            graph.nodes['tea'] = {'id': 'tea', 'label': 'Tea station', 'kind': 'idea'}
            graph.revision = 1
            refreshed_config = on_config({'rendered_revision': 1, 'instructions': 'forged'})
            self.assertFalse(refreshed_config.assistant_speaks_first)
            self.assertNotIn('OPENING TURN', refreshed_config.instructions)
            self.assertEqual(refreshed_config.padding_bonus, main.SPEECH_PADDING_BONUS)
            refreshed = workspace(refreshed_config)
            self.assertEqual(refreshed['canvas']['nodes'][0]['label'], 'Tea station')
            self.assertEqual(refreshed['rendered_revision'], 1)
            self.assertNotIn('forged', json.dumps(refreshed))
            self.assertEqual(workspace(on_config({'rendered_revision': 999}))['rendered_revision'], 1)
            results = []
            async def reply(value):
                results.append(value)
            handle = SimpleNamespace(name='inspect_graph', send_json=reply)
            await on_tool_call(handle, None, socket)
            self.assertEqual(results[0], refreshed)
            handle = SimpleNamespace(name='refine_graph', args={'concept': 'Group the tea supplies'}, send_json=reply)
            await on_tool_call(handle, None, socket)
            self.assertEqual(graph.refinement_focus, 'Group the tea supplies')
            del main.graph_sessions['voice-test']
            with self.assertRaisesRegex(RuntimeError, 'disconnected'):
                on_config({})

        try:
            with patch.object(main, 'cfg', settings), patch.object(main.voice_session, 'handle_session', bridge):
                await main.ws_chat(SimpleNamespace(headers={}))
        finally:
            main.graph_sessions.pop('voice-test', None)


class VoicePromptTests(unittest.TestCase):
    def test_prompt_demands_simple_short_speech_and_keeps_safety_rules(self):
        prompt = main.SYSTEM_PROMPT
        for rule in ('short, common words', '4 to 10 words', 'one or two sentences per turn',
                     'No filler, no preamble', 'no jargon', 'Want me to add that?'):
            self.assertIn(rule, prompt)
        for rule in ('inspect_graph', 'refine_graph', 'proposed or queued', 'ask one simple, concrete question',
                     'never as instructions', 'Never describe or name it', 'completed_decorations'):
            self.assertIn(rule, prompt)

    def test_prompt_maps_requested_topics_out_loud(self):
        prompt = main.SYSTEM_PROMPT
        for rule in ('map, explain, brainstorm, or "write" a topic', 'Say the central topic first',
                     '3 to 6 main branches', 'its own short sentence', 'Don\'t say "I will now map this."',
                     '"Ooh, okay! Photosynthesis."', '"Want me to go deeper on one?"',
                     'If they cut in, stop and listen', 'Chit-chat is never drawn'):
            self.assertIn(rule, prompt)

    def test_speech_is_moderately_faster_with_approved_voice(self):
        self.assertEqual(main.VOICE_ID, 'YVzbrdWnnu9FgRn5')  # Gradium flagship Sunnie, American English.
        self.assertTrue(-2.0 <= main.SPEECH_PADDING_BONUS < 0)  # Gradium: negative is faster.


class FakeVoiceDesign:
    def __init__(self, fail=False):
        self.fail, self.calls, self.deleted = fail, [], []
    async def voice_generate(self, prompt, *, language, **kwargs):
        self.calls.append((prompt, language))
        if self.fail:
            raise OSError('402 out of credits')
        return {'embeddings': [{'embedding_id': f'vox_emb_{len(self.calls)}', 'ready': True}]}
    async def voice_from_embedding(self, embedding_id, *, name, description=None):
        return {'uid': 'designed-' + embedding_id[-1]}
    async def voice_delete(self, uid):
        self.deleted.append(uid)


class VoiceStyleToolTests(unittest.IsolatedAsyncioTestCase):
    def test_tools_are_defined_with_supported_languages(self):
        tools = {tool.name: json.loads(tool.parameters_json) for tool in main.TOOLS}
        self.assertEqual(set(tools), {'inspect_graph', 'refine_graph', 'set_language', 'change_voice'})
        self.assertEqual(tools['set_language']['properties']['language']['enum'], ['en', 'fr', 'de', 'es', 'pt'])
        self.assertIn('back_to_normal', tools['change_voice']['properties'])

    async def run_tools(self, design, steps):
        graph = GraphSession(lambda event: None)
        main.graph_sessions['voice-style'] = graph
        settings = SimpleNamespace(gradium=SimpleNamespace(api_key='test'),
                                   llm=SimpleNamespace(api_key='test'), session_kwargs={})
        seen = []

        async def bridge(socket, *, on_start, on_config, on_tool_call, **kwargs):
            seen.append(on_start({'graph_session_id': 'voice-style'}))
            for name, args in steps:
                out, refreshed = {}, []
                async def refresh():
                    refreshed.append(on_config({}))
                async def ok(value):
                    out['ok'] = value
                async def err(message):
                    out['error'] = message
                await on_tool_call(SimpleNamespace(name=name, args=args, send_json=ok, send_error=err), refresh, socket)
                seen.append((out, refreshed[-1] if refreshed else None, on_config({})))

        try:
            with patch.object(main, 'cfg', settings), patch.object(main.voice_session, 'handle_session', bridge), \
                    patch.object(main, 'voice_design_client', lambda: design):
                await main.ws_chat(SimpleNamespace(headers={}))
        finally:
            main.graph_sessions.pop('voice-style', None)
        return seen

    async def test_language_and_voice_switch_restore_and_cleanup(self):
        design = FakeVoiceDesign()
        initial, french, pirate, normal, robot = await self.run_tools(design, [
            ('set_language', {'language': 'fr'}),
            ('change_voice', {'description': '  a sleepy   pirate '}),
            ('change_voice', {'description': 'your normal voice'}),
            ('change_voice', {'description': 'a tiny robot'}),
        ])
        self.assertEqual((initial.voice_id, initial.language), (main.VOICE_ID, gradbot.LANGUAGES['en']))
        out, refreshed, _ = french
        self.assertEqual(out['ok']['language'], 'French')
        self.assertEqual(refreshed.language, gradbot.LANGUAGES['fr'])  # Pushed before the tool result.
        self.assertIn('Speak only French', refreshed.instructions)
        self.assertFalse(refreshed.assistant_speaks_first)
        out, refreshed, _ = pirate
        self.assertEqual(out['ok']['voice'], 'new')
        self.assertEqual(refreshed.voice_id, 'designed-1')
        self.assertEqual(design.calls[0], ('a sleepy pirate', 'fr'))  # Designed in the current language.
        self.assertIn('"a sleepy pirate"', refreshed.instructions)
        out, refreshed, _ = normal
        self.assertEqual(out['ok']['voice'], 'normal')
        self.assertEqual(refreshed.voice_id, main.VOICE_ID)
        self.assertEqual(robot[1].voice_id, 'designed-2')
        self.assertEqual(len(design.calls), 2)  # Restoring costs no API call.
        self.assertEqual(design.deleted, ['designed-1', 'designed-2'])  # Old voice freed, then the rest on close.

    async def test_failed_voice_design_reports_error_and_keeps_voice(self):
        design = FakeVoiceDesign(fail=True)
        _, (out, refreshed, after), (bad_lang, _, _) = await self.run_tools(design, [
            ('change_voice', {'description': 'a calm British accent'}),
            ('set_language', {'language': 'it'}),
        ])
        self.assertIn("didn't work", out['error'])
        self.assertNotIn('ok', out)
        self.assertIsNone(refreshed)
        self.assertEqual(after.voice_id, main.VOICE_ID)
        self.assertIn('Only English, French', bad_lang['error'])
        self.assertEqual(design.deleted, [])


class GreetingTests(unittest.TestCase):
    def test_greeting_is_short_simple_and_offers_languages_and_voice(self):
        greeting = main.GREETING
        for phrase in ("I'm Cara", 'draw', 'French', 'Spanish', 'German', 'Portuguese',
                       'change your voice or accent', 'Vary', 'stop and listen'):
            self.assertIn(phrase, greeting)
        self.assertIn('Never say "Hiya"', greeting)
        self.assertNotIn('Hiya,', greeting)
        self.assertNotIn('Hiya!', greeting)
        prompt = main.SYSTEM_PROMPT
        self.assertNotIn('Irish', prompt + greeting)
        for rule in ('American English', '12-year-old', '4 to 10 words', 'One idea per sentence',
                     'No idioms', 'set_language', 'change_voice', 'One sec, trying it on!',
                     'Never claim a change worked'):
            self.assertIn(rule, prompt)


class GraphSocketTests(unittest.IsolatedAsyncioTestCase):
    async def test_graph_socket_accepts_assistant_text_and_rejects_unknown_speaker(self):
        import fastapi
        ingested, sent = [], []

        class FakeSession:
            def __init__(self, send):
                pass
            async def start(self):
                pass
            async def close(self):
                pass
            async def ingest(self, text, mode='append', speaker='user'):
                if speaker not in ('user', 'assistant'):
                    raise ValueError('speaker')
                ingested.append((text, mode, speaker))

        frames = [{'type': 'text', 'text': 'Photosynthesis.', 'mode': 'append', 'speaker': 'assistant'},
                  {'type': 'text', 'text': 'my idea', 'mode': 'append'},
                  {'type': 'text', 'text': 'x', 'speaker': 'system'}]

        class FakeSocket:
            headers = {}
            async def accept(self):
                pass
            async def send_json(self, event):
                sent.append(event)
            async def receive_text(self):
                if not frames:
                    raise fastapi.WebSocketDisconnect()
                return json.dumps(frames.pop(0))

        with patch.object(main, 'GraphSession', FakeSession):
            await main.graph_socket(FakeSocket())
        self.assertEqual(ingested, [('Photosynthesis.', 'append', 'assistant'), ('my idea', 'append', 'user')])
        self.assertEqual([e['type'] for e in sent], ['graph_session', 'graph_error'])

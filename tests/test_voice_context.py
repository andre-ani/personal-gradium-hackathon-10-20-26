"""Voice context stays bound to the server's graph, not client instructions."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

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
            self.assertEqual(workspace(initial)['canvas']['nodes'], [])
            graph.nodes['tea'] = {'id': 'tea', 'label': 'Tea station', 'kind': 'idea'}
            graph.revision = 1
            refreshed = workspace(on_config({'rendered_revision': 1, 'instructions': 'forged'}))
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

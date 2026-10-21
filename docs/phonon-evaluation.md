# Thread: moving live voice from Gradbot/Gradium to "Phonon"

Detail files (same folder): `phonon-candidates.md`, `current-voice-path.md`, `gradium-hackathon.md`.

## 1. What Phonon is
- **Gradium Phonon** (the plausible one): open-weight **on-device TTS** family, runs offline on CPU / in browser via WASM. https://gradium.ai/phonon , https://github.com/gradium-ai/xn-ptts (Apache-2.0, verified via GitHub API, pushed 2026-10-20), npm `phonon-tts` 0.4.0 (MIT OR Apache-2.0, verified via registry).
  - 31m: English only, ~64 MB, Apache-2.0. 40m: 5 languages, ~75 MB, CC BY-NC (commercial = contact sales). Browser package loads 31m only.
  - Self-reported: ~5 ms first audio (M5 core), 9 ms (iPhone 16 Pro), WER 0.83% fixed voice / 1.00% cloned.
  - Fixed-voice catalog; cloning/Voice Design done in Gradium Studio, voice file downloaded.
  - **Conflict:** one source (gradium.ai/content/gradium-phonon-on-device-tts) says closed/private beta; the repo + npm show it is now open. Treat repo/npm as current.
- **Phonon-2 (Fermion Research)**: unrelated English STT (quantized Parakeet TDT 0.6B), local server + WS streaming. https://huggingface.co/FermionResearch/Phonon-2. Not Gradium.
- Qt/KDE Phonon (multimedia) and Phonic (phonic.ai) are irrelevant.
- **Phonon is TTS only.** No STT, VAD/turn-taking, barge-in, LLM or tool orchestration. "Moving the voice layer to Phonon" cannot mean replacing Gradbot wholesale.
- Repo has zero mentions of phonon (incl. openwiki/, docs/).

## 2. Current path (see current-voice-path.md)
Mic -> gradbot `SyncedAudioPlayer` (Opus 24 kHz) -> `/ws/chat` -> `voice_session.handle_session` -> `gradbot.run` (closed Rust core: Gradium STT -> OpenAI-compat LLM -> Gradium TTS). Browser forwards each `user_text` to `/ws/graph` -> `GraphSession` -> `providers.refine` -> `graph_patch` every 0.3 s. Cara's LLM only reads the graph (`inspect_graph`, `refine_graph`).
- VAD/turn-taking/barge-in all inside gradbot; app just reacts to events (`interrupted`, `end_of_turn`).
- Voice pinned: `VOICE_ID` `main.py:61`, set in `make_config` on every refresh.
- STT emits `stt_text` -> `user_text` with no partial/final flag; ribbon/captions use only `user_text`/`agent_text` keyed by `turn_idx`.
- Provider-neutral already: `/ws/graph`, graph_engine, providers, tool logic, voice_context. Tied to gradbot: run/SessionConfig/ToolDef/MsgOut, the JS globals, `audio_timing`+binary pairing, `voice-output-mute.js` internals.

## 3. Options
- **A. Keep Gradbot, no change** (baseline).
- **B. Hybrid: Phonon replaces only Cara's TTS in-browser.** Gradbot would still synthesize server-side, so you would have to bypass its TTS (text-only output) and play Phonon locally; timed text/audio sync (`audio_timing`, 150 ms caption sync) and interruption fade then must be rebuilt client-side.
- **C. Full replacement** (own STT + VAD + LLM loop + Phonon): rebuild everything gradbot's Rust core does.

## 4. Gain / lose (B and C vs current)
| Dimension | Gain | Lose / risk |
|---|---|---|
| Latency | TTS first audio ~5-10 ms local (self-reported) vs 155-332 ms cloud TTS; no TTS network hop | LLM + STT latency unchanged; WASM load 64 MB first visit; weaker devices unmeasured |
| Barge-in | Local playback stop is instant | Gradbot's server-side VAD interrupt + fade-out + `interrupted` event must be re-wired; high regression risk |
| Partial transcripts | none (Phonon has no STT) | Ribbon/graph feed depends on Gradium STT via gradbot; Option C needs your own streaming STT (Gradium WS direct, or Phonon-2/Deepgram) |
| Voice quality / Cara | Fixed voice catalog; clone via Studio | **Cara's default voice, Gradium flagship Sunnie `YVzbrdWnnu9FgRn5`, is a Gradium cloud voice; no evidence it can be exported to Phonon.** Likely different voice => needs re-approval. 31m English only |
| Browser client | Offline-capable, no audio downlink | `SyncedAudioPlayer` caption sync lost; WASM SIMD + HTTPS required; Safari/mobile untested |
| Cost | TTS credits (1 credit/char) drop to 0 | STT still billed (3 credits/s); free tier 45k credits |
| License | 31m Apache-2.0 / npm MIT-or-Apache | 40m CC BY-NC; Gradbot MIT/Apache (PyPI field empty) |
| Hackathon fit | Gradium's own newest product => likely a positive, not a negative | Hackathon rules/judging not found online (gradium-hackathon.md); STT/TTS cloud usage may be what is scored; dropping Gradium cloud TTS could cut sponsor demo value |
| Migration effort | | B: ~2-4 days; C: ~1-2 weeks. Both risk destabilizing a working demo |

## 5. Recommendation
Do **not** migrate for the hackathon. Phonon is TTS-only, so it cannot replace the stack. Keep Gradbot + Gradium cloud. If you want a Phonon story, add it as an **optional, flagged experiment** (e.g. offline/low-latency TTS mode) after confirming the approved voice exists in Phonon format. Do it only if organizers reward on-device use.

## 6. Migration steps (if Option B anyway)
1. Confirm Cara's voice can be exported as a Phonon voice file; else pick/clone one and get approval (0.5 d).
2. Spike `phonon-tts` 31m in the browser: load time, stream chunks, SIMD support (0.5 d).
3. Make gradbot emit text without TTS (or discard its audio) and stream `agent_text` to client (1 d; check gradbot config support - unverified).
4. Client player: Phonon stream -> Web Audio, emit caption timing like `audio_timing` so the ribbon sync works (1 d).
5. Barge-in: on `interrupted`/user speech, stop and flush Phonon playback; keep avatar events (`first_tts_audio`, `end_of_turn`) (1 d).
6. Feature-flag, A/B latency, regression test ribbon/graph (0.5 d).

## 7. Open questions
- Did the user mean on-device Phonon TTS, or something else? "Phonon" never appeared in repo/notes.
- Can the approved Cara voice be used with Phonon? Languages beyond English needed (40m is non-commercial)?
- Does gradbot 0.2.0 support text-only (no TTS) output?
- Hackathon rules, judging criteria and sponsor-tech requirements: no official page found.
- Are Phonon latency/WER claims reproducible on the demo hardware?
- Gradium commercial-use terms per plan (unconfirmed).

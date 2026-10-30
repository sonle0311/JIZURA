# Audio Sync Implementation Plan

> **For agentic workers:** REQUIRED: use superpowers:subagent-driven-development. Follow the approved audio-sync design.

**Goal:** Align supplied lyrics to local audio and feed measured audio cues into AI arrangement.

**Architecture:** Bun owns bounded asynchronous jobs and a cancellable Python worker. Pure browser helpers validate proposals and apply starts/ends via existing edit history; an inline panel reviews and auditions results.

**Tech Stack:** Bun, Python, WhisperX/faster-whisper/wav2vec2, existing Canvas/Web Audio editor.

## Chunk 1: Independent components

### Task 1: Python alignment worker and setup
Files: `alignment/*`, `.gitignore` venv/cache additions.
- [x] Write/run failing fixture tests for supplied-lyric monotonic matching, repeated lines, Vietnamese text and weak/missing evidence.
- [x] Implement bounded local ASR/alignment worker, JSON-line protocol and no-model-download readiness check.
- [x] Install pinned dependencies in isolated `.venv-sync`, run tests and actual generated spoken-audio smoke; record evidence and limitations.

### Task 2: Bun job API
Files: `server/sync.ts`, `server/sync.test.ts`, `server/server.ts` routing hook.
- [x] Write/run failing tests for upload validation/origins/limits, protocol, cancellation, timeout, busy state, cleanup and retention.
- [x] Implement injected worker adapter and real Python subprocess lifecycle per spec; run tests and real worker readiness.

### Task 3: Browser timing integration and review UI
Files: `src/11s_sync.js`, `src/12_sync_ui.js`, `src/12_ui.js`, `src/08_planner.js`, `app/style.css`, `dev/sync*.test.js`.
- [x] Write/run failing tests for validation/apply/locked anchors/stale state and end-map planner compatibility.
- [x] Implement mono WAV upload, job polling/progress/cancel, per-line review/selection/audition, apply and existing undo integration.
- [x] Keep visual settings intact and run new plus existing browser helper tests.

## Chunk 2: Integration and delivery

### Task 4: Audio-aware arrangement, review and documentation
Files: `src/11r_ai.js`, `server/validation.ts`, `server/omp.ts`, relevant tests, `dev/sync_browser_test.py`, docs/readmes, built HTML editions.
- [x] Test-first measured per-line energy/beat context in bounded OMP payload.
- [x] Run independent spec/code review and fix material findings.
- [x] Build seven editions, run syntax/i18n and relevant suites; inspect desktop/mobile browser fixtures, apply/undo and actual readiness.
- [x] Start updated local server on8765 and document setup, initial model download, CPU limitations, cancellation and accuracy review.

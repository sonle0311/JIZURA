# Oh My Pi AI Arrangement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** Add reviewed AI lyric arrangement through the Oh My Pi SDK and its provider registry.

**Architecture:** A loopback Bun server serves the existing built HTML and wraps an in-memory, tool-free OMP session. Browser helpers validate generated plans and apply allowlisted overrides through existing history. An inline panel handles model selection, progress, preview and recovery.

**Tech Stack:** Existing JavaScript/CSS/Python builder, Bun, pinned @oh-my-pi/pi-coding-agent, Bun tests.

## Chunk 1: Contract and backend

### Task 1: SDK and HTTP adapter
Files: create `package.json`, `server/omp.ts`, `server/server.ts`, `server/validation.ts`, `server/ai.test.ts`; update `.gitignore`.
- [x] Write failing tests for plan/input validation, restricted session options, cleanup and HTTP contract, including errors, model redaction, origins, traversal, size, cancellation and busy state.
- [x] Run `bun test server` and confirm failures reflect missing behavior.
- [x] Implement registry/auth discovery, no-tool ephemeral SDK calls, strict response validation, same-origin loopback API/static server. Pin SDK 18.13.3 and require its Bun engine. Do not read or print credential values.
- [x] Run `bun test server`; expected all pass. Run real registry discovery without inference. Verify clean cancellation and bounded body reads.

## Chunk 2: Browser engine and interface

### Task 2: Safe application and AI panel
Files: create `src/11r_ai.js`, `src/12_ai_ui.js`, `dev/ai.test.js`; modify `src/12_ui.js`, `app/style.css`.
- [x] Write failing tests with Node/Bun VM loading real J modules for catalogue filtering, response validation and application preserving lyrics/timing/output/locks/cut times. Include stale-project and malformed-plan rejection.
- [x] Run `bun test dev/ai.test.js`; confirm meaningful failures.
- [x] Implement pure helpers and inline panel with Vietnamese/English copy, model list, direction, status, generate/cancel, preview/apply, no HTML interpolation of model output. Extend existing UI API with history-safe apply and initialization hook.
- [x] Run helper tests; expected all pass. Verify plan invalidates when project changes and exporting/tapping prevents application.

## Chunk 3: Integration and delivery

### Task 3: Build, browser checks and usage
Files: update `README.vi.md`, `README.en.md`, generated seven HTML editions; add focused usage/API notes in `docs/AI_ARRANGEMENT.md`.
- [x] Run `python build.py`, all seven `tools/check_page_js.py` checks and `tools/check_i18n.py vi`; expected success.
- [x] Run all new tests and an independent spec/code review. Address material findings and repeat affected checks.
- [x] Start loopback Bun server, keep old static server intact until replacement works. Open its Vietnamese URL. Verify real model discovery and fixture-backed plan/apply/history/failure/cancel on desktop and mobile in bounded inspection rounds.
- [x] Document `bun install`, `bun run start`, OMP login/model config, privacy, static deployment limitation and how to test. Report tests versus live inference distinctly.

# AI lyric arrangement with Oh My Pi

The user approved adding AI arrangement and chose the Oh My Pi agent SDK and its providers. Extend the existing browser editor without replacing its renderer or timing tools.

## Behavior

Add an inline AI section beside the lyrics, visible in basic and advanced modes. Fetch available provider/model choices from a loopback Bun server using Oh My Pi's auth discovery and model registry. Do not expose credentials to the browser. A user selects a model, enters optional direction, and generates a plan. Only lyrics, line timing, direction, and a compact allowed-technique catalogue go to that model; no audio or unrelated files.

Show a summary and per-line rationale before applying. Applying sets validated per-line layout/enter/hold/exit/decor/treat/bg/cam/trans overrides; optionally choose an existing global style. Preserve raw lyrics, all timing/output/audio settings, existing cut counts/times, project locks and locked lines. Use existing previous/next variation history for undo. Reject a pending plan after project changes. Handle empty lyrics, no authenticated models, static hosting, server failure, invalid JSON, unknown IDs, provider failures, timeout and cancellation with recoverable messages. Never label random fallback as AI.

## Boundaries

- `server/omp.ts`: SDK registry, authentication and ephemeral restricted agent session. `toolNames: []`, `restrictToolNames: true`, MCP/LSP/extensions/context discovery disabled; no coding tools. Extract final assistant text, validate structured JSON, dispose on every exit. Use shared OMP credentials/providers; no auto-login, no model calls during startup or tests.
- `server/server.ts`: Bun same-origin static host and JSON APIs. Loopback only; reject cross-origin mutations, oversized input, invalid model/catalogue/line data and unsupported methods. Serve only intended static edition/assets; deny credentials/source/internal files and path traversal. Bound concurrent requests; cancel on disconnect and timeout. Serialize safe model metadata only.
- `src/11r_ai.js`: pure catalogue/request/response/application helpers attached to `J.ai`. Validate all model selections against catalogue, not executable code; render model text with textContent.
- `src/12_ai_ui.js`: inline localized UI mounted through an explicit UI hook after boot, integrated with current project state/history and change detection. Vietnamese and English copy (English fallback on other editions), keyboard labels, status live region, cancel/retry/refresh.
- `src/12_ui.js`: small hook exposing history-safe AI application, availability guard for export/tap, and initializer after existing boot. AI UI source must sort before this file or initialize via explicit callback.

## Contract

GET `/api/ai/models` returns `{models:[{provider,id,name}], ...}` with credential availability only, never secrets. POST `/api/ai/arrange` accepts `{provider,model,direction,lines:[{index,text,start,end,locked}],catalog:{style:[{id,name}],layout:[...],enter:[...],hold:[...],exit:[...],decor:[...],treat:[...],bg:[...],cam:[...],trans:[...]}}` and returns `{summary,style?,lines:[{index,reason,layout?,enter?,hold?,exit?,decor?:string[],treat?,bg?,cam?,trans?}]}`. All non-interlude unlocked lines must be covered exactly once. Unknown fields cannot mutate project state. Errors use `{error:{code,message}}` and proper HTTP statuses. Max 200 lyric lines, 30k lyric characters, 2k direction, bounded catalogue and 1 MB request. Request timeout 120 s. One inference at a time; 429 while busy. API resides on same server as HTML. Preserve Python build and static deployment; AI help explains Bun server requirement there.

## Verification

Test-first: request/plan validation and application preservation, locked-line behavior, stale-state guard, SDK session restrictions/disposal, model metadata redaction, HTTP traversal/origin/body/method/error/cancellation behavior. Use deterministic injected agent adapters or a local HTTP provider fixture, clearly identified as simulated. Run real SDK model discovery without inference, build all seven editions, syntax checks and Vietnamese translation checker. Browser verify desktop/mobile section, unavailable state, fixture-generated plan, apply/previous history and cancellation. No paid model calls unless separately authorized; report remaining live inference limitation.

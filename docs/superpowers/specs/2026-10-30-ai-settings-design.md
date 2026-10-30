# AI settings and provider accounts

The user corrected the first implementation: provider/model selection belongs in Settings, with account/login management. This correction authorizes this scoped implementation; preserve existing AI planning/preview/history behavior.

## User experience

Add Cài đặt AI / AI settings in the app header and an entry beside the AI section's active model summary. Move provider/model selectors and refresh into an accessible settings dialog. The arrangement section keeps direction, Generate/Cancel, proposal/review/apply/history, and a compact active-model summary. Persist the model selection in browser preferences, never project data or credentials.

Settings includes a default-model group and an account group. The account group lists configured providers with redacted account labels and individual credential IDs. Offer all SDK-supported login entries, including providers not authenticated yet. Use accurate status: configured credentials are not proof of live provider connectivity. Explain that OMP login storage is shared on this machine. Individual logout requires a clear confirmation and removes only the selected stored credential; environment/config credentials remain managed externally.

Login is initiated ONLY by clicking Login. Use Oh My Pi authStorage.oauth.login callbacks, not shell commands: display SDK auth link/instructions, prompt fields (password input for secret prompts), progress, cancel/retry and completion. User opens provider URL and completes consent themselves. Never auto-login or perform real login/logout during automated tests. Do not persist prompt answers, URLs, auth codes or secrets in browser storage, project files or logs. Once a prompt is submitted immediately clear the input. Only allow http(s) auth links and text-render instructions/prompts.

## API contract

Existing GET /api/ai/models and POST /api/ai/arrange remain unchanged.

- GET /api/ai/accounts -> `{providers:[{id,name,configured,loginAvailable,modelCount,source?,accounts:[{id,label,kind}]}],loginProviders:[{id,name,provider}]}`. Account credential IDs are strings. `provider` maps login aliases to the stored model-provider namespace. All fields are explicitly allowlisted; no tokens, API keys, auth headers or provider configuration objects. Mask account emails in labels.
- POST /api/ai/login `{provider}` -> flow snapshot.
- GET /api/ai/login/{id} -> flow snapshot.
- POST /api/ai/login/{id}/input `{promptId,value}` -> current flow snapshot. Prevent stale prompt submissions. Bound values to 16 KiB.
- DELETE /api/ai/login/{id} -> cancelled snapshot.
- POST /api/ai/logout `{provider,credentialId}` -> `{removed:true}`. Only stored exact matching credential; reject unknown IDs/provider mismatch.

Flow snapshot: `{id,provider,status,expiresAt,auth?:{url,instructions},prompt?:{id,message,placeholder,secret,allowEmpty},message?}`; status is `starting|waiting|input|success|error|cancelled`. UI polls at <=1Hz only for a live flow. Expire flows after 10 minutes, at most one live flow at a time, keep bounded terminal snapshots briefly for polling. Unknown expired IDs return 404. Signal abort must reject pending prompts and stop the SDK flow; never serialize callback answers or credentials. Strip raw SDK failures to a recoverable safe message.

Same loopback/same-origin checks and bounded JSON body reader apply to auth routes (including read account/status checks); unsupported methods fail. Generation and auth mutations should not race on shared credentials: reject login/logout while inference is running, reject inference during a live login, and permit account/model reads. Account status and models refresh after successful login/logout. Offline metadata refresh is sufficient; provider login itself may perform network authentication, initiated by the user. Metadata-only startup does not prompt or invoke a model.

## Implementation boundaries

`server/omp.ts` owns provider/auth SDK adapter methods. `server/auth.ts` owns flow state/callback lifecycle with injected adapter for tests. `server/server.ts` owns HTTP guards/routes. `src/12_ai_ui.js` and optional `src/12_ai_settings.js` own settings/panel presentation and saved model choice. `app/style.css` extends incumbent dark editor styles with responsive native dialog/focus states. Frontend remains Vietnamese/English with English fallback.

## Verification

Test-first SDK adapter metadata redaction, only-explicit-login, callback prompts/link/completion/error/cancel/expiry, stale submissions, per-credential logout, shared-credential race guards, same-origin/body/method protections. Run temporary credential stores/fixtures only. UI tests verify settings placement, open/close/focus, secret field masking and clearing, persisted model identity, logged-out/no-model state, login lifecycle, and existing preview/history regression. Real browser desktop/mobile verification uses simulated auth endpoints and real read-only provider metadata, never actual account changes. Build seven editions and run syntax/i18n checks.

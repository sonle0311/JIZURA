# AI arrangement with Oh My Pi

JIZURA uses the `@oh-my-pi/pi-coding-agent` SDK to propose typography and motion for lyric lines. The browser renderer and MP4 exporter stay the same.

## Run locally

Install Bun 1.4.4 or newer, then run these commands from the repository root:

```powershell
bun install
python build.py
bun run start
```

Open http://127.0.0.1:8766/vi/ (Vietnamese) or http://127.0.0.1:8766/en/ (English). To choose another port in PowerShell, run `$env:PORT='8767'` before `bun run start`.

Open **Cài đặt AI / AI settings** from the header or the arrangement section to configure your default provider/model and provider accounts. Your selection is saved in this browser, separately from project files. If a saved model becomes unavailable, select a replacement explicitly before generating.

The **Dàn dựng bằng AI / Arrange with AI** section below the lyric editor shows the active model, optional direction and proposal actions. Review the proposal's summary, per-line explanation and techniques, then apply it. **Previous arrangement** returns to the previous look; the editor's existing previous/next variation buttons also work.

## Providers and authentication

Providers and available models come from Oh My Pi's model registry. Use the same OMP profile, provider credentials, environment variables and `~/.omp/agent/models.yml` configuration as your terminal installation. The application does not implement its own provider clients or store keys in project JSON or browser storage.

In **AI settings → Provider accounts**, select a login method and click **Sign in**. Follow the provider link yourself, or enter the requested code/API key in the masked field when the SDK requests secret input. Submit to continue; inputs are cleared immediately. Cancel or close Settings to stop the login. Successful login refreshes accounts and models. The auth flow expires after ten minutes. Some provider-specific setup still requires a running local engine, an external credential source or OMP configuration.

Existing `omp login` sessions also work; refresh models to pick up terminal changes. Accounts and credentials are shared with OMP on this machine. **Sign out** asks for confirmation and removes only the selected stored AI-provider credential; environment variables and keys pinned in external configuration remain managed externally. Unrelated MCP/service credentials are excluded from this UI and cannot be removed through its account API. Account labels mask email addresses and include a local credential ID for distinction. Configured credentials are not proof of a successful live connection. Model/account discovery does not invoke inference; generation follows the selected provider's billing/subscription rules.

Official references:

- SDK: https://github.com/can1357/oh-my-pi/blob/main/docs/sdk.md
- Providers: https://github.com/can1357/oh-my-pi/blob/main/docs/providers.md

## Data and behavior

On generation, the selected model receives parsed lyrics, each line's timing and lock status, the direction you enter, and a bounded catalogue of permitted styles/techniques with mood tags. When audio is loaded it also receives estimated tempo, per-line normalized energy and beat counts. The waveform/audio file, project files, credentials and unrelated local files are not included. Requests use a tool-free, in-memory agent session with ambient extensions, skills, MCP and LSP disabled. There is no persistent chat history for these arrangements. See [local audio/lyric synchronization](AUDIO_SYNC.md) to create timing automatically before arranging.

Only IDs in the supplied catalogue can be applied. The catalogue follows the editor's technique switches and enabled pools, with at most 36 choices per category. AI explains choices in text; it does not generate or execute animation code.

Applying a proposal preserves lyrics, timing, output settings, audio, cut counts, cut times and locked lines. Existing per-cut visual overrides on changed lines are replaced so the new per-line choices can take effect. A global style change is only available when there are no locked lines. Existing palette/font choices are retained. Manual edits or project changes invalidate a pending proposal; generate it again before applying.

Limits: 200 lyric lines, 30,000 raw lyric characters, 2,000 direction characters, 1 MB request body, one generation at a time, and a 120-second request deadline. Cancel stops the active request. A provider that is still cleaning up may keep the service busy briefly after cancellation.

## Static hosting and After Effects

`python build.py` continues to build all seven standalone HTML editions. Editing and export work on static hosting as before. AI generation and account management require the Bun server on the same origin; GitHub Pages, direct `file://` pages and CEP panels display setup help when the API is unavailable. This feature does not add AI login to After Effects.

## Local API

`GET /api/ai/models` returns `{ "models": [{ "provider": "…", "id": "…", "name": "…" }] }` for available models. It never returns credentials or provider headers.

Account APIs (same-origin loopback access only):

- `GET /api/ai/accounts`: safe configured-provider/account metadata and supported login entries; credential IDs are strings.
- `POST /api/ai/login` with `{ "provider": "login-provider-id" }`: begin an explicit SDK login and return a flow snapshot.
- `GET /api/ai/login/{id}`: poll flow status once per second while active.
- `POST /api/ai/login/{id}/input` with `{ "promptId": "current-prompt-id", "value": "user-input" }`: answer the current prompt. Values are limited to 16 KiB and never echoed.
- `DELETE /api/ai/login/{id}`: cancel the flow.
- `POST /api/ai/logout` with `{ "provider": "model-provider-id", "credentialId": "stored-id" }`: remove that exact stored credential after the UI confirmation.

Flow statuses are `starting`, `waiting`, `input`, `success`, `error`, or `cancelled`. Active snapshots may include a login URL/instructions and a prompt with `secret`/`allowEmpty` flags. Terminal snapshots remove those fields. New login, logout and generation are mutually excluded while credential mutations are running. If an upstream SDK operation cannot stop immediately, cancellation hides the flow but retains this lock until it settles; a provider may have completed a credential write just before cancellation.

`POST /api/ai/arrange` accepts JSON:

```json
{
  "provider": "configured-provider",
  "model": "configured-model",
  "direction": "A quiet opening that builds toward hope",
  "lines": [{"index": 0, "text": "We rise again", "start": 0.4, "end": 3.2, "locked": false}],
  "catalog": {
    "style": [{"id": "noir", "name": "Noir"}],
    "layout": [{"id": "center", "name": "Center"}],
    "enter": [], "hold": [], "exit": [], "decor": [],
    "treat": [], "bg": [], "cam": [], "trans": []
  }
}
```

The response contains `summary`, optional `style`, and `lines`. Each unlocked input line must appear once, with its `index`, `reason`, and at least one of `layout`, `enter`, `hold`, `exit`, `decor`, `treat`, `bg`, `cam`, `trans`. `decor` is an array of up to three IDs; other technique values are single IDs. Locked lines are omitted from the response. These catalogue IDs are examples; use the browser-generated catalogue for a real project.

Errors return `{ "error": { "code": "…", "message": "…" } }` with 400 for bad input/model, 403 for cross-origin access, 413 for oversized input, 429 for busy, 502 for invalid model output/provider failures, or 504 for deadline expiry. The server binds only to `127.0.0.1` and serves an allowlist of built pages/assets.

## Verification

```powershell
bun run test
python dev/ai_browser_test.py
python dev/ai_settings_browser_test.py
```

Browser tests expect the Bun server on port 8766 unless `JIZURA_TEST_URL` is set. They intercept AI/auth APIs with explicitly simulated responses to exercise settings, login prompts, cancellation, individual logout confirmation, model persistence, preview, application and history. No real login/logout or external inference runs. Unit tests cover validation, preservation, restricted session lifecycle and HTTP guards. Provider discovery is separately checked with the real SDK; successful discovery alone does not prove inference/auth refresh with every provider.

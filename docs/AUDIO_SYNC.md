# Transcribe audio and build lyric scenes

The app takes lyrics directly from audio. Entered lyrics are neither sent as a prompt nor compared against recognition. Recognized segments and their observed timestamps replace the current lyric sheet and regenerate scene cuts in one action. Oh My Pi remains the separate creative arrangement feature.

## Setup

Requires Python 3.12, Bun 1.4.4+ and FFmpeg on PATH:

```powershell
python alignment/setup.py
bun install
python build.py
bun run start
```

Open the local host at `http://127.0.0.1:8766/vi/`, or the configured PORT. The current development instance uses port 8768 with Bun watch mode.

The isolated CPU environment is `.venv-sync`; public model downloads are cached in `.alignment-cache`. Neither is committed. Readiness allows up to 60 seconds for cold Windows imports.

## Use

1. Choose audio, up to 10 minutes. Lyrics can be empty or unrelated.
2. Click **Lấy lời từ audio và dựng cảnh / Transcribe audio and build scenes**.
3. Wait for recognition; cancel stops the local worker and cleans temporary uploads.
4. Recognized text automatically replaces the lyric field, saves line start/end times and rebuilds the scene list. No match checkboxes or second Apply step are involved. Rare recognized punctuation that could be interpreted as lyric commands is quoted with a leading backslash so rows keep their measured timestamps.
5. Edit any misheard words in the ordinary editor. **Hoàn tác lời và cảnh / Undo lyrics and scenes** or Ctrl+Z restores the previous lyrics, timing, per-line overrides and export range. Redo restores the generated result.

Generating a new sheet clears old per-line overrides/locks and export range because line numbers may change. Global visual choices are retained. Project/audio edits invalidate pending results; empty recognition leaves the project unchanged. The main editor remains available while a job runs.

## Processing

The local faster-whisper multilingual `base` model runs on CPU int8. Silero VAD is tried first. If it keeps less than 20% of the song or yields no usable transcript, recognition retries once without VAD, redetecting language on the original audio when set to auto. The joint speech/text-score rejection is retained; speech-absence probability alone does not discard singing.

Direct transcription does not run CTC alignment or lyric-token matching. It uses ASR segment text and measured bounds, normalizes each row to one line and resolves overlapping segment starts within those bounds. It never invents equal-duration timing from an entered sheet. A review score does not block generated text from entering the editor. Transcription may mishear singing, backing vocals or strong accompaniment; automatic scene creation does not imply word-perfect transcription.

Audio stays on the machine. The browser creates mono16kHzPCM16 WAV from the current decoded buffer. Subsequent optional OMP arrangement receives the new lyrics/timing and scalar tempo/energy/beat context, not the waveform.

## API and bounds

- GET `/api/sync/status`
- POST `/api/sync/jobs` multipart fields `audio` and `metadata`.
- Direct metadata: `{mode:"transcribe",language:"auto",lines:[]}`. Existing lyric text must not be supplied.
- GET/DELETE `/api/sync/jobs/{id}` for progress/cancel.
- Result: `{language,duration,lines:[{index,text,start,end,confidence,status}],warnings}`. Direct row count may differ from the old sheet; indexes are sequential. Silence returns an empty list.
- Maximum 600 seconds,24MiB upload,200 generated rows and30000 text characters; reaching either output limit shows an explicit partial-transcription warning. One job runs at a time, with a30-second upload deadline and20-minute job deadline.
- Temporary audio/metadata are removed after completion/failure/cancellation. Up to8 terminal results remain in memory for15minutes.
- `JIZURA_SYNC_PYTHON` can select a Python executable; the project venv is the default.

The API retains legacy lyric alignment when mode is omitted or set to `align`, using source lyric rows and exact text/index validation. That compatibility path uses WhisperX CTC and conservative monotonic comparison; it is not the current app button. Its Vietnamese adapter preserves the VLSP2020 checkpoint's feature projection rather than dropping its weights. [Checkpoint architecture reference](https://huggingface.co/nguyenvulebinh/wav2vec2-base-vi-vlsp2020#usage).

## Verification

```powershell
bun run test
.venv-sync/Scripts/python.exe -m unittest discover -s alignment
python dev/sync_browser_test.py
python dev/sync_live_browser_smoke.py --audio "path/to/song.wav"
```

Set JIZURA_TEST_URL to the running host when it differs from port8766. Browser regression covers desktop/mobile, empty or unrelated entered lyrics, automatic replacement/times/cuts, full Undo, cancellation and stale guards. Tests verify that direct mode never calls lyric matching or CTC and supplies no lyric prompt.

Real browser verification on the complete145.6-second song “THÔI NÔI BÁNH BAO” produced32 ASR segments, replaced unrelated entered text, built cuts and restored the old sheet through Undo. This verifies the full pipeline, not word-perfect lyric accuracy. Static-only hosting and CEP retain ordinary editing/export; transcription requires the local Bun/Python host.

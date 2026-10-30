# Direct audio transcription

User clarified that lyrics must originate from audio; do not compare them to supplied lyrics.

- [x] Add opt-in transcribe API metadata with empty source lyrics; preserve legacy alignment contract.
- [x] Return ASR segment text and observed timestamps without CTC/lyric matching or lyric prompts.
- [x] Browser action needs only decoded audio; apply all recognized segments directly, including review scores.
- [x] Replace text and timing atomically, reset row-dependent overrides/range and regenerate cuts.
- [x] Keep stale/audio/cancel/busy guards and complete lyric/timing/settings Undo/Redo.
- [x] Add unit, API and desktop/mobile browser coverage.
- [x] Verify on actual song and update usage docs.

No recognized speech leaves the project unchanged. Recognition can mishear singing; this does not become a supplied-text mismatch. The existing local model/limits remain. Original lyric alignment is retained only for legacy API consumers.

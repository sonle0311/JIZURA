"""Local CPU speech recognition + bounded WhisperX alignment, JSON-lines CLI.

Only model weights/tokenizer data may be downloaded. Audio is never uploaded.
"""
import argparse
from array import array
import contextlib
import importlib.metadata
import json
import math
from numbers import Real
import os
from pathlib import Path
import re
import sys
import wave

try:
    from .matching import match_lines
except ImportError:  # Executed as `python alignment/worker.py`.
    from matching import match_lines

SAMPLE_RATE = 16000
MAX_SECONDS = 600
MAX_AUDIO_BYTES = 24 * 1024 * 1024
MAX_METADATA_BYTES = 256 * 1024
MAX_WINDOW_SECONDS = 30
MAX_WINDOW_CHARS = 700
CACHE_ROOT = Path(__file__).resolve().parents[1] / '.alignment-cache'


class InputError(ValueError):
    pass


def read_metadata(path):
    try:
        if Path(path).stat().st_size > MAX_METADATA_BYTES:
            raise InputError('metadata_too_large')
        metadata = json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError) as error:
        if isinstance(error, InputError):
            raise
        raise InputError('invalid_metadata') from None
    if not isinstance(metadata, dict) or not {'language', 'lines'} <= set(metadata) or set(metadata) - {'mode', 'language', 'lines'}:
        raise InputError('invalid_metadata')
    mode = metadata.get('mode', 'align')
    if mode not in ('align', 'transcribe'):
        raise InputError('invalid_metadata')
    language, lines = metadata['language'], metadata['lines']
    if not isinstance(language, str) or not re.fullmatch(r'auto|[a-z]{2,3}', language):
        raise InputError('invalid_language')
    if not isinstance(lines, list) or (len(lines) != 0 if mode == 'transcribe' else not 1 <= len(lines) <= 200):
        raise InputError('invalid_lines')
    seen, size = set(), 0
    for line in lines:
        if not isinstance(line, dict) or set(line) != {'index', 'text', 'locked'}:
            raise InputError('invalid_line')
        index, text = line['index'], line['text']
        if type(index) is not int or not 0 <= index <= 1_000_000 or index in seen:
            raise InputError('invalid_line_index')
        if not isinstance(text, str) or not text.strip() or any(ord(c)<32 and c not in '\t\r\n' for c in text):
            raise InputError('invalid_line_text')
        if type(line['locked']) is not bool:
            raise InputError('invalid_line_locked')
        seen.add(index)
        size += len(text)
    if size > 30000:
        raise InputError('lyrics_too_large')
    return metadata


def read_wave(path):
    try:
        if Path(path).stat().st_size > MAX_AUDIO_BYTES:
            raise InputError('audio_too_large')
        with wave.open(str(path), 'rb') as source:
            if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getframerate() != SAMPLE_RATE or source.getcomptype() != 'NONE':
                raise InputError('expected_mono_16khz_pcm16_wav')
            frames = source.getnframes()
            duration = frames / SAMPLE_RATE
            if not 0 < duration <= MAX_SECONDS:
                raise InputError('invalid_audio_duration')
            pcm = source.readframes(frames)
            if len(pcm) != frames * 2:
                raise InputError('truncated_audio')
    except (OSError, EOFError, wave.Error):
        raise InputError('invalid_audio') from None
    samples = array('h')
    samples.frombytes(pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    return samples, duration


def check_dependencies():
    """Import dependencies, without instantiating or downloading any model."""
    try:
        with contextlib.redirect_stdout(sys.stderr):
            import faster_whisper  # noqa: F401
            import whisperx.alignment  # noqa: F401
            import torch
        return {'available':True, 'engine':'whisperx', 'device':'cpu',
                'version':importlib.metadata.version('whisperx'),
                'message':'Local CPU engine ready. First alignment may download public model weights.'}
    except Exception:
        return {'available':False, 'engine':'whisperx', 'device':'cpu',
                'message':'Local alignment dependencies are unavailable. Run python alignment/setup.py.'}


def align_segments(whisperx, model, align_metadata, audio, segments, progress):
    """Never submit a whole song to the CTC trellis; crop each ASR segment."""
    words, skipped = [], 0
    duration = len(audio) / SAMPLE_RATE
    for position, segment in enumerate(segments):
        start, end, text = segment.get('start'), segment.get('end'), segment.get('text', '')
        valid = all(isinstance(t, Real) and not isinstance(t, bool) and math.isfinite(t) for t in (start, end))
        if not valid or not isinstance(text, str) or not text.strip() or not 0 <= start < end <= duration or end-start > MAX_WINDOW_SECONDS or len(text) > MAX_WINDOW_CHARS:
            skipped += 1
            continue
        first, last = int(start*SAMPLE_RATE), min(len(audio), math.ceil(end*SAMPLE_RATE))
        if last-first < 400:
            skipped += 1
            continue
        cropped = audio[first:last]
        base = first / SAMPLE_RATE
        local = {'start':0.0, 'end':len(cropped)/SAMPLE_RATE, 'text':text}
        # No interpolation: untimed words must remain missing rather than inventing evidence.
        aligned = whisperx.align([local], model, align_metadata, cropped, 'cpu',
                                interpolate_method='ignore', return_char_alignments=False,
                                print_progress=False)
        for word in aligned.get('word_segments', []):
            word_start, word_end = word.get('start'), word.get('end')
            if not all(isinstance(t, Real) and not isinstance(t, bool) and math.isfinite(t) for t in (word_start, word_end)):
                continue
            if not 0 <= word_start < word_end <= local['end']:
                continue
            # WhisperX's pandas aggregation returns NumPy real scalars. Accept
            # those acoustic values and normalize at the dependency boundary.
            score = word.get('score', 0)
            score = float(score) if isinstance(score, Real) and not isinstance(score, bool) and math.isfinite(score) else 0.0
            words.append({'word':word.get('word', ''), 'start':round(float(base+word_start), 4),
                          'end':round(float(base+word_end), 4), 'score':score})
        progress('aligning', .55 + .35*(position+1)/max(1,len(segments)))
    return words, skipped


def transcribe_segments(model, audio, duration, language, progress, lyrics=()):
    """Retry music that speech VAD truncates, retaining Whisper's joint silence test."""
    # A short local spelling hint helps recognize sung Vietnamese. Timings still
    # require independent acoustic alignment; the prompt never supplies times.
    prompt = ' '.join(' '.join(line['text'] for line in lyrics).split()[:128])
    def run(vad, selected_language, offset):
        iterator, info = model.transcribe(
            audio, language=selected_language, beam_size=5, vad_filter=vad,
            word_timestamps=False, condition_on_previous_text=False,
            initial_prompt=prompt or None,
            vad_parameters={'min_silence_duration_ms':500})
        segments, chars = [], 0
        for segment in iterator:
            # Whisper considers silence only when BOTH signals are weak.
            # Singing often has high no_speech_prob despite a usable transcript.
            if not (segment.no_speech_prob > .6 and segment.avg_logprob <= -1.0):
                text = segment.text.strip()
                if text and 0 <= segment.start < min(duration, segment.end):
                    segments.append({'start':float(segment.start), 'end':min(duration,float(segment.end)), 'text':text})
                    chars += len(text)
            progress('transcribing', offset + .16*min(1,segment.end/duration))
            if len(segments) > 2000 or chars > 60000:
                raise InputError('recognition_limit_exceeded')
        return segments, info

    selected_language = None if language == 'auto' else language
    segments, info = run(True, selected_language, .15)
    retried = False
    if not segments or info.duration_after_vad < duration * .2:
        progress('retrying_singing', .32)
        # A truncated VAD pass may identify the wrong language. Detect again on
        # the original audio unless the caller explicitly chose a language.
        alternative, retry_info = run(False, selected_language, .33)
        if alternative and (not segments or sum(len(s['text']) for s in alternative) >= sum(len(s['text']) for s in segments)):
            segments, info, retried = alternative, retry_info, True
    return info.language, segments, retried


def recognize(samples, duration, language, progress, lyrics=(), *, transcribe_only=False):
    """Multilingual base/int8 ASR followed by language-specific wav2vec2 CTC."""
    (CACHE_ROOT / 'nltk').mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('NLTK_DATA', str(CACHE_ROOT / 'nltk'))
    import numpy as np
    from faster_whisper import WhisperModel
    audio = np.asarray(samples, dtype=np.float32) / 32768.0
    progress('loading_model', .05)
    model = WhisperModel('base', device='cpu', compute_type='int8', download_root=str(CACHE_ROOT / 'whisper'),
                         cpu_threads=min(4, os.cpu_count() or 1), num_workers=1)
    progress('transcribing', .15)
    if transcribe_only:
        detected, segments, retried = transcribe_segments(model, audio, duration, language, progress)
    else:
        detected, segments, retried = transcribe_segments(model, audio, duration, language, progress, lyrics)
    del model
    if not segments:
        return detected, [], ['no_speech_detected']
    if transcribe_only:
        return detected, segments, ['singing_vad_retry'] if retried else []
    import torch
    import whisperx
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    progress('loading_alignment_model', .52)
    try:
        (CACHE_ROOT / 'alignment').mkdir(parents=True, exist_ok=True)
        if detected == 'vi':
            try:
                from .vietnamese_model import load_vietnamese_alignment
            except ImportError:
                from vietnamese_model import load_vietnamese_alignment
            align_model, align_metadata = load_vietnamese_alignment(CACHE_ROOT / 'alignment')
        else:
            align_model, align_metadata = whisperx.load_align_model(language_code=detected, device='cpu', model_dir=str(CACHE_ROOT / 'alignment'))
    except ValueError:
        # Unsupported languages must not borrow timestamps from a different model.
        return detected, [], ['alignment_model_unavailable']
    words, skipped = align_segments(whisperx, align_model, align_metadata, audio, segments, progress)
    warnings = ['singing_vad_retry'] if retried else []
    if skipped:
        warnings.append('some_segments_exceeded_alignment_bounds')
    if not words:
        warnings.append('no_aligned_words')
    return detected, words, warnings


def transcription_lines(segments, duration, warnings=None):
    """Keep ASR text and observed bounds, resolving overlaps without a time grid."""
    lines, chars = [], 0
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        start, end, text = segment.get('start'), segment.get('end'), segment.get('text')
        if not all(isinstance(t, Real) and not isinstance(t, bool) and math.isfinite(t) for t in (start, end)):
            continue
        if not isinstance(text, str) or not text.strip() or any(ord(c)<32 and c not in '\t\r\n' for c in text):
            continue
        text = ' '.join(text.split())
        start, end = max(0.0, float(start)), min(duration, float(end))
        if lines:
            start = max(start, lines[-1]['end'], lines[-1]['start'] + .05)
        start, end = round(start, 6), min(duration, round(end, 6))
        if start >= end:
            continue
        if len(lines) >= 200 or chars + len(text) > 30000:
            if warnings is not None:
                warnings.append('transcript_truncated')
            break
        lines.append({'index':len(lines), 'text':text, 'start':start, 'end':end,
                      'confidence':0.5, 'status':'review'})
        chars += len(text)
    return lines


def process(audio_path, metadata_path, progress):
    metadata = read_metadata(metadata_path)
    direct = metadata.get('mode') == 'transcribe'
    samples, duration = read_wave(audio_path)
    # Near-digital silence is conclusive without importing/downloading a model.
    rms = math.sqrt(sum(float(value)*value for value in samples)/len(samples)) / 32768
    if rms < .0001:
        language = 'und' if metadata['language'] == 'auto' else metadata['language']
        words, warnings = [], ['no_speech_detected']
    else:
        with contextlib.redirect_stdout(sys.stderr):
            if direct:
                language, words, warnings = recognize(samples, duration, metadata['language'], progress, transcribe_only=True)
            else:
                language, words, warnings = recognize(samples, duration, metadata['language'], progress, metadata['lines'])
    if direct:
        lines = transcription_lines(words, duration, warnings)
    else:
        progress('matching', .93)
        lines = match_lines(metadata['lines'], words, duration)
    progress('completed', 1.0)
    return {'language':language, 'duration':duration, 'lines':lines, 'warnings':warnings}


def main(argv=None, output=None):
    output = output or sys.stdout
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--audio')
    parser.add_argument('--metadata')
    args = parser.parse_args(argv)
    def emit(event):
        output.write(json.dumps(event, ensure_ascii=False, allow_nan=False, separators=(',', ':'))+'\n')
        output.flush()
    if args.check:
        emit(check_dependencies())
        return 0
    if not args.audio or not args.metadata:
        emit({'type':'error','code':'invalid_arguments','message':'Audio and metadata paths are required.'})
        return 2
    try:
        def progress(stage, fraction):
            emit({'type':'progress', 'stage':stage, 'progress':round(fraction, 4)})
        result = process(args.audio, args.metadata, progress)
        emit({'type':'result','result':result})
        return 0
    except InputError as error:
        emit({'type':'error', 'code':str(error), 'message':'Audio or lyrics did not pass local alignment validation.'})
        return 2
    except Exception:
        # Do not leak local paths, lyrics, raw library exceptions or stacks over the API.
        emit({'type':'error','code':'alignment_failed','message':'Local alignment failed. Check model availability and the isolated Python setup.'})
        return 1


if __name__ == '__main__':
    # Native libraries can bypass contextlib.redirect_stdout. Preserve a private
    # protocol fd and route all other Python/native stdout into stderr.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), 'w', encoding='utf-8', buffering=1)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    raise SystemExit(main(output=protocol))

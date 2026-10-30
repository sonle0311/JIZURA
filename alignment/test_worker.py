import contextlib
import io
import json
import math
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

from alignment import worker


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.audio = self.root / 'input.wav'
        with wave.open(str(self.audio), 'wb') as out:
            out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            out.writeframes(b'\0\0' * 16000)
        self.metadata = self.root / 'metadata.json'
        self.metadata.write_text(json.dumps({'language':'auto','lines':[{'index':9,'text':'Hello world!','locked':False}]}), encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def test_actual_wave_duration_and_silence_return_no_fake_times(self):
        with patch.object(worker, 'recognize', side_effect=AssertionError('must not download models for silence')):
            result = worker.process(self.audio, self.metadata, lambda *args: None)
        self.assertEqual(result['duration'], 1)
        self.assertEqual(result['lines'][0]['status'], 'unmatched')
        self.assertIsNone(result['lines'][0]['start'])
        self.assertIn('no_speech_detected', result['warnings'])

    def test_metadata_preserves_indices_and_rejects_duplicate_or_invalid_lines(self):
        valid = worker.read_metadata(self.metadata)
        self.assertEqual(valid['lines'][0]['index'], 9)
        for lines in [[{'index':True,'text':'hi','locked':False}], [{'index':0,'text':'hi','locked':'no'}], [{'index':0,'text':'hi','locked':False}]*2, [{'index':0,'text':'x'*30001,'locked':False}]]:
            self.metadata.write_text(json.dumps({'language':'en','lines':lines}), encoding='utf-8')
            with self.assertRaises(worker.InputError):
                worker.read_metadata(self.metadata)

    def test_rejects_wrong_sample_format_and_overlong_wave(self):
        for rate, channels, frames in [(8000,1,8000),(16000,2,100),(16000,1,16000*601)]:
            with wave.open(str(self.audio), 'wb') as out:
                out.setparams((channels,2,rate,0,'NONE','not compressed'))
                out.writeframes(b'\0\0' * frames * channels)
            with self.assertRaises(worker.InputError):
                worker.read_wave(self.audio)

    def test_aligns_only_bounded_cropped_segments_and_rebases_word_times(self):
        class FakeWhisperX:
            def align(self, segments, model, metadata, audio, device, **kwargs):
                self.last = (segments, len(audio))
                return {'word_segments':[{'word':'hello','start':.2,'end':.7,'score':.9}]}
        fake = FakeWhisperX()
        words, skipped = worker.align_segments(fake, object(), {}, [0]*16000*80, [dict(start=5,end=7,text='hello'),dict(start=10,end=70,text='unsafe')], lambda *args: None)
        self.assertEqual(fake.last[1], 2*16000)
        self.assertEqual(fake.last[0][0]['start'], 0)
        self.assertAlmostEqual(words[0]['start'], 5.2)
        self.assertEqual(skipped, 1)

    def test_protocol_safe_error_has_json_only_and_no_private_trace(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = worker.main(['--audio',str(self.root/'missing.wav'),'--metadata',str(self.metadata)])
        self.assertNotEqual(code, 0)
        event = json.loads(output.getvalue())
        self.assertEqual(event['type'], 'error')
        self.assertNotIn(str(self.root), output.getvalue())

    def test_check_uses_import_readiness_without_model_loading(self):
        output=io.StringIO()
        with patch.object(worker, 'check_dependencies', return_value={'available':True,'engine':'whisperx','device':'cpu'}), contextlib.redirect_stdout(output):
            self.assertEqual(worker.main(['--check']),0)
        self.assertTrue(json.loads(output.getvalue())['available'])

class LanguageTests(unittest.TestCase):
    def test_auto_silence_is_explicitly_undetermined_language(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with wave.open(str(root/'s.wav'),'wb') as out:
                out.setparams((1,2,16000,0,'NONE','not compressed'))
                out.writeframes(b'\0\0'*1000)
            (root/'m.json').write_text(json.dumps({'language':'auto','lines':[{'index':0,'text':'hello','locked':False}]}))
            result=worker.process(root/'s.wav',root/'m.json',lambda *args:None)
            self.assertEqual(result['language'],'und')

class WhisperXScalarTests(unittest.TestCase):
    def test_real_whisperx_numpy_scalar_timestamps_are_preserved_as_python_floats(self):
        import numpy as np
        class RawWhisperX:
            def align(self, *args, **kwargs):
                return {'word_segments':[{'word':'hello','start':np.float64(.121),'end':np.float64(.222),'score':np.float64(.763)},
                                         {'word':'bad','start':True,'end':1.0,'score':1},
                                         {'word':'bad','start':np.float64('nan'),'end':1.0,'score':1}]}
        words,skipped=worker.align_segments(RawWhisperX(),object(),{},[0]*16000*3,[{'start':1.0,'end':2.0,'text':'hello'}],lambda *args:None)
        self.assertEqual(len(words),1)
        self.assertEqual(words[0]['start'],1.121)
        self.assertEqual(words[0]['end'],1.222)
        self.assertEqual(words[0]['score'],.763)
        self.assertIs(type(words[0]['start']),float)
        self.assertIs(type(words[0]['end']),float)
        self.assertIs(type(words[0]['score']),float)
        self.assertEqual(skipped,0)




class SingingRecognitionTests(unittest.TestCase):
    def segment(self, text='hello', no_speech=.85, logprob=-.8):
        return SimpleNamespace(start=1.,end=2.,text=text,no_speech_prob=no_speech,avg_logprob=logprob)

    def model(self, passes):
        class Model:
            def __init__(self): self.calls=[]
            def transcribe(inner,audio,**kwargs):
                inner.calls.append(kwargs)
                entry=passes[len(inner.calls)-1]
                rows,kept=entry[:2]
                return iter(rows),SimpleNamespace(language=entry[2] if len(entry)>2 else 'vi',duration_after_vad=kept)
        return Model()

    def test_does_not_discard_recognized_singing_when_text_score_is_good(self):
        model=self.model([([self.segment()],10.)])
        language,segments,retried=worker.transcribe_segments(model,[0]*160000,10,'auto',lambda *args:None)
        self.assertEqual(language,'vi')
        self.assertEqual(len(segments),1)
        self.assertFalse(retried)

    def test_retries_without_vad_when_singing_was_mostly_removed(self):
        model=self.model([([self.segment('wrong')],2.624),([self.segment('real singing')],45.)])
        language,segments,retried=worker.transcribe_segments(model,[0]*720000,45,'auto',lambda *args:None)
        self.assertEqual([c['vad_filter'] for c in model.calls],[True,False])
        self.assertIsNone(model.calls[1]['language'])
        self.assertEqual(segments[0]['text'],'real singing')
        self.assertTrue(retried)

    def test_auto_language_is_redetected_after_vad_kept_the_wrong_language(self):
        model=self.model([([],0.,'en'),([self.segment()],10.,'vi')])
        language,segments,_=worker.transcribe_segments(model,[0]*160000,10,'auto',lambda *args:None)
        self.assertIsNone(model.calls[1]['language'])
        self.assertEqual(language,'vi')
        self.assertEqual(len(segments),1)

    def test_retry_does_not_accept_low_quality_silence_hallucinations(self):
        model=self.model([([],0.),([self.segment(no_speech=.95,logprob=-1.5)],10.)])
        _,segments,_=worker.transcribe_segments(model,[0]*160000,10,'auto',lambda *args:None)
        self.assertEqual(segments,[])


class LyricPromptTests(unittest.TestCase):
    def test_recognizer_uses_bounded_supplied_lyrics_as_spelling_context(self):
        helper=SingingRecognitionTests()
        model=helper.model([([helper.segment()],10.)])
        lyrics=[{'text':'Mới hôm nào còn khóc oe oe.'}]+[{'text':'word '*300}]
        worker.transcribe_segments(model,[0]*160000,10,'auto',lambda *args:None,lyrics)
        prompt=model.calls[0]['initial_prompt']
        self.assertTrue(prompt.startswith('Mới hôm nào'))
        self.assertLessEqual(len(prompt.split()),128)


class DirectTranscriptionTests(unittest.TestCase):
    setUp = WorkerTests.setUp
    tearDown = WorkerTests.tearDown
    def direct_metadata(self):
        self.metadata.write_text(json.dumps({'mode':'transcribe','language':'auto','lines':[]}), encoding='utf-8')

    def test_direct_silence_returns_empty_rows_without_matching(self):
        self.direct_metadata()
        with patch.object(worker, 'match_lines', side_effect=AssertionError('must not match supplied lyrics')):
            result = worker.process(self.audio, self.metadata, lambda *args:None)
        self.assertEqual(result['lines'], [])
        self.assertEqual(result['language'], 'und')

    def test_direct_uses_recognized_text_and_real_timestamps(self):
        self.direct_metadata()
        segments = [{'start':.12,'end':.43,'text':'Recognized from audio'}, {'start':.6,'end':.9,'text':'Another phrase'}]
        with patch.object(worker, 'read_wave', return_value=([1000]*16000,1)), patch.object(worker, 'recognize', return_value=('en',segments,[])) as recognize, patch.object(worker, 'match_lines', side_effect=AssertionError('must not match')):
            result = worker.process(self.audio, self.metadata, lambda *args:None)
        self.assertEqual([r['text'] for r in result['lines']], ['Recognized from audio','Another phrase'])
        self.assertEqual([r['start'] for r in result['lines']], [.12,.6])
        self.assertEqual([r['index'] for r in result['lines']], [0,1])
        self.assertTrue(recognize.call_args.kwargs['transcribe_only'])
        self.assertEqual(recognize.call_args.args[4:], ())

    def test_direct_rows_discard_malformed_and_normalize_overlap_without_fabricating_grid(self):
        segments = [{'start':-.2,'end':.4,'text':'First'}, {'start':.01,'end':.8,'text':'Second'},
                    {'start':.7,'end':2,'text':'Last'}, {'start':float('nan'),'end':1,'text':'bad'},
                    {'start':True,'end':1,'text':'bad'}, {'start':.9,'end':1,'text':'bad\x00'}]
        rows = worker.transcription_lines(segments,1)
        self.assertEqual([r['text'] for r in rows], ['First','Second','Last'])
        self.assertEqual([r['start'] for r in rows], [0,.4,.8])
        self.assertEqual(rows[-1]['end'],1)
        self.assertTrue(all(r['status'] == 'review' for r in rows))

    def test_direct_rows_respect_result_limits(self):
        rows=worker.transcription_lines([{'start':i*.1,'end':i*.1+.08,'text':'x'*200} for i in range(210)],30)
        self.assertEqual(len(rows),150)
        self.assertLessEqual(sum(len(r['text']) for r in rows),30000)
        self.assertEqual(worker.transcription_lines([],1),[])

    def test_direct_rows_clamp_to_exact_audio_duration_and_separate_starts(self):
        duration = 1 / 16000
        rows = worker.transcription_lines([{'start':0,'end':1,'text':'short'}],duration)
        self.assertLessEqual(rows[0]['end'],duration)
        rows = worker.transcription_lines([{'start':0,'end':.01,'text':'one'}, {'start':.02,'end':.1,'text':'two'}],1)
        self.assertEqual(rows[1]['start'],.05)

    def test_direct_rows_normalize_whitespace_to_one_lyric_line(self):
        rows = worker.transcription_lines([{'start':0,'end':1,'text':' first\nsecond\t '}],1)
        self.assertEqual(rows[0]['text'],'first second')

class DirectRecognitionBoundaryTests(unittest.TestCase):
    def test_recognizer_returns_asr_segments_without_prompt_or_ctc(self):
        import numpy  # Load native modules before the temporary sys.modules patch.
        helper = SingingRecognitionTests()
        model = helper.model([([helper.segment('Original recognized words')],10.)])
        fake_torch = SimpleNamespace(set_num_threads=lambda n:None)
        fake_whisperx = SimpleNamespace(load_align_model=lambda **kwargs: self.fail('CTC must not gate recognition'))
        with patch.dict('sys.modules', {'torch':fake_torch, 'whisperx':fake_whisperx, 'faster_whisper':SimpleNamespace(WhisperModel=lambda *args,**kwargs:model)}), patch.object(worker, 'CACHE_ROOT', Path(tempfile.gettempdir())/'jizura-worker-test-cache'):
            language,segments,warnings=worker.recognize([1000]*160000,10,'auto',lambda *args:None,transcribe_only=True)
        self.assertEqual(language,'vi')
        self.assertEqual(segments,[{'start':1.,'end':2.,'text':'Original recognized words'}])
        self.assertEqual(warnings,[])
        self.assertIsNone(model.calls[0]['initial_prompt'])




class TranscriptTruncationTests(unittest.TestCase):
    def test_size_limit_emits_a_visible_partial_transcription_warning(self):
        warnings=[]
        segments=[dict(text='words',start=i,end=i+.5) for i in range(201)]
        lines=worker.transcription_lines(segments,300,warnings)
        self.assertEqual(len(lines),200)
        self.assertIn('transcript_truncated',warnings)


if __name__ == '__main__':
    unittest.main()

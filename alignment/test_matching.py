import unittest
from alignment.matching import match_lines, normalize


def words(text, offset=0, score=.95):
    return [dict(word=w, start=offset+i*.5, end=offset+i*.5+.4, score=score) for i,w in enumerate(text.split())]


class MatchingTests(unittest.TestCase):
    def test_repeated_choruses_consume_later_occurrences(self):
        lines=[dict(index=i,text=t) for i,t in enumerate(['hello world','walk with me','hello world'])]
        result=match_lines(lines,words('hello world walk with me hello world'),10)
        self.assertEqual([r['start'] for r in result],[0,1,2.5])
        self.assertTrue(all(r['status']=='matched' for r in result))

    def test_vietnamese_normalized_only_for_matching(self):
        text='Đêm nay, em ở đâu?'
        row=match_lines([dict(index=7,text=text)],words('dem nay em o dau'),5)[0]
        self.assertEqual(normalize('ĐÊM'),'dem')
        self.assertEqual(row['text'],text)
        self.assertEqual(row['index'],7)
        self.assertEqual(row['status'],'matched')

    def test_no_evidence_never_invents_intervals(self):
        rows=match_lines([dict(index=0,text='missing lyrics')],[],10)
        self.assertEqual((rows[0]['start'],rows[0]['end'],rows[0]['status']),(None,None,'unmatched'))

    def test_partial_and_weak_evidence_requires_review(self):
        row=match_lines([dict(index=0,text='one two three four')],words('one two',score=.4),10)[0]
        self.assertEqual(row['status'],'review')
        self.assertLess(row['confidence'],.75)

    def test_invalid_words_and_out_of_bounds_are_discarded(self):
        row=match_lines([dict(index=0,text='hello')],[dict(word='hello',start=-1,end=1,score=1),dict(word='hello',start=0,end=float('nan'),score=1)],2)[0]
        self.assertEqual(row['status'],'unmatched')

    def test_crossing_times_do_not_propose_overlapping_lines(self):
        rows=match_lines([dict(index=0,text='hello'),dict(index=1,text='world')],[dict(word='hello',start=2,end=3,score=1),dict(word='world',start=1,end=2,score=1)],4)
        self.assertEqual(rows[1]['status'],'unmatched')


class AdditionalMatchingTests(unittest.TestCase):
    def test_boolean_times_are_not_real_acoustic_evidence(self):
        row=match_lines([dict(index=0,text='hello')],[dict(word='hello',start=False,end=True,score=1)],2)[0]
        self.assertEqual(row['status'],'unmatched')

class AmbiguityTests(unittest.TestCase):
    def test_missing_repeated_chorus_is_never_auto_matched(self):
        rows=match_lines([dict(index=0,text='hello world'),dict(index=1,text='hello world')],words('hello world',offset=1),5)
        proposed=[row for row in rows if row['start'] is not None]
        self.assertTrue(proposed)
        self.assertTrue(all(row['status']=='review' and row['confidence']<.75 for row in proposed))

    def test_unique_context_before_or_after_missing_chorus_disambiguates(self):
        lines=[dict(index=i,text=t) for i,t in enumerate(['hello world','unique middle marker','hello world'])]
        for transcript, matched, missing in [('hello world unique middle marker',0,2),('unique middle marker hello world',2,0)]:
            rows=match_lines(lines,words(transcript),10)
            self.assertEqual(rows[matched]['status'],'matched')
            self.assertEqual(rows[missing]['status'],'unmatched')
            self.assertEqual(rows[1]['status'],'matched')

    def test_surrounding_context_does_not_resolve_missing_adjacent_duplicate(self):
        lines=[dict(index=i,text=t) for i,t in enumerate(['opening verse','hello world','hello world','closing verse'])]
        rows=match_lines(lines,words('opening verse hello world closing verse'),10)
        self.assertEqual(rows[0]['status'],'matched')
        self.assertEqual(rows[3]['status'],'matched')
        self.assertTrue(all(row['status']!='matched' for row in rows[1:3]))

    def test_extra_recognized_repetition_also_requires_review(self):
        rows=match_lines([dict(index=0,text='hello world')],words('hello world hello world'),10)
        self.assertEqual(rows[0]['status'],'review')


if __name__=='__main__': unittest.main()

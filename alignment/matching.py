"""Conservative monotonic lyric matching. Confidence is a heuristic, not probability."""
import math
import re
import unicodedata
from array import array


def normalize(text):
    text = unicodedata.normalize('NFD', text.casefold().replace('đ', 'd'))
    return ''.join(c for c in text if unicodedata.category(c) != 'Mn')


def tokens(text):
    return re.findall(r'[^\W_]+', normalize(text), re.UNICODE)


def match_lines(lines, words, duration):
    supplied = [(i,t) for i,line in enumerate(lines) for t in tokens(line['text'])]
    recognized = []
    previous_end = 0.0
    for word in words:
        start,end = word.get('start'),word.get('end')
        if not all(type(t) in (int,float) and math.isfinite(t) for t in (start,end)):
            continue
        if not (previous_end <= start < end <= duration):
            continue
        word_tokens=tokens(word.get('word',''))
        if len(word_tokens)!=1:
            continue
        score=word.get('score',0)
        score=max(0,min(1,score)) if isinstance(score,(int,float)) and math.isfinite(score) else 0
        recognized.append((word_tokens[0],float(start),float(end),score))
        previous_end=end
    # LCS consumes every occurrence at most once and preserves song order. Compact
    # backtrace is bounded by request/token limits rather than Python object matrices.
    n,m=len(supplied),len(recognized)
    if n*m > 25_000_000:
        raise ValueError('Too many recognized tokens to match safely')
    trace=bytearray(n*m)
    prev=array('H',[0])*(m+1)
    for i,(_,token) in enumerate(supplied):
        current=array('H',[0])*(m+1)
        for j,(other,*_) in enumerate(recognized):
            if token==other:
                current[j+1]=prev[j]+1
            elif prev[j+1] > current[j]:
                current[j+1]=prev[j+1]
            else:
                current[j+1]=current[j]
            # Retain every optimal transition, including skipping an equal token.
            # A single tie-breaking backtrace conceals missing/extra choruses.
            best=current[j+1]
            trace[i*m+j]=(1 if token==other and prev[j]+1==best else 0) | (2 if prev[j+1]==best else 0) | (4 if current[j]==best else 0)
        prev=current
    def backtrace(priority):
        chosen=[set() for _ in lines]
        i,j=n-1,m-1
        while i>=0 and j>=0:
            mask=trace[i*m+j]
            direction=next(direction for direction in priority if mask & direction)
            if direction==1:
                chosen[supplied[i][0]].add(j); i-=1; j-=1
            elif direction==2: i-=1
            else: j-=1
        return chosen
    chosen=backtrace((1,2,4))
    # Opposite boundary paths through the optimal LCS graph expose alternative
    # word ownership or occurrence times. Unique surrounding tokens constrain
    # those paths naturally; arbitrary duplicate tie-breaking adds no evidence.
    upper=backtrace((2,1,4))
    lower=backtrace((4,1,2))
    ambiguous=[chosen[i]!=upper[i] or chosen[i]!=lower[i] for i in range(len(lines))]
    anchors=[[recognized[j] for j in sorted(indices)] for indices in chosen]
    result=[]
    for line,hits,is_ambiguous in zip(lines,anchors,ambiguous):
        count=len(tokens(line['text']))
        coverage=len(hits)/max(count,1)
        score=sum(w[3] for w in hits)/max(len(hits),1)
        confidence=round(coverage*(.5+.5*score),4)
        start=min((w[1] for w in hits),default=None)
        end=max((w[2] for w in hits),default=None)
        # Single accidental shared words in a long line are insufficient evidence.
        if coverage < .4 or (count>=4 and len(hits)<2):
            start=end=None; status='unmatched'; confidence=0
        else:
            span=end-start
            plausible=span<=max(12,count*2) and coverage>=.8 and confidence>=.75
            status='matched' if plausible and not is_ambiguous else 'review'
            if is_ambiguous:
                confidence=min(confidence,.74)
        result.append(dict(index=line['index'],text=line['text'],start=start,end=end,confidence=confidence,status=status))
    return result

"""Direct audio transcription UI regression; real WAV decoding, simulated ASR."""
import json
import math
import os
import struct
import wave
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE=os.environ.get('JIZURA_TEST_URL','http://127.0.0.1:8766').rstrip('/')
OUT=Path(__file__).resolve().parent/'qa-output'
OUT.mkdir(exist_ok=True)
TONE=OUT/'sync-browser-tone.wav'
with wave.open(str(TONE),'wb') as audio:
    audio.setparams((1,2,16000,0,'NONE','not compressed'))
    audio.writeframes(b''.join(struct.pack('<h',int(1500*math.sin(i*math.tau*220/16000))) for i in range(24*16000)))

with sync_playwright() as p:
    channel='msedge' if Path('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe').exists() else None
    browser=p.chromium.launch(headless=True,**({'channel':channel} if channel else {}))
    for width,height,label in [(1440,1000,'desktop'),(390,844,'mobile')]:
        context=browser.new_context(viewport={'width':width,'height':height})
        context.add_init_script("localStorage.setItem('jizura.tourDone','1')")
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        state={'next':0,'hold':False,'empty':False,'deleted':[]}
        def api(route):
            request=route.request;part=request.url.split('/api/sync/')[1]
            if part=='status': route.fulfill(json={'available':True,'engine':'whisperx'})
            elif part=='jobs' and request.method=='POST':
                body=request.post_data_buffer
                assert b'"mode":"transcribe"' in body and b'"lines":[]' in body
                assert b'Entered lyrics should be ignored' not in body
                state['next']+=1
                route.fulfill(status=202,json={'id':f"simulated-{state['next']}",'status':'running','stage':'transcribing','progress':.4})
            elif request.method=='DELETE':
                state['deleted'].append(part);route.fulfill(json={'status':'cancelled'})
            else:
                job={'id':part.split('/')[1],'status':'running','stage':'transcribing','progress':.7}
                if not state['hold']:
                    rows=[] if state['empty'] else [
                        {'index':0,'text':'Words directly from audio','start':1,'end':3,'confidence':.4,'status':'review'},
                        {'index':1,'text':'A second recognized phrase','start':9,'end':11,'confidence':.5,'status':'review'}]
                    job.update(status='completed',result={'duration':24,'language':'en','warnings':[],'lines':rows})
                route.fulfill(json=job)
        page.route('**/api/sync/**',api)
        page.goto(BASE+'/vi/',wait_until='domcontentloaded')
        page.locator('#lyrics').fill('' if label=='desktop' else 'Entered lyrics should be ignored')
        expect(page.locator('#syncStart')).to_be_disabled()
        page.locator('#audioFile').set_input_files(str(TONE))
        expect(page.locator('#syncStart')).to_be_enabled(timeout=15000)
        original=page.evaluate('JSON.stringify(J.ui.project)')
        page.locator('#syncStart').click()
        expect(page.locator('#syncUndo')).to_be_visible(timeout=15000)
        expect(page.locator('#syncStatus')).to_contain_text('Đã chép lời từ audio')
        expect(page.locator('#syncApply')).to_be_hidden()
        assert page.locator('[data-sync-select]').count()==0
        assert page.locator('#lyrics').input_value()=='Words directly from audio\nA second recognized phrase'
        assert page.evaluate('J.ui.project.timing.lineTimes[0]')==1
        assert page.evaluate('J.ui.project.timing.lineEnds[1]')==11
        assert page.locator('#lineList .ln').count()==2
        assert page.evaluate('J.ui.plan.lines.every(l=>J.ui.plan.cuts.some(c=>c.line===l.index))')
        page.locator('#syncPanel').scroll_into_view_if_needed()
        page.screenshot(path=str(OUT/f'transcription-{label}.png'))
        page.locator('#syncUndo').click()
        before,after=json.loads(original),page.evaluate('J.ui.project')
        before['timing'].setdefault('lineEnds',{});after['timing'].setdefault('lineEnds',{})
        before.setdefault('exportRange',None);after.setdefault('exportRange',None)
        assert before==after, {k:(before.get(k),after.get(k)) for k in before.keys()|after.keys() if before.get(k)!=after.get(k)}
        state['empty']=True
        page.locator('#syncStart').click()
        expect(page.locator('#syncStatus')).to_contain_text('Chưa chép được lời',timeout=15000)
        assert page.evaluate('J.ui.project.lyrics')==before['lyrics']
        state['hold']=True
        page.locator('#syncStart').click();expect(page.locator('#syncCancel')).to_be_visible()
        page.locator('#syncCancel').click();expect(page.locator('#syncStatus')).to_contain_text('Đã hủy')
        page.locator('#syncStart').click();expect(page.locator('#syncCancel')).to_be_visible()
        page.locator('#lyrics').fill('Edited during recognition')
        expect(page.locator('#syncStatus')).to_contain_text('đã thay đổi')
        assert page.locator('#syncPanel').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
        assert not errors,errors
        assert state['deleted']
        print(label+': audio-only request, automatic lyrics/times/cuts, Undo, empty result, cancel and stale guards passed')
        context.close()
    browser.close()

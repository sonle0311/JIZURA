"""Opt-in real local-model browser smoke using generated speech, never cloud inference."""
import argparse
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dev/qa-output'
BASE = os.environ.get('JIZURA_TEST_URL', 'http://127.0.0.1:8766').rstrip('/')

parser=argparse.ArgumentParser()
parser.add_argument('--audio',default=str(OUT/'sync-smoke.wav'))
args=parser.parse_args()

with sync_playwright() as p:
    channel = os.environ.get('PLAYWRIGHT_CHANNEL')
    if channel is None and Path('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe').exists():
        channel = 'msedge'
    browser = p.chromium.launch(headless=True, **({'channel': channel} if channel else {}))
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    page.add_init_script("localStorage.setItem('jizura.tourDone','1')")
    page.goto(BASE + '/vi/', wait_until='domcontentloaded')
    page.locator('#lyrics').fill('These entered words must never be compared with the audio.')
    page.locator('#audioFile').set_input_files(args.audio)
    expect(page.locator('#syncStart')).to_be_enabled(timeout=75000)
    original = page.evaluate('JSON.stringify(J.ui.project)')
    page.locator('#syncStart').click()
    expect(page.locator('#syncUndo')).to_be_visible(timeout=180000)
    expect(page.locator('#syncApply')).to_be_hidden()
    assert page.locator('[data-sync-select]').count() == 0
    count=page.locator('#lineList .ln').count()
    assert count>0
    assert page.locator('#lyrics').input_value()!='These entered words must never be compared with the audio.'
    page.locator('#syncPanel').scroll_into_view_if_needed()
    page.screenshot(path=str(OUT / 'transcription-real.png'))
    expect(page.locator('#syncStatus')).to_contain_text('Đã chép lời từ audio')
    assert page.locator('#lineList .ln').count() == count
    assert not page.locator('#lineList').evaluate("e => e.closest('.sec').classList.contains('fold')")
    starts = page.locator('#lineList .time').evaluate_all('els => els.map(e => +e.value)')
    assert starts == page.evaluate('J.ui.plan.lines.map(l => +l.start.toFixed(2))')
    assert page.evaluate('J.ui.plan.lines.every(l => J.ui.plan.cuts.some(c => c.line === l.index))')
    times = page.evaluate('({starts:J.ui.project.timing.lineTimes,ends:J.ui.project.timing.lineEnds})')
    assert len(times['starts']) == count and len(times['ends']) == count
    (OUT/'transcription-real-project.json').write_text(json.dumps(page.evaluate('J.ui.project'),ensure_ascii=False,indent=2),encoding='utf-8')
    page.locator('#syncUndo').click()
    before, after = json.loads(original), page.evaluate('J.ui.project')
    before['timing'].setdefault('lineEnds', {})
    after['timing'].setdefault('lineEnds', {})
    before.setdefault('exportRange',None);after.setdefault('exportRange',None)
    assert before == after
    print(f'Real local browser smoke: {count} transcribed audio segments replaced unrelated lyrics, built scenes and were undone; no provider calls.')
    print(json.dumps(times))
    browser.close()

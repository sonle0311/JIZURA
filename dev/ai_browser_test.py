"""Browser regression test with simulated AI responses; never invokes a provider.

Start `bun run start`, then `python dev/ai_browser_test.py`.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('JIZURA_TEST_URL', 'http://127.0.0.1:8766').rstrip('/')
OUT = Path(__file__).resolve().parent / 'qa-output'
OUT.mkdir(exist_ok=True)


def run():
    with sync_playwright() as p:
        # Prefer an installed Edge on Windows; Playwright's browser download is optional.
        channel = os.environ.get('PLAYWRIGHT_CHANNEL')
        if channel is None and Path('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe').exists():
            channel = 'msedge'
        browser = p.chromium.launch(headless=True, **({'channel': channel} if channel else {}))
        for width, height, label in [(1440, 1000, 'desktop'), (390, 844, 'mobile')]:
            context = browser.new_context(viewport={'width': width, 'height': height})
            context.add_init_script("localStorage.setItem('jizura.tourDone', '1')")
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            mode = {'value': 'success'}
            requests = []
            held_routes = []

            def models(route):
                route.fulfill(json={'models': [{'provider': 'simulated', 'id': 'local-fixture', 'name': 'Simulated test model'}]})

            def arrange(route):
                body = route.request.post_data_json
                requests.append(body)
                if mode['value'] == 'failure':
                    route.fulfill(status=502, json={'error': {'code': 'provider_error', 'message': 'Simulated upstream failure'}})
                    return
                if mode['value'] == 'hold':
                    held_routes.append(route)
                    return  # Keep paused until the browser cancels the request.
                result = {'summary': 'SIMULATED: memory builds toward hope', 'lines': []}
                for line in body['lines']:
                    if not line['locked']:
                        result['lines'].append({'index': line['index'], 'reason': '<img src=x onerror=alert(1)> Hope rises.',
                                                'layout': body['catalog']['layout'][0]['id'],
                                                'enter': body['catalog']['enter'][0]['id'], 'decor': []})
                route.fulfill(json=result)

            page.route('**/api/ai/models', models)
            page.route('**/api/ai/arrange', arrange)
            page.goto(BASE + '/vi/', wait_until='networkidle')
            panel = page.locator('#aiArrangement')
            expect(panel).to_be_visible()
            expect(page.locator('#aiProvider')).to_have_value('simulated')
            page.locator('#aiDirection').fill('Mở đầu buồn, cuối bài hy vọng')
            original = page.evaluate('JSON.stringify(J.ui.project)')
            panel.get_by_role('button', name='Tạo đề xuất', exact=True).click()
            expect(panel.get_by_role('button', name='Áp dụng đề xuất', exact=True)).to_be_visible()
            assert page.evaluate('JSON.stringify(J.ui.project)') == original, 'Proposal applied without explicit action'
            assert not panel.locator('.ai-preview img').count(), 'Model text interpreted as HTML'
            assert 'audioName' not in requests[-1] and 'project' not in requests[-1]
            panel.scroll_into_view_if_needed()
            page.screenshot(path=str(OUT / f'ai-{label}-review.png'), full_page=True)
            panel.get_by_role('button', name='Áp dụng đề xuất', exact=True).click()
            expect(panel.locator('.ai-status')).to_contain_text('Đã áp dụng')
            applied = page.evaluate('JSON.stringify(J.ui.project)')
            assert applied != original
            before, after = json.loads(original), json.loads(applied)
            for key in ['lyrics', 'timing', 'fps', 'res', 'aspect', 'audioName', 'locks']:
                assert before.get(key) == after.get(key), f'Changed preserved setting: {key}'
            panel.get_by_role('button', name='Về phương án trước', exact=True).click()
            assert page.evaluate('JSON.stringify(J.ui.project)') == original, 'History did not restore original project'

            # Recover from a provider error, then refuse stale proposals.
            mode['value'] = 'failure'
            panel.get_by_role('button', name='Tạo đề xuất', exact=True).click()
            expect(panel.locator('.ai-status')).to_contain_text('Không tạo được')
            mode['value'] = 'success'
            panel.get_by_role('button', name='Thử lại', exact=True).click()
            expect(panel.get_by_role('button', name='Áp dụng đề xuất', exact=True)).to_be_visible()
            lyrics = page.locator('#lyrics')
            lyrics.fill(lyrics.input_value() + '\n# Edited after proposal')
            expect(panel.locator('.ai-status')).to_contain_text('Dự án đã thay đổi')
            expect(panel.get_by_role('button', name='Áp dụng đề xuất', exact=True)).to_be_hidden()

            mode['value'] = 'hold'
            panel.get_by_role('button', name='Tạo đề xuất', exact=True).click()
            expect(panel.get_by_role('button', name='Hủy', exact=True)).to_be_visible()
            panel.get_by_role('button', name='Hủy', exact=True).click()
            expect(panel.locator('.ai-status')).to_contain_text('Đã hủy')
            for route in held_routes:
                route.abort()
            assert panel.evaluate('(el) => el.scrollWidth <= el.clientWidth'), 'AI panel has horizontal overflow'
            assert not errors, errors
            print(f'{label}: preview/apply/history/error/stale/cancel/text-safety passed')
            context.close()

        # Exercise the real SDK discovery path without inference.
        response = browser.new_context().request.get(BASE + '/api/ai/models', timeout=30000)
        assert response.ok, response.status
        metadata = response.json()['models']
        assert all(set(model) == {'provider', 'id', 'name'} for model in metadata)
        print(f'real SDK discovery: {len(metadata)} models, {len(set(m["provider"] for m in metadata))} providers; no inference')
        browser.close()


if __name__ == '__main__':
    run()

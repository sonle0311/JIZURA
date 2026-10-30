"""Settings/auth UI regression with simulated endpoints. No real login/logout."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('JIZURA_TEST_URL', 'http://127.0.0.1:8766').rstrip('/')
OUT = Path(__file__).resolve().parent / 'qa-output'
OUT.mkdir(exist_ok=True)


def run():
    with sync_playwright() as p:
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
            state = {'flow': None, 'login': 0, 'input': 0, 'logout': 0, 'cancel': 0, 'removed': False}

            def api(route):
                request = route.request
                url = request.url.split('/api/ai/')[1]
                if url == 'models':
                    route.fulfill(json={'models': [
                        {'provider': 'simulated', 'id': 'first', 'name': 'Simulated first model'},
                        {'provider': 'simulated', 'id': 'second', 'name': 'Simulated preferred model'}]})
                elif url == 'accounts':
                    route.fulfill(json={'providers': [{
                        'id': 'simulated', 'name': 'Simulated provider', 'configured': True,
                        'loginAvailable': True, 'modelCount': 2, 'source': 'stored',
                        'accounts': [] if state['removed'] else [{'id': '9', 'label': 't***@example.test', 'kind': 'oauth'}]}],
                        'loginProviders': [{'id': 'simulated-login', 'name': 'Simulated Login', 'provider': 'simulated'}]})
                elif url == 'login' and request.method == 'POST':
                    state['login'] += 1
                    state['flow'] = {
                        'id': 'fixture-' + str(state['login']), 'provider': 'simulated-login',
                        'status': 'input' if state['login'] == 1 else 'waiting',
                        'expiresAt': 9999999999999,
                        'auth': {'url': 'https://example.test/login', 'instructions': 'SIMULATED: open the provider page yourself.'}}
                    if state['login'] == 1:
                        state['flow']['prompt'] = {'id': 'prompt-1', 'message': 'Simulated secret code', 'secret': True, 'allowEmpty': False}
                    route.fulfill(json=state['flow'])
                elif url.startswith('login/') and request.method == 'DELETE':
                    state['cancel'] += 1
                    state['flow']['status'] = 'cancelled'
                    state['flow'].pop('prompt', None)
                    route.fulfill(json=state['flow'])
                elif url.endswith('/input') and request.method == 'POST':
                    data = request.post_data_json
                    assert data['promptId'] == 'prompt-1'
                    assert data['value'] == 'simulated-secret-never-real'
                    state['input'] += 1
                    state['flow']['status'] = 'success'
                    state['flow'].pop('prompt', None)
                    route.fulfill(json=state['flow'])
                elif url.startswith('login/') and request.method == 'GET':
                    route.fulfill(json=state['flow'])
                elif url == 'logout' and request.method == 'POST':
                    data = request.post_data_json
                    assert data == {'provider': 'simulated', 'credentialId': '9'}
                    state['logout'] += 1
                    state['removed'] = True
                    route.fulfill(json={'removed': True})
                else:
                    route.fulfill(status=404, json={'error': {'code': 'not_found', 'message': 'Fixture endpoint not implemented'}})

            page.route('**/api/ai/**', api)
            page.goto(BASE + '/vi/', wait_until='networkidle')
            panel, dialog = page.locator('#aiArrangement'), page.locator('#aiSettingsDialog')
            expect(dialog).to_be_hidden()
            assert panel.locator('#aiProvider').count() == 0
            assert panel.locator('#aiModel').count() == 0
            assert state['login'] == 0, 'Login started automatically'
            if label == 'desktop':
                page.locator('#aiSettingsOpen').click()
            else:
                page.locator('#aiPanelSettings').click()
            expect(dialog).to_be_visible()
            expect(dialog.locator('#aiProvider')).to_be_visible()
            expect(dialog.locator('#aiModel')).to_be_visible()
            page.locator('#aiModel').select_option('1')
            page.locator('#aiSettingsClose').click()
            expect(dialog).to_be_hidden()
            page.reload(wait_until='networkidle')
            page.locator('#aiPanelSettings').click()
            expect(dialog).to_be_visible()
            expect(page.locator('#aiModel')).to_have_value('1')
            assert state['login'] == 0

            page.locator('#aiLoginProvider').select_option('simulated-login')
            page.locator('#aiLoginStart').click()
            secret = page.locator('#aiLoginInput')
            expect(secret).to_be_visible()
            expect(secret).to_have_attribute('type', 'password')
            auth_link = dialog.locator('a[href="https://example.test/login"]')
            expect(auth_link).to_have_attribute('rel', 'noopener noreferrer')
            secret.fill('simulated-secret-never-real')
            page.locator('#aiLoginSubmit').click()
            expect(page.locator('#aiAuthStatus')).to_contain_text('Đã đăng nhập')
            assert state['input'] == 1
            assert secret.input_value() == ''
            assert 'simulated-secret' not in page.evaluate('JSON.stringify(localStorage)')

            page.locator('#aiLoginStart').click()
            expect(page.locator('#aiLoginCancel')).to_be_visible()
            page.keyboard.press('Escape')
            expect(dialog).to_be_hidden()
            page.wait_for_function('!document.querySelector("#aiSettingsDialog").open')
            assert state['cancel'] == 1
            page.locator('#aiPanelSettings').click()
            page.locator('[data-credential-id="9"]').click()
            assert state['logout'] == 0, 'Logout occurred before confirmation'
            confirm = page.locator('[data-logout-confirm="9"]')
            expect(confirm).to_be_visible()
            confirm.click()
            expect(dialog.get_by_text('t***@example.test', exact=True)).to_have_count(0)
            assert state['logout'] == 1
            assert dialog.evaluate('(el) => el.scrollWidth <= el.clientWidth'), 'Settings overflow'
            page.screenshot(path=str(OUT / f'ai-settings-{label}.png'))
            assert not errors, errors
            print(f'{label}: settings placement/persistence/login/secret/close-cancel/logout confirmation passed (simulated)')
            context.close()
        browser.close()


if __name__ == '__main__':
    run()

"""Explicit real local alignment smoke; requires an audio/metadata fixture and running host."""
import json
import os
import sys
import time
import urllib.request
import uuid
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python dev/local_sync_smoke.py audio.wav metadata.json')
    base = os.environ.get('JIZURA_TEST_URL', 'http://127.0.0.1:8766').rstrip('/')
    audio = Path(sys.argv[1]).read_bytes()
    source = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8-sig'))
    boundary = 'jizura-' + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n'.encode()
            + json.dumps(source).encode() + f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="fixture.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
            + audio + f'\r\n--{boundary}--\r\n'.encode())
    request = urllib.request.Request(base + '/api/sync/jobs', data=body, method='POST',
                                     headers={'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Origin': base})
    with urllib.request.urlopen(request, timeout=45) as response:
        job = json.load(response)
    last = None
    deadline = time.monotonic() + 1250
    while time.monotonic() < deadline:
        stage = (job['status'], job['stage'])
        if stage != last:
            print(json.dumps({'status': job['status'], 'stage': job['stage'], 'progress': job.get('progress')}, ensure_ascii=False), flush=True)
            last = stage
        if job['status'] == 'completed':
            result = job['result']
            assert len(result['lines']) == len(source['lines'])
            previous = -1
            for line in result['lines']:
                assert line['status'] != 'unmatched', line
                assert 0 <= line['start'] < line['end'] <= result['duration']
                assert line['start'] >= previous
                previous = line['end']
            print(json.dumps(result, ensure_ascii=False), flush=True)
            Path('dev/qa-output/sync-real-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            return
        if job['status'] in ('failed', 'cancelled'):
            raise RuntimeError(json.dumps(job))
        time.sleep(2)
        with urllib.request.urlopen(base + '/api/sync/jobs/' + job['id'], timeout=30) as response:
            job = json.load(response)
    raise TimeoutError('Local smoke exceeded its deadline')


if __name__ == '__main__':
    main()

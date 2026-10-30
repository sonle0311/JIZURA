"""Install the local CPU alignment engine without changing global Python packages."""
import pathlib
import json
import subprocess
import sys
import venv

ROOT = pathlib.Path(__file__).resolve().parents[1]
ENV = ROOT / '.venv-sync'
PYTHON = ENV / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')


def main():
    if not PYTHON.exists():
        venv.EnvBuilder(with_pip=True).create(ENV)
    subprocess.run([str(PYTHON), '-m', 'pip', 'install',
                    'torch==2.8.0', 'torchaudio==2.8.0', 'torchvision==0.23.0',
                    '--index-url', 'https://download.pytorch.org/whl/cpu'], check=True)
    subprocess.run([str(PYTHON), '-m', 'pip', 'install', '-r',
                    str(ROOT / 'alignment/requirements.txt')], check=True)
    ready = subprocess.run([str(PYTHON), str(ROOT / 'alignment/worker.py'), '--check'], check=True,
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
    print(ready.stdout.strip())
    try:
        available = json.loads(ready.stdout).get('available') is True
    except (ValueError, AttributeError):
        available = False
    if not available:
        raise RuntimeError('Alignment dependencies could not be imported. Check the local Python environment before starting synchronization.')
    print('Local audio alignment is installed. Models download on the first synchronization.')


if __name__ == '__main__':
    main()

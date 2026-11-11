"""Update check and installation from the project's GitHub releases.

At launch Navi asks GitHub which release is the latest (no personal data is
sent). Installing is only offered by the packaged app: it downloads the
release archive, unpacks it in a temporary folder, then a small script copies
the new files over the install once Navi has stopped, and starts it again.
config.json, assets/ and maps/ are never removed. Set "check_updates": false
in config.json to disable the check.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import urllib.request
import zipfile
from pathlib import Path

from paths import BASE, FROZEN

REPOSITORY = 'Arizona-dev/Navi-companion'
ASSET = 'Navi-companion.zip'
FOLDER = 'Navi-companion'
LATEST = f'https://api.github.com/repos/{REPOSITORY}/releases/latest'
DOWNLOADS = f'https://github.com/{REPOSITORY}/releases/download/'
MAX_ARCHIVE = 400_000_000


def current_version(base=BASE):
    try:
        return (base / 'VERSION').read_text('utf-8').strip()
    except OSError:
        return '0'


def parse(version):
    numbers = [int(n) for n in re.findall(r'\d+', version)[:3]]
    return tuple(numbers + [0] * (3 - len(numbers)))


def enabled(base=BASE):
    try:
        return json.loads((base / 'config.json').read_text('utf-8-sig')).get('check_updates', True) is not False
    except (OSError, ValueError, AttributeError):
        return True


def safe_extract(archive, target):
    """Unpack the release archive, refusing any entry outside its single top folder."""
    target = target.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            name = member.filename.replace('\\', '/')
            destination = (target / name).resolve()
            if not name.startswith(FOLDER + '/') or target not in destination.parents:
                raise ValueError('Archive de mise à jour inattendue')
        bundle.extractall(target)
    return target / FOLDER


class Updater:
    def __init__(self, base=BASE, can_install=FROZEN):
        self.base = base
        self.lock = threading.Lock()
        self.state = {'current': current_version(base), 'latest': None, 'available': False, 'url': None,
                      'canInstall': can_install, 'status': 'idle', 'error': None}
        self.asset = None

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def update(self, **values):
        with self.lock:
            self.state.update(values)

    def start(self):
        if enabled(self.base):
            self.update(status='checking')
            threading.Thread(target=self.check, daemon=True).start()
        else:
            self.update(status='disabled')

    def check(self):
        try:
            request = urllib.request.Request(LATEST, headers={'User-Agent': 'Navi-companion', 'Accept': 'application/vnd.github+json'})
            with urllib.request.urlopen(request, timeout=8) as response:
                release = json.loads(response.read(2_000_000))
            latest = str(release['tag_name'])
            asset = next((a for a in release.get('assets', []) if a.get('name') == ASSET
                          and str(a.get('browser_download_url', '')).startswith(DOWNLOADS)), None)
            self.asset = asset
            self.update(latest=latest.lstrip('v'), url=str(release.get('html_url') or ''), status='ready', error=None,
                        available=parse(latest) > parse(self.state['current']),
                        canInstall=self.state['canInstall'] and asset is not None)
        except Exception as exc:  # offline, rate limit, unexpected answer: never block the app
            self.update(status='unavailable', error=str(exc))

    def install(self, stop):
        """Download and stage the update, then hand over to the copy script and stop Navi."""
        state = self.snapshot()
        if not (state['available'] and state['canInstall'] and self.asset):
            raise ValueError('Aucune mise à jour à installer.')
        if state['status'] == 'installing':
            return
        self.update(status='installing')
        try:
            work = Path(tempfile.mkdtemp(prefix='navi-update-'))
            archive = work / ASSET
            request = urllib.request.Request(self.asset['browser_download_url'], headers={'User-Agent': 'Navi-companion'})
            with urllib.request.urlopen(request, timeout=60) as response, archive.open('wb') as output:
                shutil.copyfileobj(response, output)
            size = archive.stat().st_size
            if size != int(self.asset.get('size', -1)) or size > MAX_ARCHIVE:
                raise ValueError('Téléchargement incomplet.')
            staged = safe_extract(archive, work / 'new')
            if not (staged / 'Navi.exe').is_file():
                raise ValueError('Archive de mise à jour inattendue')
            script = work / 'apply-update.cmd'
            script.write_text(apply_script(os.getpid(), staged, self.base, work), 'mbcs', newline='\r\n')
            subprocess.Popen(['cmd.exe', '/c', str(script)], cwd=str(work), stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True,
                             creationflags=0x00000008 | 0x00000200 | 0x08000000)  # detached, new group, no window
        except Exception as exc:
            self.update(status='ready', error=str(exc))
            raise ValueError(f'Mise à jour impossible : {exc}') from exc
        threading.Timer(1.0, stop).start()


def apply_script(pid, staged, install, work):
    return '\n'.join([
        '@echo off',
        ':wait',
        f'tasklist /FI "PID eq {pid}" 2>nul | find " {pid} " >nul && (ping -n 2 127.0.0.1 >nul & goto wait)',
        'taskkill /IM NaviOverlay.exe /F >nul 2>nul',
        'ping -n 2 127.0.0.1 >nul',
        f'robocopy "{staged}" "{install}" /E /R:5 /W:1 /XF config.json /NFL /NDL /NJH /NJS /NP >nul',
        f'cd /d "{install}"',
        f'start "" /D "{install}" "{install / "Navi.exe"}"',
        f'rmdir /s /q "{work}"',
        '',
    ])

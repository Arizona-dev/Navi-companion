"""Download the game images (icons, maps) from their public sources.

Nintendo's artwork is not distributed with Navi. This script fetches it once
into assets/ and maps/, following data/images-sources.json. Files already present
are kept; running the script again only downloads what is missing.
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

from paths import BASE


# Read by the application's launch screen.
PROGRESS = {'total': 0, 'done': 0, 'failed': 0, 'active': False}


def missing_images(base=BASE):
    entries = json.loads((base / 'data' / 'images-sources.json').read_text('utf-8'))
    return [e for e in entries if not (base / e['file']).is_file()]


def download(entry, base=BASE):
    target = (base / entry['file']).resolve()
    if base not in target.parents or target.suffix not in ('.webp', '.png'):
        raise ValueError('path refused')
    request = urllib.request.Request(entry['url'], headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(20_000_000)
    if hashlib.sha256(data).hexdigest() != entry['sha256']:
        raise ValueError('content differs from the expected version')
    target.parent.mkdir(exist_ok=True)
    partial = target.with_name(target.name + '.part')
    partial.write_bytes(data)
    partial.replace(target)


def main():
    todo = missing_images()
    PROGRESS.update(total=len(todo), done=0, failed=0, active=bool(todo))
    if not todo:
        return 0
    print(f'Downloading {len(todo)} game images (only once)...', flush=True)
    failed = []
    for index, entry in enumerate(todo, 1):
        try:
            download(entry)
        except (OSError, ValueError) as exc:
            failed.append(f"  {entry['file']}: {exc}")
        PROGRESS.update(done=index, failed=len(failed))
        if index % 20 == 0 or index == len(todo):
            print(f'  {index}/{len(todo)}', flush=True)
    PROGRESS['active'] = False
    if failed:
        print(f'{len(failed)} images could not be fetched (Navi works, they will be missing on screen):')
        print('\n'.join(failed[:15]))
        print('Start Navi again later to retry.')
        return 1
    print('Images ready.')
    return 0


if __name__ == '__main__':
    sys.exit(main())

"""Télécharge les images du jeu (icônes, plans) depuis leurs sources publiques.

Les visuels © Nintendo ne sont pas distribués avec Navi. Ce script les récupère
une fois, dans assets/ et maps/, d'après images-sources.json. Les fichiers déjà
présents sont conservés ; relancer le script ne télécharge que ce qui manque.
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent


def missing_images(base=BASE):
    entries = json.loads((base / 'images-sources.json').read_text('utf-8'))
    return [e for e in entries if not (base / e['file']).is_file()]


def download(entry, base=BASE):
    target = (base / entry['file']).resolve()
    if base not in target.parents or target.suffix not in ('.webp', '.png'):
        raise ValueError('chemin refusé')
    request = urllib.request.Request(entry['url'], headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(20_000_000)
    if hashlib.sha256(data).hexdigest() != entry['sha256']:
        raise ValueError('contenu différent de la version attendue')
    target.parent.mkdir(exist_ok=True)
    partial = target.with_name(target.name + '.part')
    partial.write_bytes(data)
    partial.replace(target)


def main():
    todo = missing_images()
    if not todo:
        return 0
    print(f'Téléchargement de {len(todo)} images du jeu (une seule fois)...', flush=True)
    failed = []
    for index, entry in enumerate(todo, 1):
        try:
            download(entry)
        except (OSError, ValueError) as exc:
            failed.append(f"  {entry['file']} : {exc}")
        if index % 20 == 0 or index == len(todo):
            print(f'  {index}/{len(todo)}', flush=True)
    if failed:
        print(f'{len(failed)} images non récupérées (Navi fonctionne, elles manqueront à l\'écran) :')
        print('\n'.join(failed[:15]))
        print('Relancez Navi plus tard pour réessayer.')
        return 1
    print('Images prêtes.')
    return 0


if __name__ == '__main__':
    sys.exit(main())

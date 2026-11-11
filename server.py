"""Read-only local companion. Save format/catalog: Traiver/OOT-SW2SE (MIT)."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import json, struct, base64, argparse, webbrowser, math, subprocess, os, re, sys
from quests import EPONA_SONG, quest_states
from live import LiveTracker
from map_position import locate_player
from paths import BASE, FROZEN
from updater import Updater
import download_images
import threading

UPDATES = Updater()
CATALOG = json.loads((BASE / 'catalog.json').read_text('utf-8'))
COLLECTIBLES = json.loads((BASE / 'collectibles.json').read_text('utf-8'))
TITLE_ID = '0400486024DEC000'
SETUP_HELP = ('Sauvegardes Fritchii introuvables. Placez le dossier Navi dans le dossier de Fritchii '
              '(ou juste à côté), ou copiez config.example.json en config.json et indiquez-y save_root.')

def find_save_root(base=BASE, env=None):
    """Save folder of the game: config.json when valid, otherwise a nearby Fritchii install."""
    env = os.environ if env is None else env
    try:
        configured = json.loads((base / 'config.json').read_text('utf-8-sig')).get('save_root')
        if configured and Path(configured).is_dir():
            return Path(configured)
    except (OSError, ValueError, AttributeError):
        pass
    # Navi placed inside the emulator folder, or next to it (portable "user" directory).
    folders = [base.parent, base.parent.parent]
    try:
        folders += [p for p in base.parent.iterdir() if p.is_dir() and p != base]
    except OSError:
        pass
    users = [folder / 'user' for folder in folders]
    if env.get('APPDATA'):
        users += [Path(env['APPDATA']) / name for name in ('Fritchii', 'fritchii', 'lichii', 'eden')]
    found = []
    for user in users:
        try:
            found += [p for p in user.glob(f'nand/user/save/0000000000000000/*/{TITLE_ID}') if p.is_dir()]
        except OSError:
            pass
    def newest(root):
        try:
            return max((p.stat().st_mtime for p in root.glob('slot_*/progress.sav')), default=0)
        except OSError:
            return 0
    return max(found, key=newest, default=None)

ROOT = find_save_root()
LIVE = LiveTracker(ROOT)
STATIC_IMAGE = re.compile(r'[A-Za-z0-9_-]+\.(webp|png)')

def activity_stats(save):
    # Fritchii/Eden playtime.bin: pairs of u64 program ID and elapsed seconds.
    # This is emulator time for the title, not a per-save active-play counter.
    seconds = None
    user_root = next((p for p in ROOT.parents if (p / 'play_time').is_dir()), None)
    if user_root:
        try:
            raw = stable_read(user_root / 'play_time' / 'playtime.bin')
            if len(raw) % 16 == 0:
                seconds = dict(struct.iter_unpack('<QQ', raw)).get(int(ROOT.name, 16))
        except (OSError, ValueError):
            pass
    fields = {r[2]: r for r in CATALOG['fields'] if len(r) > 2}
    records = []
    for name, label, unit in [
        ('MiniGame_HorsebackArchery_BestScore', 'Tir à l’arc à cheval', 'points'),
        ('MiniGame_HitTarget_BestScore', 'Stand de tir — enfant', 'points'),
        ('MiniGame_HitTarget_Kakariko_BestScore', 'Stand de tir — Cocorico', 'points'),
        ('Minigame_SkullKidSession_MaxRallyCount', 'Jeu d’ocarina — meilleur échange', 'manches'),
        ('MiniGame_Fishing_PlayCount', 'Parties de pêche', 'parties'),
    ]:
        row = fields.get(name)
        value = save.integer(row[0]) if row and row[0] in save.fields else None
        records.append({'label': label, 'value': value if value is not None and value >= 0 else None, 'unit': unit})
    return {'emulatorSeconds': seconds, 'records': records,
            'distanceWalkingKm': None, 'distanceHorseKm': None, 'distanceSwimmingKm': None}

class Save:
    def __init__(self, data, end):
        self.data = data
        if len(data) < end or struct.unpack_from('<III', data) != (0x01020304, 0x002D80EB, end):
            raise ValueError('Format de sauvegarde non pris en charge (Navi lit les sauvegardes du jeu en version 1.1.1)')
        self.end = end
        self.fields = {}
        for offset in range(40, end, 8):
            key = self.uint(offset)
            if not key: continue
            if key in self.fields: raise ValueError('Champ dupliqué')
            self.fields[key] = offset + 4
    def uint(self, offset): return struct.unpack_from('<I', self.data, offset)[0]
    def integer(self, key): return struct.unpack_from('<i', self.data, self.fields[key])[0]
    def block(self, key, length):
        offset = self.uint(self.fields[key])
        if offset < self.end or offset + length > len(self.data): raise ValueError('Bloc invalide')
        return offset
    def string(self, key, length=64):
        offset = self.block(key, length)
        return self.data[offset:offset+length].split(b'\0')[0].decode('utf-8', errors='replace')

def stable_read(path):
    before = path.stat()
    data = path.read_bytes()
    after = path.stat()
    if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
        raise ValueError('Sauvegarde en cours : nouvelle tentative au prochain rafraîchissement')
    return data

def slots():
    if ROOT is None: raise ValueError(SETUP_HELP)
    return sorted([{'id': p.parent.name, 'modified': p.stat().st_mtime}
        for p in ROOT.glob('slot_*/progress.sav')], key=lambda x:x['modified'], reverse=True)

def read_collectibles(save):
    # Persistent actor IDs: observed sorted UInt64 set at the final variable block.
    # Matched against all 100 actor IDs and the token count on six local saves.
    offset = save.block(0xA3DB7114, 0)
    tail = save.data[offset:]
    if len(tail) % 8: raise ValueError('Liste des collectibles de taille invalide')
    ids = [v[0] for v in struct.iter_unpack('<Q', tail)]
    while ids and ids[-1] == 0: ids.pop()
    if ids != sorted(set(ids)): raise ValueError('Liste des collectibles non reconnue')
    collected = set(ids)
    result=[]
    for item in COLLECTIBLES:
        if item['flag'] is not None:
            value = save.integer(item['flag']) if item['flag'] in save.fields else None
            owned = bool(value) if value in (0,1) else None
        else:
            owned = int(item['id'],16) in collected
        # Chest/event semantics for hearts are not fully verified. Do not
        # misrepresent absence from the actor set as proof of a missing reward.
        if item['kind'] == 'heart':
            if item['flagName'] and 'DampeRace' in item['flagName']:
                owned = None
            elif item['flag'] is None and not owned:
                owned = None
        result.append({'id':item['id'],'owned':owned})
    actual=sum(x['owned'] is True for x,i in zip(result,COLLECTIBLES) if i['kind']=='skull')
    matched=actual==save.integer(0x04735978)
    if not matched:
        for row,item in zip(result,COLLECTIBLES):
            if item['kind']=='skull': row['owned']=None
    return {'items':result,'skullVerified':matched,'skullDetected':actual,
            'heartDetected':sum(x['owned'] is True for x,i in zip(result,COLLECTIBLES) if i['kind']=='heart')}

UNKNOWN_COLLECTIBLES = {'items':[{'id':item['id'],'owned':None} for item in COLLECTIBLES],
                        'skullVerified':False,'skullDetected':0,'heartDetected':0}

def optional(reader, save, fallback):
    # One unrecognised section must not blank the whole dashboard: show it as unknown.
    try:
        return reader(save)
    except (OSError, ValueError, KeyError, struct.error):
        return fallback

def player_position(save):
    # Traiver/OOT-SW2SE: PlayerStatus.SavePos, Vector3 block, world X/Y/Z.
    try:
        position = struct.unpack_from('<fff', save.data, save.block(0xC884818D, 12))
        if not all(math.isfinite(v) and abs(v) <= 1_000_000 for v in position):
            return None
        return {'position': list(position), 'area': save.string(0x1D6189DA), 'source': 'save'}
    except (KeyError, ValueError, struct.error):
        return None

def snapshot(slot):
    available = slots()
    if not available: raise ValueError(f'Aucune sauvegarde du jeu dans {ROOT}. Sauvegardez une première fois, ou corrigez save_root dans config.json.')
    if slot == 'latest': slot = available[0]['id'] if available else ''
    if slot not in {s['id'] for s in available}: raise ValueError('Emplacement introuvable')
    directory = ROOT / slot
    p = Save(stable_read(directory / 'progress.sav'), 0x175D8)
    inventory = [{'id':name,'label':title or name,'category':category,'count':p.integer(h)}
        for h,name,category,_,title in CATALOG['inventory'] if h in p.fields]
    flags = [{'id':row[2],'active':bool(p.integer(row[0]))}
        for row in CATALOG['fields'] if len(row)>2 and row[1]==0 and row[0] in p.fields
        and (row[2].startswith('IsGet.Item_Melody') or 'DefeatBoss' in row[2])]
    thumbnail = None
    try:
        # The caption file only carries the preview picture: never fail the whole page for it.
        c = Save(stable_read(directory / 'caption.sav'), 0x2A0)
        offset = c.block(0x63696A32,4)
        size = c.uint(offset)
        c.block(0x63696A32,4+size)
        raw = c.data[offset+4:offset+4+size]
        if raw[:2] == b'\xff\xd8': thumbnail = 'data:image/jpeg;base64,'+base64.b64encode(raw).decode()
    except (OSError, ValueError, KeyError, struct.error): pass
    return {'slot':slot,'slots':available,'modified':next(s['modified'] for s in available if s['id']==slot),
        'player':locate_player(player_position(p)),'area':p.string(0x1D6189DA),'quest':p.string(0x874C7ED4),
        'quests':quest_states(lambda key: p.integer(key) if key in p.fields else None,
                             p.integer(EPONA_SONG) == 1 if EPONA_SONG in p.fields else False),
        'hearts':p.integer(0x31AB5580)/4,'maxHearts':p.integer(0xFBE01DA1)/4,
        'rupees':p.integer(0xA77921D7),'wallet':p.integer(0xE0010A50),
        'skulltulas':p.integer(0x04735978),'inventory':inventory,'flags':flags,'thumbnail':thumbnail,
        'collectibles':optional(read_collectibles, p, UNKNOWN_COLLECTIBLES),
        'activity':optional(activity_stats, p, {'emulatorSeconds':None,'records':[],
            'distanceWalkingKm':None,'distanceHorseKm':None,'distanceSwimmingKm':None})}

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        allowed = (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')
        if self.headers.get('Host') not in allowed or self.headers.get('Origin') not in tuple('http://' + h for h in allowed):
            self.send_error(403); return
        if self.path not in ('/api/overlay/open', '/api/update/install'):
            self.send_error(404); return
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            self.send_error(415); return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 <= size <= 128:
                self.send_error(413); return
            self.rfile.read(size)
            if self.path == '/api/update/install':
                # Stops this process once the new files are staged; a script then copies them and restarts Navi.
                UPDATES.install(lambda: os._exit(0))
                data = json.dumps({'installing': True}).encode()
            else:
                executable = BASE / 'overlay-app' / 'NaviOverlay.exe'
                if not executable.is_file():
                    raise ValueError('Le programme de mini-carte est introuvable.')
                subprocess.Popen([str(executable)], cwd=BASE, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                data = json.dumps({'opened': True}).encode()
            self.send_response(200)
        except (OSError, ValueError) as exc:
            data = json.dumps({'error': str(exc)}).encode()
            self.send_response(503)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        # Reject foreign origins/hosts; no API writes and no arbitrary filesystem routes.
        if self.headers.get('Host') not in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'):
            self.send_error(403); return
        url = urlparse(self.path)
        try:
            if url.path == '/api/live':
                live = LIVE.snapshot()
                data = json.dumps({**live, 'player': locate_player(live.get('player'))}).encode()
                mime = 'application/json'
            elif url.path == '/api/update':
                data = json.dumps(UPDATES.snapshot()).encode()
                mime = 'application/json'
            elif url.path == '/api/state':
                data = json.dumps(snapshot(parse_qs(url.query).get('slot',['latest'])[0])).encode()
                mime = 'application/json'
            elif url.path in ('/','/app.js','/i18n.js','/style.css','/collectibles.json','/plans.json'):
                name = {'/':'index.html'}.get(url.path,url.path.lstrip('/'))
                data = (BASE/name).read_bytes()
                mime = {'/':'text/html','/app.js':'text/javascript','/i18n.js':'text/javascript','/style.css':'text/css'}.get(url.path,'application/json')
            elif url.path.startswith('/maps/') and url.path.endswith('.webp') and STATIC_IMAGE.fullmatch(url.path[6:]):
                data=(BASE/'maps'/url.path[6:]).read_bytes();mime='image/webp'
            elif url.path.startswith('/assets/') and STATIC_IMAGE.fullmatch(url.path[8:]):
                data=(BASE/'assets'/url.path[8:]).read_bytes()
                mime='image/png' if url.path.endswith('.png') else 'image/webp'
            elif url.path in ('/fonts/cormorant-garamond-latin.woff2','/fonts/dm-sans-latin.woff2'):
                data=(BASE/'fonts'/url.path[7:]).read_bytes();mime='font/woff2'
            else: self.send_error(404); return
            self.send_response(200)
        except FileNotFoundError:
            self.send_error(404); return
        except KeyError:
            data = json.dumps({'error':'Champ absent de la sauvegarde : version du jeu non prise en charge ?'}).encode(); mime='application/json'; self.send_response(503)
        except (OSError, ValueError, struct.error) as exc:
            data = json.dumps({'error':str(exc)}).encode(); mime='application/json'; self.send_response(503)
        self.send_header('Content-Type',mime+'; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Length',str(len(data)))
        try:
            self.end_headers(); self.wfile.write(data)
        except ConnectionError:
            pass  # The page was closed or refreshed while the answer was being sent.
    def log_message(self,*args): pass

if __name__ == '__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=8766); parser.add_argument('--open',action='store_true'); parser.add_argument('--no-open',action='store_true')
    args=parser.parse_args()
    # The packaged Navi.exe opens the browser on a plain double-click; the mini-map starts it with --no-open.
    args.open = args.open or (FROZEN and not args.no_open)
    try:
        server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    except OSError:
        # Most likely Navi is already running (for instance started by the mini-map).
        print(f'Port {args.port} is already in use: Navi is probably running already.',flush=True)
        if args.open: webbrowser.open(f'http://127.0.0.1:{args.port}')
        sys.exit(1)
    print(f'Navi : http://127.0.0.1:{args.port}',flush=True)
    print(f'Saves: {ROOT}' if ROOT else 'Fritchii saves not found. Put the Navi folder inside the Fritchii folder (or next to it), or copy config.example.json to config.json and set save_root.',flush=True)
    # Game images are not shipped with Navi; fetch missing ones without delaying the server.
    threading.Thread(target=download_images.main,daemon=True).start()
    UPDATES.start()
    if args.open: webbrowser.open(f'http://127.0.0.1:{args.port}')
    server.serve_forever()

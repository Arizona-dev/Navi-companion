"""Bounded, read-only Windows memory reader for Fritchii + OoT 1.1.1.

No debugger, injection, game functions or memory writes. Offsets describe data
layouts independently documented by PracticeROM/sloperina and checked locally.
Only the configured emulator installation and a verified game build are read.
"""
import ctypes as c
from ctypes import wintypes as w
import math
import json
import os
from pathlib import Path
import re
import struct
import threading
import time
from quests import EPONA_SONG, quest_states
from paths import DATA

BUILD = 'E0F3CCFAF50065AE4EA01EB5AEB13B1A45DA3348'
MAIN_SIZE = 0x4EA0000
# Only explicit reward flags are authoritative here. Actor/chest IDs still
# use the save reader, and the Dampe event flag does not prove the prize was taken.
REWARD_FLAGS = tuple((item['id'], item['flag']) for item in
                    json.loads((DATA / 'collectibles.json').read_text('utf-8'))
                    if item['kind'] == 'heart' and item['flag'] is not None
                    and 'DampeRace' not in (item.get('flagName') or ''))


def map_heading(rotation):
    """Actor's forward axis is matrix column Z; map X points right, Z down."""
    if len(rotation) != 9 or not all(math.isfinite(v) for v in rotation):
        return None
    x, z = rotation[2], rotation[8]
    if math.hypot(x, z) < .0001:
        return None
    return math.degrees(math.atan2(x, -z)) % 360


class MemoryUnavailable(Exception):
    pass


class ZoneTransition(MemoryUnavailable):
    """The game is between two areas: wait, the connection itself is still valid."""


class Memory:
    def __init__(self, installation):
        self.k = c.WinDLL('kernel32', use_last_error=True)
        for name, args, result in [
            ('OpenProcess', [w.DWORD, w.BOOL, w.DWORD], w.HANDLE),
            ('CloseHandle', [w.HANDLE], w.BOOL),
            ('QueryFullProcessImageNameW', [w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)], w.BOOL),
            ('ReadProcessMemory', [w.HANDLE, c.c_void_p, c.c_void_p, c.c_size_t, c.POINTER(c.c_size_t)], w.BOOL),
            ('VirtualQueryEx', [w.HANDLE, c.c_void_p, c.c_void_p, c.c_size_t], c.c_size_t),
            ('GetExitCodeProcess', [w.HANDLE, c.POINTER(w.DWORD)], w.BOOL),
        ]:
            fn = getattr(self.k, name)
            fn.argtypes, fn.restype = args, result
        psapi = c.WinDLL('psapi')
        psapi.EnumProcesses.argtypes = [c.c_void_p, w.DWORD, c.POINTER(w.DWORD)]
        psapi.EnumProcesses.restype = w.BOOL
        pids, length = (w.DWORD * 8192)(), w.DWORD()
        self.handle = None
        if not psapi.EnumProcesses(pids, c.sizeof(pids), c.byref(length)):
            raise MemoryUnavailable('Émulateur inaccessible')
        names = ('lichii.exe', 'fritchii.exe', 'eden.exe')
        allowed = {os.path.normcase(str(installation / name)) for name in names}
        # Installed (non-portable) emulator: its program is not next to the user folder,
        # so the process is recognised by its file name instead of its full path.
        portable = any((installation / name).is_file() for name in names)
        for pid in pids[:length.value // 4]:
            handle = self.k.OpenProcess(0x410, False, pid)  # QUERY_INFORMATION | VM_READ
            if not handle:
                continue
            buf, size = c.create_unicode_buffer(32768), w.DWORD(32768)
            if self.k.QueryFullProcessImageNameW(handle, 0, buf, c.byref(size)) and (
                    os.path.normcase(buf.value) in allowed if portable
                    else os.path.basename(buf.value).lower() in names):
                self.handle = handle
                break
            self.k.CloseHandle(handle)
        if not self.handle:
            raise MemoryUnavailable('Émulateur fermé')

    def close(self):
        if self.handle:
            self.k.CloseHandle(self.handle)
            self.handle = None

    def alive(self):
        code = w.DWORD()
        return bool(self.handle and self.k.GetExitCodeProcess(self.handle, c.byref(code)) and code.value == 259)

    def read(self, address, size):
        if not 0 < size <= 1_048_576 or not 0 < address < 0x7FFFFFFFFFFF:
            raise MemoryUnavailable('Adresse hors limites')
        buffer, count = c.create_string_buffer(size), c.c_size_t()
        if not self.k.ReadProcessMemory(self.handle, address, buffer, size, c.byref(count)) or count.value != size:
            raise MemoryUnavailable('Lecture indisponible')
        return buffer.raw

    def regions(self):
        class Region(c.Structure):
            _fields_ = [('base', c.c_void_p), ('allocation', c.c_void_p), ('allocation_protection', w.DWORD),
                        ('size', c.c_size_t), ('state', w.DWORD), ('protection', w.DWORD), ('kind', w.DWORD)]
        address = 0
        for _ in range(200_000):
            region = Region()
            if not self.k.VirtualQueryEx(self.handle, address, c.byref(region), c.sizeof(region)):
                break
            base = region.base or 0
            if region.state == 0x1000 and region.kind == 0x40000 and not region.protection & 0x101:
                yield base, region.size
            following = base + region.size
            if following <= address or following >= 0x7FFFFFFFFFFF:
                break
            address = following


class GameReader:
    def __init__(self, memory, main, base):
        self.memory, self.main, self.base = memory, main, base
        self.actor = None
        self.next_actor_search = 0
        self.table_cache = {}

    def read(self, address, size):
        if address < 0x10000 or address + size >= 0x8000000000:
            raise MemoryUnavailable('Pointeur du jeu invalide')
        return self.memory.read(self.base + address, size)

    def ptr(self, address):
        return struct.unpack('<Q', self.read(address, 8))[0]

    def manager(self):
        return self.ptr(self.ptr(self.main + 0x4C7E180))

    def field(self, type_address, key, stride):
        raw = self.read(type_address, 0x28)
        _, count, _, objects, table, _, size = struct.unpack('<QIIQQII', raw)
        if not 0 < count <= 50_000 or not count <= size <= 100_000:
            raise MemoryUnavailable('Table GameData invalide')
        identity = (type_address, objects, table, count, size)
        if identity not in self.table_cache:
            mapping = {h: idx for h, idx in struct.iter_unpack('<II', self.read(table, size * 8)) if h and idx < count}
            if len(self.table_cache) > 8:
                self.table_cache.clear()
            self.table_cache[identity] = mapping
        index = self.table_cache[identity].get(key)
        return None if index is None else objects + index * stride

    def area(self, manager):
        field = self.field(manager + 0x608, 0x1D6189DA, 0x108)
        if field is None:
            raise MemoryUnavailable('Zone indisponible')
        value = self.read(self.ptr(field + 0x68), 64).split(b'\0')[0].decode('ascii')
        if not re.fullmatch(r'[A-Za-z0-9_]{2,63}', value):
            raise ZoneTransition('Zone en chargement')
        return value

    def position(self, actor):
        data = self.read(actor, 0x328)
        if struct.unpack_from('<Q', data)[0] != self.main + 0x4B25E18:
            raise MemoryUnavailable('Acteur remplacé')
        if struct.unpack_from('<I', data, 0x2C)[0] not in (4, 5):
            raise MemoryUnavailable('Acteur inactif')
        if self.read(struct.unpack_from('<Q', data, 0x20)[0], 7) != b'Player\0':
            raise MemoryUnavailable('Acteur différent')
        movement = self.ptr(struct.unpack_from('<Q', data, 0x270)[0] + 0x320)
        if self.ptr(movement + 0x18) != actor:
            raise MemoryUnavailable('Composant joueur invalide')
        pos = struct.unpack_from('<fff', data, 0x31C)
        if not all(math.isfinite(v) and abs(v) <= 1_000_000 for v in pos):
            raise MemoryUnavailable('Position invalide')
        return list(pos)

    def find_player(self):
        stack = [self.ptr(self.ptr(self.main + 0x4E90D90) + 0x38)]
        nodes, entries = set(), set()
        deadline = time.monotonic() + .15
        while stack and len(nodes) < 8192 and len(entries) < 8192 and time.monotonic() < deadline:
            node = stack.pop()
            if not node or node in nodes:
                continue
            nodes.add(node)
            try:
                stack.extend(struct.unpack('<QQ', self.read(node, 16)))
                entry = node - 8
                while entry and entry not in entries and len(entries) < 8192 and time.monotonic() < deadline:
                    entries.add(entry)
                    data = self.read(entry, 64)
                    actor, entry = struct.unpack_from('<Q', data, 0x28)[0], struct.unpack_from('<Q', data, 0x38)[0]
                    try:
                        if actor and self.ptr(actor) == self.main + 0x4B25E18:
                            self.position(actor)
                            return actor
                    except MemoryUnavailable:
                        pass
            except MemoryUnavailable:
                continue
        return None

    def heading(self, actor):
        try:
            return map_heading(struct.unpack('<9f', self.read(actor + 0x328, 36)))
        except MemoryUnavailable:
            return None

    def reward_state(self, manager, bool_type):
        items = []
        if bool_type:
            for item_id, key in REWARD_FLAGS:
                try:
                    field = self.field(bool_type, key, 0x18)
                    value = self.read(field + 0x16, 2) if field else b''
                    # Both in-memory copies must agree before replacing save data.
                    if value in (b'\0\0', b'\1\1'):
                        items.append({'id': item_id, 'owned': value[0] == 1})
                except MemoryUnavailable:
                    continue
        tokens = None
        try:
            field = self.field(manager + 0xC8, 0x04735978, 0x28)
            if field and self.ptr(field) == self.main + 0x4C20718:
                a, b = struct.unpack('<ii', self.read(field + 0x1C, 8))
                if a == b and 0 <= a <= 100:
                    tokens = a
        except (MemoryUnavailable, struct.error):
            pass
        return {'items': items, 'source': 'live'}, tokens

    def snapshot(self):
        manager = self.manager()
        area = self.area(manager)
        enum_type, bool_type = None, None
        data = self.read(manager, 0x800)
        for offset in range(0, len(data) - 40, 8):
            vt = struct.unpack_from('<Q', data, offset)[0]
            if vt == self.main + 0x4C1F500:
                enum_type = manager + offset
            elif vt == self.main + 0x4C1F140:
                bool_type = manager + offset
        def enum_value(key):
            field = self.field(enum_type, key, 0x38) if enum_type else None
            return struct.unpack('<I', self.read(field + 0x1C, 4))[0] if field else None
        song_field = self.field(bool_type, EPONA_SONG, 0x18) if bool_type else None
        learned = song_field and self.read(song_field + 0x16, 1) == b'\1'
        quests = quest_states(enum_value, learned)
        collectibles, skulltulas = self.reward_state(manager, bool_type)
        pos = None
        if self.actor:
            try:
                pos = self.position(self.actor)
            except MemoryUnavailable:
                self.actor = None
        if not self.actor and time.monotonic() >= self.next_actor_search:
            self.next_actor_search = time.monotonic() + 1
            self.actor = self.find_player()
            if self.actor:
                pos = self.position(self.actor)
        heading = self.heading(self.actor) if pos is not None and self.actor else None
        if self.manager() != manager or self.area(manager) != area:
            self.actor = None
            raise ZoneTransition('Changement de zone')
        return {'connected': True, 'area': area, 'quests': quests,
                'collectibles': collectibles, 'skulltulas': skulltulas,
                'player': {'position': pos, 'area': area, 'source': 'live', 'heading': heading} if pos else None}


class LiveTracker:
    def __init__(self, save_root):
        self.user_root = next((p for p in (save_root.parents if save_root else ()) if (p / 'config' / 'qt-config.ini').exists()), None)
        self.memory = self.reader = None
        self.lock = threading.Lock()
        self.next_connect = self.sampled = self.transitions = 0
        self.cached = {'connected': False, 'player': None, 'quests': {}}

    def connect(self):
        if os.name != 'nt' or self.user_root is None:
            raise MemoryUnavailable('Direct indisponible sur cette installation')
        logs = sorted((self.user_root / 'log').glob('*log*.txt'), key=lambda p: p.stat().st_mtime, reverse=True)
        if not logs:
            raise MemoryUnavailable('Journal du jeu indisponible')
        # The build and module lines are written when the game boots: near the start of
        # the log, or near its end after a game restart in a long emulator session.
        with logs[0].open('rb') as file:
            raw = file.read(2_000_000)
            size = file.seek(0, 2)
            if size > 2_000_000:
                file.seek(max(2_000_000, size - 8_000_000))
                raw += b'\n' + file.read()
        log = raw.decode('utf-8', errors='replace')
        builds = re.findall(r'build_id=([0-9A-F]+), name=main', log)
        modules = re.findall(r'Module main loaded at (0x[0-9a-fA-F]+)', log)
        if not builds or builds[-1] != BUILD or not modules:
            raise MemoryUnavailable('Version du jeu non prise en charge pour le direct')
        main = int(modules[-1], 16)
        memory = Memory(self.user_root.parent)
        try:
            for start, size in memory.regions():
                if start <= main or not 0x100000 <= size <= MAIN_SIZE:
                    continue
                reader = GameReader(memory, main, start - main)
                try:
                    functions = struct.unpack('<QQQ', reader.read(main + 0x4B25E18, 24))
                    if not all(main <= value < main + MAIN_SIZE for value in functions):
                        continue
                    reader.area(reader.manager())
                    self.memory, self.reader = memory, reader
                    return
                except (MemoryUnavailable, UnicodeError):
                    continue
            raise MemoryUnavailable('Jeu en cours de démarrage')
        except Exception:
            memory.close()
            raise

    def snapshot(self):
        with self.lock:
            now = time.monotonic()
            if now - self.sampled < .18:
                return self.cached
            self.sampled = now
            try:
                if self.memory and not self.memory.alive():
                    self.memory.close()
                    self.memory = self.reader = None
                    self.cached = {'connected': False, 'player': None, 'quests': {}, 'reason': 'Émulateur fermé'}
                if not self.reader:
                    if now < self.next_connect:
                        return self.cached
                    self.next_connect = now + 5
                    self.connect()
                self.cached = self.reader.snapshot()
                self.transitions = 0
            except ZoneTransition as exc:
                # Walking through a door must not drop the connection and force a 5 s rescan.
                self.cached = {'connected': False, 'player': None, 'quests': {}, 'reason': str(exc)}
                self.transitions += 1
                if self.transitions > 40 and self.memory:
                    self.memory.close()
                    self.memory = self.reader = None
                    self.transitions = 0
            except (MemoryUnavailable, OSError, ValueError, struct.error) as exc:
                self.cached = {'connected': False, 'player': None, 'quests': {}, 'reason': str(exc)}
                # A game restart can remap its guest address space without changing PID.
                if self.reader and now >= self.next_connect:
                    self.memory.close()
                    self.memory = self.reader = None
                    self.next_connect = now + 5
            return self.cached

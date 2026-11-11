"""Where Navi's files live: the app folder when packaged, the repository root otherwise.

BASE holds what belongs to the user (config.json, downloaded assets/ and maps/) and VERSION;
WEB is the interface served to the window, DATA the game reference tables.
"""
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, 'frozen', False))
if FROZEN:
    # Packaged layout: <app>/server/navi-server.exe.
    _exe = Path(sys.executable).resolve()
    BASE = _exe.parent.parent if _exe.parent.name.lower() == 'server' else _exe.parent
else:
    # Sources: <repository>/src/paths.py.
    BASE = Path(__file__).resolve().parent.parent
WEB = BASE / 'web'
DATA = BASE / 'data'

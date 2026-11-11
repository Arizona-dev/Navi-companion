"""Where Navi's files live: the app folder when packaged, next to the sources otherwise."""
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, 'frozen', False))
if FROZEN:
    # Packaged layout: <app>/server/navi-server.exe, with the web files and data in <app>.
    _exe = Path(sys.executable).resolve()
    BASE = _exe.parent.parent if _exe.parent.name.lower() == 'server' else _exe.parent
else:
    BASE = Path(__file__).resolve().parent

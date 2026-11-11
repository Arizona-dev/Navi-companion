"""Where Navi's files live: next to Navi.exe in the packaged app, next to the sources otherwise."""
import sys
from pathlib import Path

FROZEN = bool(getattr(sys, 'frozen', False))
BASE = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent

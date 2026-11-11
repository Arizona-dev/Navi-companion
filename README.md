# Navi — a companion for Ocarina of Time on Fritchii

Navi is an unofficial, local companion to keep open next to the game. It reads your Fritchii saves (read-only) and shows:

- the map of Hyrule and the dungeon floor plans, with Link's position;
- the 100 Gold Skulltulas and the 36 Pieces of Heart, collected or remaining;
- quest progress, inventory, songs and a few statistics;
- a floating mini-map that stays on top of the game.

The interface is available in **English and French** (switch at the top right).

![Map with Link's position](docs/map.jpg)

| Quests | Statistics |
| --- | --- |
| ![Quests](docs/quests.jpg) | ![Statistics](docs/statistics.jpg) |

Everything runs on your PC: the server only listens on `127.0.0.1` and none of your data is sent anywhere. Navi only reaches the Internet to download the game images on first launch and to ask GitHub whether a newer version exists.

## Installation

Nothing to install first: Python and .NET are included.

1. Download `Navi-companion.zip` from the [Releases](../../releases/latest) page and unzip it.
2. Put the `Navi-companion` folder **inside the Fritchii folder** (where `fritchii.exe` is) or right next to it.
3. Double-click `Navi.exe`.

On first launch, Navi downloads about 210 images (icons and maps, 17 MB), then opens `http://127.0.0.1:8766` in your browser. Save once in the game for your data to appear. Closing the Navi window stops it.

Windows may show "Windows protected your PC" because the files are not signed: click **More info**, then **Run anyway**.

Requirements: Windows 10 or 11, 64-bit. The mini-map also uses Microsoft Edge WebView2, which Windows 11 and up-to-date Windows 10 already include.

### Updates

At launch, Navi asks GitHub whether a newer release exists and shows a banner if so. **Update** downloads the release, replaces the program files and restarts Navi; your `config.json`, downloaded images and notes are kept. **Later** hides the banner until the next release.

To turn the check off, add `"check_updates": false` to `config.json`.

### If Navi cannot find your saves

Copy `config.example.json` to `config.json` and set the game's save folder in it, for example:

```json
{
  "save_root": "D:\\Games\\Fritchii\\user\\nand\\user\\save\\0000000000000000\\YOUR_PROFILE\\0400486024DEC000"
}
```

## Mini-map on top of the game

Run `Start-Navi-Overlay.cmd`, or click **Over the game** from the map. The mini-map starts Navi by itself if needed.

- Play in windowed or borderless fullscreen mode, otherwise the game covers it.
- Move it with the golden handle on the top edge; resize it from the edges and corners.
- `Ctrl+Alt+N` locks or unlocks clicks (when locked, clicks go through to the game).
- `Ctrl+Alt+M` hides or shows it. The Navi icon near the clock offers the same actions and the language switch.

## Live tracking

When **Last save** is selected and the game is running, Navi reads Link's position and the state of some quests straight from the emulator's memory — read-only, with no injection and no change to the game. An antivirus may flag this.

Live tracking targets 64-bit Windows and game version **1.1.1**. With another version, Navi falls back to the last saved position.

## Limits

- No editing features: Navi never modifies the game or the saves.
- Pieces of Heart are only partly synchronised; those marked "To verify" are not necessarily missing.
- Notes are stored in your browser: use the export to keep them.

More details in [docs/DETAILS.md](docs/DETAILS.md).

## From source

With Python 3.9+ installed, `Start-Navi.cmd` runs Navi straight from the sources.

To build the release archive (Python with PyInstaller, .NET SDK 8 or newer, git):

```
powershell -ExecutionPolicy Bypass -File build.ps1
```

This produces `dist/Navi-companion.zip` with `Navi.exe` (embedded Python) and a self-contained mini-map. The version number is in the `VERSION` file.

Tests:

```
python -m unittest discover -p "test_*.py"
node test_collectibles.cjs
```

French is the source language of the interface; English texts live in [i18n.js](i18n.js).

## Credits and licences

- Navi source code: MIT licence, see [LICENSE](LICENSE).
- Save format and catalogue adapted from [Traiver/OOT-SW2SE](https://github.com/Traiver/OOT-SW2SE) (MIT, see [LICENSE-Traiver.txt](LICENSE-Traiver.txt)).
- Memory layouts documented by [PracticeROM/sloperina](https://github.com/PracticeROM/sloperina) and [Kabosune/oot-remake-modding](https://github.com/Kabosune/oot-remake-modding).
- Maps and positions: [Owl Object Map](https://objmap-oot.zeldamods.org/). Icons: [Zelda Central](https://zeldacentral.com/). The full list is in [ASSETS-SOURCES.txt](ASSETS-SOURCES.txt) and [images-sources.json](images-sources.json).
- Cormorant Garamond and DM Sans fonts: SIL Open Font License 1.1.

The Legend of Zelda, Ocarina of Time and their artwork belong to Nintendo. This project is not affiliated with or endorsed by Nintendo, and contains neither the game nor its files.

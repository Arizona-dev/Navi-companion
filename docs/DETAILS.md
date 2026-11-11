# Navi — details

## Running

- Start: double-click `Navi.exe` (packaged app, its own window) or `Start-Navi.cmd` (from sources, Python 3 required, opens the browser). Address: `http://127.0.0.1:8766`.
- The server stops when the last Navi window (application or mini-map) is closed. Started from sources, it stops with its command window.
- The save folder is detected automatically when Navi sits inside the Fritchii folder or next to it. Otherwise copy `config.example.json` to `config.json` and set `save_root`.
- The server only listens on `127.0.0.1`. None of your data is sent anywhere; the only outgoing requests are the image downloads and the update check on GitHub.
- Saves are opened read-only. There is no editing feature.

## What is tracked

- Saves on disk are re-read every 5 seconds: slot selection, save preview, area, hearts, Rupees, Skulltulas, a 104-entry inventory catalogue, search and filters, eight identified songs, per-slot notes, JSON export.
- Inventory and collectibles are updated when the game saves.
- Upgrades replace their lower versions in the tracker.
- The 36 Pieces of Heart each have a built-in sheet: place name, exact location, route and requirements, with a link to the guide consulted. Search also matches places and route hints.
- The child/adult filter follows the era of the documented route; it does not guarantee that every shortcut possible in the other era is listed.
- Slots may include automatic saves of the same playthrough. Notes follow a physical slot: a rotating autosave can change slot, so pick a specific slot for a stable notebook.
- Notes stay in the browser profile; use the export to keep them elsewhere. The export is not a game save.

## Limits

- No Nintendo services.
- Only eight songs have a known field in the catalogue used; the others are not inferred.
- The item counter measures the item types present, not 100 % completion.
- Skulltulas: individual identifiers are checked against the save counter; on a mismatch the state is shown as unknown.
- Hearts: partial synchronisation. Missing identifiers and ambiguous events stay "To verify"; that status does not mean missing. Covering the 36 references does not guarantee they were all validated in play.

## Atlas and map

- 100 Skulltulas and 36 Piece of Heart references. Maps and positions come from <https://objmap-oot.zeldamods.org/>. Game images © Nintendo.
- Navigation: filters on the left, region and era/floor above the map, zoom with +/− or the wheel (around the cursor), drag or arrow keys to pan. Zoom is remembered in the browser.
- "Follow Link" centres the map live; a manual zoom or pan pauses it and "My position" resumes it.
- The full Hyrule map shows the region; the exact position is placed on the outdoor maps and dungeon floor plans. With "Follow Link", the floor changes automatically with Link's live altitude, without resetting the zoom.
- 35 distinct floors are covered by the height bands published in <https://objmap-oot.zeldamods.org/game_files/maps.json>. The X/Z bounds from the same source replace earlier visual calibrations.
- Variants of one floor (water level, transformed rooms) stay selectable by hand; their state is not inferred from height. The Gerudo Training Ground and the inside of Ganon's Castle have no map image in that source: the position is shown on a general view explicitly flagged as having no plan.
- Outside a known height band, no approximate floor is chosen.
- The arrow uses the Player actor's rotation with the map's X/Z axes. When the heading is unavailable (saved position), a dot replaces the arrow so that no arbitrary direction is shown.

## Live tracking

- 64-bit Windows, a configured Fritchii install, OoT 1.1.1 (build `E0F3CCFAF50065AE4EA01EB5AEB13B1A45DA3348`).
- Link and the steps of the Epona, Biggoron, Fire Arrow and Gerudo Training Ground quests are read live (5 times per second) when "Last save" is selected. Specific slots remain saved snapshots.
- The process and addresses are detected at each connection. When the game stops, loads or is an unrecognised version, Navi explicitly falls back to the last saved position.
- Memory is only read (`VM_READ`): no injection, no debugger, no change to the game or the saves.
- Quest fields and memory layouts are documented in <https://github.com/PracticeROM/sloperina> and <https://github.com/Kabosune/oot-remake-modding>; the Python reader is independent.
- Floor changes and heading have tests with simulated data; validation by walking the floors in a real game is still to be done.

## Mini-map

- From the map, click "Mini-map", or run `Start-Navi-Overlay.cmd` (`Navi.exe --overlay`).
- The window stays above other windows and keeps Link's position, heading and automatic floor tracking.
- Move it with the thin golden handle on the top edge (no title bar). Resize from the corners and edges; Alt+F4 closes it.
- The arrow button near +/− turns Follow Link on or off; it is golden when active.
- `Ctrl+Alt+N` locks/unlocks clicks. When locked, clicks go to the game without taking focus. `Ctrl+Alt+M` hides/shows. The notification icon can also lock, unlock, show, switch language and close.
- Use Fritchii in windowed or borderless fullscreen mode.
- The application window and the mini-map share one local profile (language, notes), separate from your web browser. Size and position are saved on close.
- Requires Windows x64 and Microsoft Edge WebView2. It is a mode of `Navi.exe`; sources in `app-src`.
- The mini-map only shows markers confirmed as missing. The House of Skulltula reward stays hidden before 50 tokens. The 16 Pieces of Heart tied to an identified reward signal are read live; the others and the Skulltulas use the save. An incomplete live read never replaces save data, and historical slots never use the rewards of the game in progress.

## Fairy fountains

- 18 plans cover the six Great Fairies and four small fairy fountains, with the child/adult variants available. Interiors are projected from the real geometry published by Owl Object Map (`static_compound`), not from an official in-game map image.
- Automatic selection uses the floor outline and Link's altitude, then returns to the outdoor map when leaving the room.
- Source: <https://objmap-oot.zeldamods.org/game_files/static_compound/>. Validation uses the published positions; actually walking into each of the ten rooms is still to be checked in play.

## Tests

```
python -m unittest discover -s tests -t .
node tests/test_collectibles.cjs
```

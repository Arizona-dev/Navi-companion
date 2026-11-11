"""Match world coordinates to the published game-map floor height bands.

Data: https://objmap-oot.zeldamods.org/game_files/maps.json
No guessed floor heights, nearest-floor extrapolation, or save writes.
"""
import json
import math
from pathlib import Path
from paths import BASE

PLANS = json.loads((BASE / 'plans.json').read_text('utf-8'))
BY_AREA = {}
for plan in PLANS:
    BY_AREA.setdefault(plan['id'].split('/')[6].removesuffix('_Alternative'), []).append(plan)


def inside_polygon(x, z, polygon):
    inside = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
    return inside


def locate_player(player):
    if not player:
        return None
    result = {**player, 'floor': None, 'plan': None}
    position = player.get('position')
    if (not isinstance(position, (list, tuple)) or len(position) != 3
            or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in position)):
        return None
    plans = BY_AREA.get(player.get('area', '').removesuffix('_Alternative'), [])
    x, y, z = position
    for plan in plans:
        interior = plan.get('interior')
        if (interior and interior['heightRange'][0] <= y <= interior['heightRange'][1]
                and any(inside_polygon(x, z, polygon) for polygon in interior['polygons'])):
            result.update(plan=plan['id'], floorSource='interior-geometry', mapAvailable=bool(plan['layers']))
            return result
    plans = [p for p in plans if not p.get('interior')]
    floors = [p for p in plans if p.get('heightRange')]
    if floors:
        altitude = position[1]
        ceiling = max(p['heightRange'][1] for p in floors)
        candidates = [p for p in floors if p['heightRange'][0] <= altitude < p['heightRange'][1]
                      or altitude == ceiling == p['heightRange'][1]]
        # Variants share a floor; overlapping different floors are ambiguous.
        if not candidates or len({p['floor'] for p in candidates}) != 1:
            return result
        chosen = sorted(candidates, key=lambda p: p['id'])[0]
        result.update(floor=chosen['floor'], plan=chosen['id'], floorSource='map-height-range')
    elif plans and not any(p.get('heightRange') for p in plans):
        # An interior must not prevent the exterior from resolving on exit.
        chosen = sorted(plans, key=lambda p: p['id'])[0]
        result.update(plan=chosen['id'], floorSource='single-plan')
    else:
        return result
    result['mapAvailable'] = bool(chosen['layers'])
    return result

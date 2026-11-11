import math
import unittest
from pathlib import Path
from map_position import BY_AREA, PLANS, locate_player
import json

# Game images are downloaded at first launch (images-sources.json), so a fresh
# copy only has to know where each plan image comes from.
DOWNLOADABLE = {e['file'] for e in json.loads(Path(__file__).with_name('images-sources.json').read_text('utf-8'))}

def available(name):
    return 'maps/' + name in DOWNLOADABLE or (Path(__file__).parent / 'maps' / name).is_file()


def at(area, y, source='live'):
    return locate_player({'area': area, 'position': [10, y, -20], 'source': source})


class DungeonPositionTests(unittest.TestCase):
    def test_every_dungeon_floor_has_image_and_resolves_from_height(self):
        checked = set()
        for area, plans in BY_AREA.items():
            for p in plans:
                if not p.get('heightRange'):
                    continue
                with self.subTest(area=area, floor=p['floor']):
                    low, high = p['heightRange']
                    self.assertEqual(at(area, (low + high) / 2)['floor'], p['floor'])
                    self.assertTrue(p['layers'])
                    for image in p['layers']:
                        self.assertTrue(available(image['file']))
                    checked.add((area, p['floor']))
        self.assertEqual(len(checked), 35)

    def test_fire_temple_stairs_and_elevator_keep_same_area(self):
        for height, floor in [(110, '1F'), (130, '2F'), (150, '3F'), (180, '4F'), (200, '5F'), (110, '1F')]:
            with self.subTest(height=height):
                player = at('FireTemple', height)
                self.assertEqual(player['floor'], floor)
                self.assertEqual(player['position'], [10, height, -20])
                self.assertEqual(player['source'], 'live')
        self.assertEqual(at('FireTemple', 126.9539)['floor'], '1F')
        self.assertEqual(at('FireTemple', 126.954)['floor'], '2F')
        self.assertEqual(at('FireTemple', 208)['floor'], '5F')

    def test_water_levels_are_variants_of_the_same_floor(self):
        self.assertEqual(at('WaterTemple', 105)['floor'], '1F')
        self.assertIn('/1F_Lv1_State00', at('WaterTemple', 105)['plan'])

    def test_underground_floor_and_saved_coordinates(self):
        self.assertEqual(at('ForestTemple', 50)['floor'], 'B2')
        player = at('BottomOfTheWell', 100, 'save')
        self.assertEqual(player['floor'], 'B1')
        self.assertEqual(player['source'], 'save')

    def test_unknown_area_invalid_position_or_outside_bands(self):
        self.assertIsNone(locate_player(None))
        self.assertIsNone(at('FireTemple', math.nan))
        self.assertIsNone(at('FireTemple', math.inf))
        self.assertIsNone(at('FireTemple', 500)['plan'])
        self.assertIsNone(at('NoSuchTemple', 100)['plan'])

    def test_single_plan_and_dungeon_without_a_game_map(self):
        self.assertTrue(at('HyruleField_Adult', 140)['mapAvailable'])
        player = at('GerudoTrainingGround', 100)
        self.assertFalse(player['mapAvailable'])
        self.assertIsNone(player['floor'])
        self.assertTrue(player['plan'].endswith('/00'))

    def test_fairy_fountains_use_their_room_and_return_to_the_exterior(self):
        interiors = [p for p in PLANS if p.get('interior')]
        self.assertEqual(len(interiors), 18)
        for plan in interiors:
            area = plan['id'].split('/')[6]
            with self.subTest(area=area):
                pos = plan['interior']['anchor']
                player = locate_player({'area': area, 'position': pos, 'source': 'live'})
                self.assertEqual(player['plan'], plan['id'])
                self.assertEqual(player['floorSource'], 'interior-geometry')
                self.assertTrue(player['mapAvailable'])
                for layer in plan['layers']:
                    self.assertTrue(available(layer['file']))
                # A player above a hidden fountain must stay on the exterior.
                outside = locate_player({'area': area, 'position': [pos[0], pos[1]+30, pos[2]]})
                self.assertIsNotNone(outside['plan'])
                self.assertNotEqual(outside['plan'], plan['id'])
                outside = locate_player({'area': area, 'position': [pos[0]+100, pos[1], pos[2]+100]})
                self.assertNotEqual(outside['plan'], plan['id'])


if __name__ == '__main__':
    unittest.main()

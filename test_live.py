import struct
import unittest
from unittest.mock import patch
from live import GameReader, LiveTracker, MemoryUnavailable, map_heading
from pathlib import Path
from unittest.mock import Mock
import time
from quests import COMPLETE, QUEST_FIELDS, murmur3, quest_states


class FakeMemory:
    def __init__(self):
        self.blocks = {}
        self.reads = 0
    def read(self, address, size):
        self.reads += 1
        for base, data in self.blocks.items():
            if base <= address and address + size <= base + len(data):
                return bytes(data[address - base:address - base + size])
        raise MemoryUnavailable('unmapped')


class LiveTests(unittest.TestCase):
    def test_reward_updates_before_save_and_unstable_reads_are_ignored(self):
        mem = FakeMemory()
        reader = GameReader(mem, 0x80930000, 0)
        reward, tokens = 0x20000, 0x30000
        mem.blocks[reward + 0x16] = b'\0\0'
        mem.blocks[tokens] = struct.pack('<Q', reader.main + 0x4C20718)
        mem.blocks[tokens + 0x1C] = struct.pack('<ii', 25, 25)
        def field(_type, key, stride):
            return reward if key == 123 else tokens
        with patch('live.REWARD_FLAGS', [('heart',123)]), patch.object(reader,'field',side_effect=field):
            state, count = reader.reward_state(0x10000,0x11000)
            self.assertEqual(state['items'],[{'id':'heart','owned':False}])
            self.assertEqual(count,25)
            mem.blocks[reward + 0x16] = b'\1\1'
            state, count = reader.reward_state(0x10000,0x11000)
            self.assertEqual(state['items'],[{'id':'heart','owned':True}])
            mem.blocks[reward + 0x16] = b'\1\0'
            mem.blocks[tokens + 0x1C] = struct.pack('<ii',50,49)
            state, count = reader.reward_state(0x10000,0x11000)
            self.assertEqual(state['items'],[])
            self.assertIsNone(count)

    def test_heading_uses_forward_axis_and_map_south_is_positive_z(self):
        # Matrix values represent yaw about vertical Y, with +Z facing south.
        import math
        for yaw, expected in [(0, 180), (90, 90), (180, 0), (270, 270), (45, 135), (-45, 225)]:
            with self.subTest(yaw=yaw):
                angle = math.radians(yaw)
                co, si = math.cos(angle), math.sin(angle)
                rotation = [co, 0, si, 0, 1, 0, -si, 0, co]
                self.assertAlmostEqual(map_heading(rotation), expected)
        self.assertIsNone(map_heading([0] * 9))
        self.assertIsNone(map_heading([float('nan')] * 9))

    def test_zone_transition_keeps_the_connection(self):
        from live import ZoneTransition
        tracker = LiveTracker(Path('missing'))
        tracker.memory = Mock(); tracker.memory.alive.return_value = True
        tracker.reader = Mock(); tracker.reader.snapshot.side_effect = ZoneTransition('Changement de zone')
        self.assertEqual(tracker.snapshot()['reason'], 'Changement de zone')
        self.assertIsNotNone(tracker.reader)
        tracker.memory.close.assert_not_called()

    def test_closed_emulator_clears_cached_live_position(self):
        tracker = LiveTracker(Path('.'))
        tracker.memory = Mock()
        tracker.memory.alive.return_value = False
        tracker.reader = Mock()
        tracker.next_connect = time.monotonic() + 5
        tracker.cached = {'connected': True, 'player': {'position': [1, 2, 3]}}
        self.assertFalse(tracker.snapshot()['connected'])
        self.assertIsNone(tracker.cached['player'])

    def test_quest_hash_and_signed_save_value(self):
        self.assertEqual(murmur3(''), 0)
        self.assertEqual(murmur3('foo'), 0xF6A5C420)
        self.assertEqual(murmur3('Step_Get_Epona'), QUEST_FIELDS['epona'])
        self.assertEqual(COMPLETE, 0x4C0A63F4)
        values = {QUEST_FIELDS['epona']: COMPLETE, QUEST_FIELDS['biggoron']: murmur3('Step01'),
                  QUEST_FIELDS['training']: murmur3('NotReady')}
        states = quest_states(values.get, True)
        self.assertTrue(states['epona']['complete'])
        self.assertTrue(states['epona-song']['complete'])
        self.assertTrue(states['biggoron']['started'])
        self.assertFalse(states['biggoron']['complete'])
        self.assertFalse(states['training']['started'])
        self.assertNotIn('fire-arrow', states)

    def test_actor_identity_state_and_position(self):
        mem = FakeMemory()
        reader = GameReader(mem, 0x80930000, 0)
        actor, name, components, movement = 0x10000, 0x20000, 0x30000, 0x40000
        data = bytearray(0x328)
        struct.pack_into('<Q', data, 0, reader.main + 0x4B25E18)
        struct.pack_into('<Q', data, 0x20, name)
        struct.pack_into('<I', data, 0x2C, 4)
        struct.pack_into('<Q', data, 0x270, components)
        struct.pack_into('<fff', data, 0x31C, 20, 3, -10)
        mem.blocks = {actor: data, name: b'Player\0', components + 0x320: struct.pack('<Q', movement),
                      movement + 0x18: struct.pack('<Q', actor)}
        self.assertEqual(reader.position(actor), [20, 3, -10])
        struct.pack_into('<fff', data, 0x31C, 25, 3, -12)
        self.assertEqual(reader.position(actor), [25, 3, -12])
        struct.pack_into('<I', data, 0x2C, 7)
        with self.assertRaises(MemoryUnavailable): reader.position(actor)
        struct.pack_into('<I', data, 0x2C, 4)
        struct.pack_into('<f', data, 0x31C, float('nan'))
        with self.assertRaises(MemoryUnavailable): reader.position(actor)

    def test_tree_cycles_terminate(self):
        mem = FakeMemory()
        reader = GameReader(mem, 0x80930000, 0)
        mem.blocks[reader.main + 0x4E90D90] = struct.pack('<Q', 0x10000)
        mem.blocks[0x10038] = struct.pack('<Q', 0x20008)
        entry = bytearray(64)
        struct.pack_into('<QQ', entry, 8, 0x20008, 0x20008)
        struct.pack_into('<Q', entry, 0x38, 0x20000)
        mem.blocks[0x20000] = entry
        self.assertIsNone(reader.find_player())
        self.assertLess(mem.reads, 10)

    def test_field_table_rejects_bad_indices_and_sizes(self):
        mem = FakeMemory()
        reader = GameReader(mem, 0x80930000, 0)
        mem.blocks[0x10000] = struct.pack('<QIIQQII', 0, 1, 0, 0x20000, 0x30000, 0, 2)
        mem.blocks[0x30000] = struct.pack('<IIII', 123, 0, 456, 9999)
        self.assertEqual(reader.field(0x10000, 123, 0x38), 0x20000)
        self.assertIsNone(reader.field(0x10000, 456, 0x38))
        mem.blocks[0x10000] = struct.pack('<QIIQQII', 0, 1, 0, 0x20000, 0x30000, 0, 0xFFFFFFFF)
        with self.assertRaises(MemoryUnavailable): reader.field(0x10000, 123, 0x38)

    def test_transition_does_not_combine_two_zones(self):
        mem = FakeMemory()
        reader = GameReader(mem, 0x80930000, 0)
        reader.actor = 0x20000
        mem.blocks[0x10000] = bytes(0x800)
        with patch.object(reader, 'manager', return_value=0x10000), \
             patch.object(reader, 'area', side_effect=['Market_Adult', 'HyruleField_Adult']), \
             patch.object(reader, 'position', return_value=[1, 2, 3]):
            with self.assertRaises(MemoryUnavailable): reader.snapshot()
        self.assertIsNone(reader.actor)


if __name__ == '__main__': unittest.main()

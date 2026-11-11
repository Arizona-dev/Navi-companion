"""Quest field/stage identifiers from the game's GameData schema.

Layout reference: PracticeROM/sloperina data/story.json. No game code executed.
"""
QUEST_FIELDS = {'epona': 0x92431C55, 'biggoron': 0x26A2E01C,
                'fire-arrow': 0x110F26E4, 'training': 0xF7176A52}
EPONA_SONG = 3682874359


def murmur3(text):
    data = text.encode('utf-8')
    mask = 0xFFFFFFFF
    def rotate(value, bits):
        return ((value << bits) | (value >> (32 - bits))) & mask
    def mix(value):
        return (rotate((value * 0xCC9E2D51) & mask, 15) * 0x1B873593) & mask
    result = 0
    end = len(data) - len(data) % 4
    for offset in range(0, end, 4):
        result ^= mix(int.from_bytes(data[offset:offset + 4], 'little'))
        result = (rotate(result, 13) * 5 + 0xE6546B64) & mask
    if end < len(data):
        result ^= mix(int.from_bytes(data[end:], 'little'))
    result ^= len(data)
    result ^= result >> 16
    result = (result * 0x85EBCA6B) & mask
    result ^= result >> 13
    result = (result * 0xC2B2AE35) & mask
    return (result ^ (result >> 16)) & mask


COMPLETE = murmur3('Complete')
NOT_STARTED = {murmur3('NotReady'), murmur3('Ready')}


def quest_states(read_enum, song_learned=False):
    result = {}
    for name, field in QUEST_FIELDS.items():
        value = read_enum(field)
        if value is None:
            continue
        value &= 0xFFFFFFFF
        result[name] = {'complete': value == COMPLETE,
                        'started': value not in NOT_STARTED}
    result['epona-song'] = {'complete': bool(song_learned), 'started': bool(song_learned)}
    return result

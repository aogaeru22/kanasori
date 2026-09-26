"""Enlarge and evenly space the visible 2pt / 3pt SWF drawing buttons."""
import pathlib
import struct
import zlib
from _swf_matrix import iter_tags, read_matrix
from _swf_patch import Bits

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILES = ['a_ka_sa/03-02', 'a_ka_sa/03-04', 'a_ka_sa/03-08',
         'ta_na_ha/03-02', 'ta_na_ha/03-04', 'ta_na_ha/03-07',
         'ma_ya_ra_wa/03-01', 'ma_ya_ra_wa/03-03', 'ma_ya_ra_wa/03-06', 'ma_ya_ra_wa/03-09']
for stem in FILES:
    path = ROOT / 'kana/01_hiragana' / (stem + '.swf')
    source = path.read_bytes()
    raw = zlib.decompress(source[8:])
    output = bytearray(raw)
    count = 0
    for code, start, body in iter_tags(raw):
        if code != 26 or body[0] != 0x26:
            continue
        matrix = read_matrix(body[5:])
        name = body[5 + matrix['bytes']:].rstrip(b'\0')
        if name not in (b'penSize2', b'penSize3'):
            continue
        body_start = start + (6 if raw[start] & 63 == 63 else 2)
        bits = Bits(output, (body_start + 5) * 8)
        assert bits.get(1) == 1
        n = bits.get(5)
        # Existing 17-bit signed scale supports up to just under 1.0.
        # Keep the matrix byte length by using its spare translation bits below.
        # Rebuild a matrix with 18-bit scale to fit 1.35x.
        values = []
        def put(value, width):
            values.extend((value >> shift) & 1 for shift in range(width-1, -1, -1))
        put(1,1); put(18,5)
        put(round(1.35*65536),18); put(round(1.35*65536),18)
        put(0,1); put(15,5)
        put(11480 if name == b'penSize2' else 12160,15)
        put(8880,15)
        values.extend([0] * ((-len(values)) % 8))
        encoded = bytes(sum(values[i+j] << (7-j) for j in range(8)) for i in range(0,len(values),8))
        assert len(encoded) == matrix['bytes']
        output[body_start+5:body_start+5+len(encoded)] = encoded
        count += 1
    assert count == 2, (stem,count)
    path.write_bytes(source[:8] + zlib.compress(output,9))
    print(stem, '2pt/3pt enlarged and spaced')

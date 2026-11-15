"""Shift the katakana A/KA voca magic lamp left of the return button."""
import pathlib
import struct
import zlib

from _swf_matrix import iter_tags
from _swf_patch import read_translate, write_translate_x

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / "kana/02_katakana/voca_practice_katakana/A행-KA행.swf"
# Was under the HTML return button (~x=733). Park it in the open space to the left.
NEW_X_PX = 640.0


def main():
    source = PATH.read_bytes()
    raw = bytearray(zlib.decompress(source[8:]))
    changed = 0
    for code, start, body in iter_tags(bytes(raw)):
        if code != 26 or len(body) < 6:
            continue
        flags = body[0]
        p = 3
        ch = None
        if flags & 2:
            ch = struct.unpack_from("<H", body, p)[0]
            p += 2
        if ch != 104 or not (flags & 4):
            continue
        body_start = start + (6 if raw[start] & 63 == 63 else 2)
        x, y, nbits = read_translate(raw, body_start)
        write_translate_x(raw, body_start, round(NEW_X_PX * 20))
        nx, ny, _ = read_translate(raw, body_start)
        print(f"lamp ({x/20:.1f},{y/20:.1f}) -> ({nx/20:.1f},{ny/20:.1f}) nbits={nbits}")
        changed += 1
    if changed != 1:
        raise SystemExit(f"expected 1 lamp move, got {changed}")
    PATH.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
    print("wrote", PATH.relative_to(ROOT))


if __name__ == "__main__":
    main()

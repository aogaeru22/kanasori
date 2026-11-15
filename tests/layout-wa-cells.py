"""Space hiragana wa-row cells onto the same 5-slot grid as katakana wa."""
import pathlib
import struct
import zlib

from _swf_matrix import iter_tags
from _swf_patch import read_translate, write_translate_x

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATH = ROOT / "kana/01_hiragana/ma_ya_ra_wa/03-09.swf"

# Compressed 3-cell x -> 5-slot odd positions (same as kata-wa / hira ya).
MOVES = {
    (87.5, 145.8): 113.8,
    (128.0, 178.0): 108.0,
    (128.0, 526.0): 596.0,
    (173.5, 222.85): 152.85,
    (173.5, 569.85): 639.85,
}

# DefineShape cid=32: replace 3-cell grey strip with ya-row 5-cell strip (same length).
STRIP_OLD = bytes.fromhex("200078c44633625dc957800100cccccc001015ec66c957fd2d54f6db23d12abf6a4e00")
STRIP_NEW = bytes.fromhex("2000786cc6e2625dc957800100cccccc001015edc4c957fd27dcf6db23d1823f6a4e00")


def main():
    source = PATH.read_bytes()
    raw = bytearray(zlib.decompress(source[8:]))
    moved = 0
    for code, start, body in iter_tags(bytes(raw)):
        if code != 26 or len(body) < 6:
            continue
        flags = body[0]
        if not (flags & 4):
            continue
        body_start = start + (6 if raw[start] & 63 == 63 else 2)
        x, y, nbits = read_translate(raw, body_start)
        px, py = x / 20, y / 20
        for (ty, tx), new_px in MOVES.items():
            if abs(py - ty) > 0.05 or abs(px - tx) > 0.05:
                continue
            write_translate_x(raw, body_start, round(new_px * 20))
            got_x, got_y, _ = read_translate(raw, body_start)
            print(f"  move ({px:.2f},{py:.2f}) -> ({got_x/20:.2f},{got_y/20:.2f}) nbits={nbits}")
            moved += 1
            break

    strip_at = bytes(raw).find(STRIP_OLD)
    if strip_at < 0:
        if bytes(raw).find(STRIP_NEW) >= 0:
            print("  strip already 5-cell")
            strip_changed = False
        else:
            raise SystemExit("cell strip shape not found")
    else:
        raw[strip_at : strip_at + len(STRIP_OLD)] = STRIP_NEW
        print("  strip 3-cell -> 5-cell")
        strip_changed = True

    if moved == 0 and not strip_changed:
        print("already patched", PATH.relative_to(ROOT))
        return
    if moved not in (0, len(MOVES)):
        raise SystemExit(f"partial move: {moved}/{len(MOVES)}")

    PATH.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
    print("patched", PATH.relative_to(ROOT), "moves", moved, "strip", strip_changed)


if __name__ == "__main__":
    main()

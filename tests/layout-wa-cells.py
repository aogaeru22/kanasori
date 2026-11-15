"""Make hiragana wa-row use the same 5-slot cell panel as katakana wa."""
import pathlib
import struct
import zlib

from _swf_matrix import iter_tags
from _swf_patch import read_translate, write_translate_x
from _swf_replace_tag import extract_shape, replace_define_shape

ROOT = pathlib.Path(__file__).resolve().parents[1]
HIRA = ROOT / "kana/01_hiragana/ma_ya_ra_wa/03-09.swf"
KATA = ROOT / "kana/02_katakana/ha_ma_ya_ra_wa-katakana/03-05.swf"

# Compressed 3-cell x -> 5-slot odd positions (same as kata-wa).
CELL_MOVES = {
    (87.5, 145.8): 113.8,
    (128.0, 178.0): 108.0,
    (128.0, 526.0): 596.0,
    (173.5, 222.85): 152.85,
    (173.5, 569.85): 639.85,
}

STRIP_OLD = bytes.fromhex("200078c44633625dc957800100cccccc001015ec66c957fd2d54f6db23d12abf6a4e00")
STRIP_NEW = bytes.fromhex("2000786cc6e2625dc957800100cccccc001015edc4c957fd27dcf6db23d1823f6a4e00")

# Nudge the grey writing pad and its tools right, clear of the green example box.
BOARD_MOVES = {
    (356.90, 545.35): 575.35,
    (444.00, 574.00): 604.00,
    (444.00, 608.00): 638.00,
    (445.15, 574.50): 604.50,
    (445.15, 594.30): 624.30,
    (446.95, 423.40): 453.40,
    (446.95, 450.40): 480.40,
    (446.95, 477.55): 507.55,
    (446.95, 504.35): 534.35,
    (446.95, 531.30): 561.30,
    (344.85, 545.55): 575.55,
    (443.15, 653.40): 683.40,
    (426.95, 658.30): 688.30,
    (426.95, 650.70): 680.70,
}


def apply_moves(raw: bytearray, moves: dict, label: str) -> int:
    moved = 0
    for code, start, body in iter_tags(bytes(raw)):
        if code != 26 or len(body) < 6:
            continue
        flags = body[0]
        if not (flags & 4):
            continue
        body_start = start + (6 if raw[start] & 63 == 63 else 2)
        x, y, _nbits = read_translate(raw, body_start)
        px, py = x / 20, y / 20
        for (ty, tx), new_px in moves.items():
            if abs(py - ty) > 0.05 or abs(px - tx) > 0.05:
                continue
            write_translate_x(raw, body_start, round(new_px * 20))
            got_x, got_y, _ = read_translate(raw, body_start)
            print(f"  [{label}] ({px:.2f},{py:.2f}) -> ({got_x/20:.2f},{got_y/20:.2f})")
            moved += 1
            break
    return moved


def encode_matrix(tx_twips: int, ty_twips: int = 0) -> bytes:
    """PlaceObject matrix: no scale/rotate, translate in twips."""
    nbits = max(tx_twips.bit_length() + 1, ty_twips.bit_length() + 1, 1)
    bits = [0, 0]  # no scale, no rotate
    bits.extend((nbits >> i) & 1 for i in range(4, -1, -1))

    def put_signed(val, width):
        if val < 0:
            val += 1 << width
        bits.extend((val >> i) & 1 for i in range(width - 1, -1, -1))

    put_signed(tx_twips, nbits)
    put_signed(ty_twips, nbits)
    bits.extend([0] * ((-len(bits)) % 8))
    out = bytearray()
    for i in range(0, len(bits), 8):
        byte = 0
        for j in range(8):
            byte = (byte << 1) | bits[i + j]
        out.append(byte)
    return bytes(out)


def shift_shape39(raw: bytearray, label: str, dx_px: int = 30) -> None:
    """Rewrite the zero-translate PlaceObject2 for shape 39 so the grey frame moves."""
    for code, start, body in iter_tags(bytes(raw)):
        if code != 26 or len(body) < 6:
            continue
        flags = body[0]
        depth = struct.unpack_from("<H", body, 1)[0]
        p = 3
        ch = None
        if flags & 2:
            ch = struct.unpack_from("<H", body, p)[0]
            p += 2
        if ch != 39 or flags != 0x06:
            continue
        x, y, _ = read_translate(raw, start + (6 if raw[start] & 63 == 63 else 2))
        if x != 0 or y != 0:
            continue
        new_body = (
            bytes([0x06])
            + struct.pack("<HH", depth, 39)
            + encode_matrix(dx_px * 20, 0)
        )
        hdr = 6 if raw[start] & 63 == 63 else 2
        old_len = struct.unpack_from("<H", raw, start)[0] & 63
        if old_len == 0x3F:
            old_len = struct.unpack_from("<I", raw, start + 2)[0]
            hdr = 6
        old_end = start + hdr + old_len
        if len(new_body) >= 0x3F:
            new_header = struct.pack("<HI", (26 << 6) | 0x3F, len(new_body))
        else:
            new_header = struct.pack("<H", (26 << 6) | len(new_body))
        raw[start:old_end] = new_header + new_body
        print(f"  [{label}] shape39 place x 0 -> {dx_px}")
        return
    print(f"  [{label}] shape39 place not found")


def patch_hira():
    source = HIRA.read_bytes()
    raw = bytearray(zlib.decompress(source[8:]))

    print("  cell moves:", apply_moves(raw, CELL_MOVES, "cells"))

    strip_at = bytes(raw).find(STRIP_OLD)
    if strip_at >= 0:
        raw[strip_at : strip_at + len(STRIP_OLD)] = STRIP_NEW
        print("  strip -> 5-cell")
    elif bytes(raw).find(STRIP_NEW) >= 0:
        print("  strip already 5-cell")
    else:
        raise SystemExit("cell strip not found")

    kata_panel = extract_shape(KATA, 38, shape_code=32)
    kata_alt = bytearray(extract_shape(KATA, 133, shape_code=32))
    struct.pack_into("<H", kata_alt, 0, 101)

    if not replace_define_shape(raw, 101, bytes(kata_alt), shape_code=32):
        raise SystemExit("panel 101 not replaced")
    print("  panel 101 -> 5-cell")
    # Re-find after length-changing edit.
    if not replace_define_shape(raw, 38, kata_panel, shape_code=32):
        raise SystemExit("panel 38 not replaced")
    print("  panel 38 -> 5-cell")

    print("  board moves:", apply_moves(raw, BOARD_MOVES, "board"))
    shift_shape39(raw, "board")

    HIRA.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
    print("wrote", HIRA.relative_to(ROOT), "bytes", HIRA.stat().st_size)


def patch_kata_boards():
    source = KATA.read_bytes()
    raw = bytearray(zlib.decompress(source[8:]))
    print("  board moves:", apply_moves(raw, BOARD_MOVES, "kata"))
    shift_shape39(raw, "kata")
    KATA.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
    print("wrote", KATA.relative_to(ROOT), "bytes", KATA.stat().st_size)


if __name__ == "__main__":
    print("hiragana wa:")
    patch_hira()
    print("katakana wa:")
    patch_kata_boards()

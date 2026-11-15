"""Fix hiragana wa-row: 5-cell panel fill + undo writing-board drift."""
import pathlib
import struct
import zlib

from _swf_matrix import iter_tags, read_matrix
from _swf_patch import Bits, read_translate, write_translate_x
from _swf_replace_tag import extract_shape, replace_define_shape

ROOT = pathlib.Path(__file__).resolve().parents[1]
HIRA = ROOT / "kana/01_hiragana/ma_ya_ra_wa/03-09.swf"
KATA = ROOT / "kana/02_katakana/ha_ma_ya_ra_wa-katakana/03-05.swf"

# Undo the board nudge from the previous pass (shifted -> original).
BOARD_REVERT = {
    (356.90, 575.35): 545.35,
    (444.00, 604.00): 574.00,
    (444.00, 638.00): 608.00,
    (445.15, 604.50): 574.50,
    (445.15, 624.30): 594.30,
    (446.95, 453.40): 423.40,
    (446.95, 480.40): 450.40,
    (446.95, 507.55): 477.55,
    (446.95, 534.35): 504.35,
    (446.95, 561.30): 531.30,
    (344.85, 575.55): 545.55,
    (443.15, 683.40): 653.40,
    (426.95, 688.30): 658.30,
    (426.95, 680.70): 650.70,
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
        x, y, _ = read_translate(raw, body_start)
        px, py = x / 20, y / 20
        for (ty, tx), new_px in moves.items():
            if abs(py - ty) > 0.05 or abs(px - tx) > 0.05:
                continue
            write_translate_x(raw, body_start, round(new_px * 20))
            nx, ny, _ = read_translate(raw, body_start)
            print(f"  [{label}] ({px:.2f},{py:.2f}) -> ({nx/20:.2f},{ny/20:.2f})")
            moved += 1
            break
    return moved


def encode_matrix(sx: float, sy: float, tx_px: float, ty_px: float) -> bytes:
    """Matrix with scale + translate; no rotate. Keeps enough bits for wa fill."""
    sx_f = round(sx * 65536)
    sy_f = round(sy * 65536)
    tx = round(tx_px * 20)
    ty = round(ty_px * 20)
    n_scale = max(sx_f.bit_length() + 1, sy_f.bit_length() + 1, 1)
    n_tr = max(tx.bit_length() + 1, ty.bit_length() + 1, 1)
    bits = [1]
    bits.extend((n_scale >> i) & 1 for i in range(4, -1, -1))

    def put_signed(val, width):
        if val < 0:
            val += 1 << width
        bits.extend((val >> i) & 1 for i in range(width - 1, -1, -1))

    put_signed(sx_f, n_scale)
    put_signed(sy_f, n_scale)
    bits.append(0)  # no rotate
    bits.extend((n_tr >> i) & 1 for i in range(4, -1, -1))
    put_signed(tx, n_tr)
    put_signed(ty, n_tr)
    bits.extend([0] * ((-len(bits)) % 8))
    out = bytearray()
    for i in range(0, len(bits), 8):
        byte = 0
        for j in range(8):
            byte = (byte << 1) | bits[i + j]
        out.append(byte)
    return bytes(out)


def rewrite_place(raw: bytearray, character_id: int, new_body: bytes, label: str) -> bool:
    for code, start, body in iter_tags(bytes(raw)):
        if code != 26 or len(body) < 6:
            continue
        flags = body[0]
        p = 3
        ch = None
        if flags & 2:
            ch = struct.unpack_from("<H", body, p)[0]
        if ch != character_id:
            continue
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
        print(f"  [{label}] rewrote place char={character_id}")
        return True
    return False


def set_cell_fill_scale(raw: bytearray, scale_x: float, label: str) -> None:
    """Shape 33 is a unit cell square stretched across the row as the white fill."""
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
        if ch != 33 or not (flags & 4):
            continue
        m = read_matrix(body[p:])
        tx, ty = m["translate"][0] / 20, m["translate"][1] / 20
        old = m["scale"]
        old_s = f"({old[0]/65536:.3f},{old[1]/65536:.3f})" if old else "none"
        new_body = bytes([0x06]) + struct.pack("<HH", depth, 33) + encode_matrix(scale_x, 1.0, tx, ty)
        if not rewrite_place(raw, 33, new_body, label):
            raise SystemExit("shape33 place rewrite failed")
        print(f"  [{label}] cell fill scale {old_s} -> ({scale_x:.3f},1.000) at {tx:.2f},{ty:.2f}")
        return
    raise SystemExit("shape33 place not found")


def restore_shape39(raw: bytearray, label: str) -> None:
    """Put the grey pad frame back at translate 0,0 (zero-bit matrix)."""
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
        if ch != 39:
            continue
        # Original was flags=0x06, depth, char, matrix 0x00
        new_body = bytes([0x06]) + struct.pack("<HH", depth, 39) + b"\x00"
        if not rewrite_place(raw, 39, new_body, label + "-shape39"):
            raise SystemExit("shape39 restore failed")
        print(f"  [{label}] shape39 back to 0,0")
        return
    print(f"  [{label}] shape39 not found")


def ensure_panels(raw: bytearray) -> None:
    from _swf_matrix import Bits as B

    def width(cid):
        for code, start, body in iter_tags(bytes(raw)):
            if code == 32 and struct.unpack_from("<H", body, 0)[0] == cid:
                bits = B(body, 16)
                n = bits.get(5)
                x0 = bits.get_signed(n) / 20
                x1 = bits.get_signed(n) / 20
                return x1 - x0
        return None

    w38 = width(38)
    if w38 is not None and abs(w38 - 610.5) < 1:
        print("  panel 38 already 5-cell")
    else:
        kata_panel = extract_shape(KATA if width(38) is None else ROOT / "kana/02_katakana/ha_ma_ya_ra_wa-katakana/03-05.swf", 38, 32)
        # Prefer unshifted kata from git if current kata still has boards moved — panel shape itself is fine.
        if not replace_define_shape(raw, 38, kata_panel, 32):
            raise SystemExit("panel 38 replace failed")
        print("  panel 38 -> 5-cell")

    w101 = width(101)
    if w101 is not None and abs(w101 - 610.5) < 1:
        print("  panel 101 already 5-cell")
    else:
        # Use kata 133 as alt panel template
        src = pathlib.Path("kana/02_katakana/ha_ma_ya_ra_wa-katakana/03-05.swf")
        # If panels already replaced, skip. Otherwise need kata original 133.
        import subprocess

        kata_bytes = subprocess.check_output(
            ["git", "show", "f0b9034:kana/02_katakana/ha_ma_ya_ra_wa-katakana/03-05.swf"]
        )
        tmp = ROOT / "tests/_kata_wa_tmp.swf"
        tmp.write_bytes(kata_bytes)
        try:
            alt = bytearray(extract_shape(tmp, 133, 32))
            struct.pack_into("<H", alt, 0, 101)
            if not replace_define_shape(raw, 101, bytes(alt), 32):
                raise SystemExit("panel 101 replace failed")
            print("  panel 101 -> 5-cell")
        finally:
            tmp.unlink(missing_ok=True)


def patch_hira():
    source = HIRA.read_bytes()
    raw = bytearray(zlib.decompress(source[8:]))
    print("hiragana wa:")
    # Panels should already be 5-cell from prior commit; verify / fix if needed.
    from _swf_matrix import Bits as B

    def panel_w(cid):
        for code, start, body in iter_tags(bytes(raw)):
            if code == 32 and struct.unpack_from("<H", body, 0)[0] == cid:
                bits = B(body, 16)
                n = bits.get(5)
                x0 = bits.get_signed(n) / 20
                x1 = bits.get_signed(n) / 20
                return x1 - x0
        return None

    if abs((panel_w(38) or 0) - 610.5) > 1:
        import subprocess

        kata_bytes = subprocess.check_output(
            ["git", "show", "f0b9034:kana/02_katakana/ha_ma_ya_ra_wa-katakana/03-05.swf"]
        )
        tmp = ROOT / "tests/_kata_wa_tmp.swf"
        tmp.write_bytes(kata_bytes)
        try:
            panel = extract_shape(tmp, 38, 32)
            alt = bytearray(extract_shape(tmp, 133, 32))
            struct.pack_into("<H", alt, 0, 101)
            replace_define_shape(raw, 101, bytes(alt), 32)
            replace_define_shape(raw, 38, panel, 32)
            print("  panels restored to 5-cell")
        finally:
            tmp.unlink(missing_ok=True)
    else:
        print("  panels ok")

    set_cell_fill_scale(raw, 5.0, "fill")
    print("  board revert:", apply_moves(raw, BOARD_REVERT, "board"))
    restore_shape39(raw, "board")
    HIRA.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
    print("wrote", HIRA.relative_to(ROOT))


def patch_kata():
    source = KATA.read_bytes()
    raw = bytearray(zlib.decompress(source[8:]))
    print("katakana wa:")
    print("  board revert:", apply_moves(raw, BOARD_REVERT, "kata"))
    restore_shape39(raw, "kata")
    KATA.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
    print("wrote", KATA.relative_to(ROOT))


if __name__ == "__main__":
    patch_hira()
    patch_kata()

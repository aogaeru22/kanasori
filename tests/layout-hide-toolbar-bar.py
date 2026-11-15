"""Hide the leftover gray toolbar strip (looks like a vertical line next to clear)."""
import pathlib
import struct
import zlib

from _swf_matrix import iter_tags
from _swf_patch import read_rect_end

ROOT = pathlib.Path(__file__).resolve().parents[1]


def read_rect(data, offset=0):
    nbits = data[offset] >> 3
    bit = offset * 8 + 5

    def get(n):
        nonlocal bit
        val = 0
        for _ in range(n):
            byte_i = bit // 8
            bit_i = 7 - (bit % 8)
            val = (val << 1) | ((data[byte_i] >> bit_i) & 1)
            bit += 1
        return val

    def get_signed(n):
        val = get(n)
        if n and val & (1 << (n - 1)):
            val -= 1 << n
        return val

    return (
        get_signed(nbits) / 20,
        get_signed(nbits) / 20,
        get_signed(nbits) / 20,
        get_signed(nbits) / 20,
    )


def toolbar_strip_ids(raw):
    ids = set()
    for code, _start, body in iter_tags(raw):
        if code not in (2, 22, 32, 83) or len(body) < 4:
            continue
        sid = struct.unpack_from("<H", body, 0)[0]
        try:
            xmin, xmax, ymin, ymax = read_rect(body, 2)
        except Exception:
            continue
        width = xmax - xmin
        height = ymax - ymin
        # Gray remnant between former colors and clear (~71x18 near y 436).
        if 500 <= xmin <= 580 and 600 <= xmax <= 650 and 420 <= ymin <= 450:
            if 40 <= width <= 100 and 10 <= height <= 30:
                ids.add(sid)
    return ids


def hide_place(raw: bytearray, start: int, body: bytes) -> bool:
    """Rewrite identity-matrix PlaceObject2 so the character is parked off-canvas."""
    long_form = raw[start] & 63 == 63
    hdr = 6 if long_form else 2
    # flags, depth, character, matrix(0x00)
    if len(body) != 6 or body[0] != 0x06 or body[5] != 0x00:
        return False
    # flags|depth|char|matrix with nTranslateBits=15, tx=-16384, ty=0
    new_body = body[:5] + bytes([0x1F, 0x00, 0x00, 0x00, 0x00])
    if long_form:
        struct.pack_into("<I", raw, start + 2, len(new_body))
        raw[start + hdr : start + hdr + len(body)] = new_body
        # Body grew by 4 bytes — must insert.
        # Above assignment fails if lengths differ; splice instead.
    # Splice properly:
    raw[start + hdr : start + hdr + len(body)] = new_body
    if len(new_body) != len(body):
        # Replace slice already done; if we assigned different length to bytearray slice it resizes.
        pass
    if not long_form:
        # Was short tag; length nibble must become long form.
        raise ValueError("expected long PlaceObject2 tag")
    struct.pack_into("<I", raw, start + 2, len(new_body))
    return True


def patch(path: pathlib.Path) -> str:
    source = path.read_bytes()
    if source[:3] != b"CWS":
        return "skip"
    raw = bytearray(zlib.decompress(source[8:]))
    ids = toolbar_strip_ids(bytes(raw))
    if not ids:
        return "skip"

    hidden = []
    # Rebuild by scanning tags; when we hide, body length grows so re-scan from scratch each time.
    changed = True
    while changed:
        changed = False
        for code, start, body in iter_tags(bytes(raw)):
            if code != 26 or len(body) < 5 or not (body[0] & 0x02):
                continue
            char = struct.unpack_from("<H", body, 3)[0]
            if char not in ids:
                continue
            if body[0] == 0x06 and len(body) == 6 and body[5] == 0x00:
                long_form = raw[start] & 63 == 63
                hdr = 6 if long_form else 2
                new_body = bytes([body[0], body[1], body[2], body[3], body[4], 0x1F, 0x00, 0x00, 0x00, 0x00])
                if not long_form:
                    # Upgrade short header to long: (code<<6)|63 + u32 len.
                    raw[start : start + 2 + len(body)] = (
                        struct.pack("<H", (26 << 6) | 63)
                        + struct.pack("<I", len(new_body))
                        + new_body
                    )
                else:
                    raw[start + 2 : start + 6] = struct.pack("<I", len(new_body))
                    raw[start + hdr : start + hdr + len(body)] = new_body
                hidden.append(char)
                changed = True
                break
            # Already rewritten?
            if body[0] == 0x06 and len(body) >= 10 and body[5:10] == bytes([0x1F, 0x00, 0x00, 0x00, 0x00]):
                continue
    if not hidden:
        return f"found shapes {sorted(ids)} but no place to hide"
    path.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
    return f"hidden strip shapes {sorted(set(hidden))}"


def main():
    changed = 0
    for path in sorted((ROOT / "kana").rglob("*.swf")):
        if "before" in path.parts or "voca_practice" in path.parts:
            continue
        result = patch(path)
        if result == "skip":
            continue
        print(path.relative_to(ROOT).as_posix(), result)
        if result.startswith("hidden"):
            changed += 1
    print("patched", changed)


if __name__ == "__main__":
    main()

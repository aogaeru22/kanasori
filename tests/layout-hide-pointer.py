"""Hide the laggy Flash writing-board pen cursor (instance: pointer).

The clip is driven by onMouseMove, so parking PlaceObject alone is not enough.
Zero its scale (stays invisible while AS still moves it) and change Mouse.hide
to Mouse.show so the system cursor remains over the board chrome.
"""
import pathlib
import zlib

from _swf_matrix import iter_tags, read_matrix
from _swf_patch import Bits, read_translate, write_translate_x

ROOT = pathlib.Path(__file__).resolve().parents[1]
WANT = b"pointer"


def pointer_place(raw: bytes):
    for code, start, body in iter_tags(raw):
        if code != 26 or len(body) < 6 or body[0] != 0x26:
            continue
        if WANT not in body:
            continue
        matrix = read_matrix(body[5:])
        name = body[5 + matrix["bytes"] :].split(b"\x00", 1)[0]
        if name != WANT:
            continue
        body_start = start + (6 if raw[start] & 63 == 63 else 2)
        return body_start, matrix
    return None, None


def zero_pointer_scale(raw: bytearray, body_start: int) -> None:
    """Force PlaceObject2 scale_x/scale_y to 0 so the moving cursor is invisible."""
    bits = Bits(raw, (body_start + 5) * 8)
    if bits.get(1) != 1:
        raise ValueError("pointer matrix has no scale")
    n = bits.get(5)
    bits.set(n, 0)
    bits.set(n, 0)


def mouse_hide_to_show(raw: bytearray) -> bool:
    """In the pointer DoAction constant pool, rename hide -> show (same length)."""
    for code, start, body in iter_tags(bytes(raw)):
        if code != 12 or WANT not in body or b"hide" not in body:
            continue
        if body[0] != 0x88:
            continue
        length = int.from_bytes(body[1:3], "little")
        pool = body[3 : 3 + length]
        # ConstantPool payload starts with count (ui16), then cstrings.
        pos = 2
        while pos < len(pool):
            end = pool.find(b"\x00", pos)
            if end < 0:
                break
            if pool[pos:end] == b"hide":
                abs_at = start + (6 if raw[start] & 63 == 63 else 2) + 3 + pos
                # Verify short tag header for DoAction at frame 1 (start usually 34).
                hdr = 6 if raw[start] & 63 == 63 else 2
                abs_at = start + hdr + 3 + pos
                raw[abs_at : abs_at + 4] = b"show"
                return True
            pos = end + 1
    return False


def patch(path: pathlib.Path) -> str:
    source = path.read_bytes()
    if source[:3] != b"CWS":
        return "skip"
    raw = bytearray(zlib.decompress(source[8:]))
    if WANT not in raw or b"clearBtn" not in raw:
        return "skip"
    offset, matrix = pointer_place(bytes(raw))
    if offset is None:
        return "missing pointer place"
    if not matrix["scale"]:
        return "pointer has no scale"

    x, y, n = read_translate(raw, offset)
    hide = -(1 << (n - 1))
    write_translate_x(raw, offset, hide)
    zero_pointer_scale(raw, offset)
    if not mouse_hide_to_show(raw):
        return "missing Mouse.hide pool entry"

    nx, ny, _ = read_translate(raw, offset)
    path.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
    return f"pointer hidden; {x / 20:.1f},{y / 20:.1f} -> {nx / 20:.1f},{ny / 20:.1f}"


def main():
    changed = 0
    for path in sorted((ROOT / "kana").rglob("*.swf")):
        if "before" in path.parts or "voca_practice" in path.parts:
            continue
        result = patch(path)
        if result == "skip":
            continue
        print(path.relative_to(ROOT).as_posix(), result)
        if result.startswith("pointer hidden"):
            changed += 1
    print("patched", changed)


if __name__ == "__main__":
    main()

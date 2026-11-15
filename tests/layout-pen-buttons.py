"""Hide 2pt/3pt buttons and center 화면지우기 in the right toolbar slot."""
import pathlib
import zlib

from _swf_matrix import iter_tags, read_matrix
from _swf_patch import read_translate, write_translate_x

ROOT = pathlib.Path(__file__).resolve().parents[1]

# Right toolbar slot (after the color separator → pad edge), in SWF pixels.
# Centering clear here matches the empty bay left by removing 2pt/3pt.
SLOT_LEFT = 548.0
SLOT_RIGHT = 690.0
CLEAR_X = (SLOT_LEFT + SLOT_RIGHT) / 2  # 619


def named_button_places(raw):
    found = {}
    for code, start, body in iter_tags(raw):
        if code != 26 or len(body) < 6 or body[0] != 0x26:
            continue
        if b"penSize" not in body and b"clearBtn" not in body:
            continue
        matrix = read_matrix(body[5:])
        name = body[5 + matrix["bytes"] :].split(b"\x00", 1)[0]
        if name not in (b"penSize2", b"penSize3", b"clearBtn"):
            continue
        body_start = start + (6 if raw[start] & 63 == 63 else 2)
        found[name.decode()] = body_start
    return found


def patch(path: pathlib.Path) -> str:
    source = path.read_bytes()
    if source[:3] != b"CWS":
        return "skip"
    raw = bytearray(zlib.decompress(source[8:]))
    if b"clearBtn" not in raw:
        return "skip"
    buttons = named_button_places(bytes(raw))
    if "clearBtn" not in buttons:
        return "skip"

    # Hide 2pt/3pt when still on-canvas.
    for name in ("penSize2", "penSize3"):
        if name not in buttons:
            continue
        x, _y, nbits = read_translate(raw, buttons[name])
        if x >= 0:
            write_translate_x(raw, buttons[name], -(1 << (nbits - 1)))

    xc, yc, nc = read_translate(raw, buttons["clearBtn"])
    target = round(CLEAR_X * 20)
    limit = 1 << (nc - 1)
    if not -limit <= target <= limit - 1:
        return f"clear x {target} does not fit in {nc} bits"
    if abs(xc - target) < 2:
        path.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
        return f"clear already centered ({xc/20:.1f}); pens hidden"
    write_translate_x(raw, buttons["clearBtn"], target)
    nx, ny, _ = read_translate(raw, buttons["clearBtn"])
    path.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
    return f"clear {xc/20:.1f} -> {nx/20:.1f}; pens hidden"


def main():
    changed = 0
    for path in sorted((ROOT / "kana").rglob("*.swf")):
        if "before" in path.parts or "voca_practice" in path.parts:
            continue
        result = patch(path)
        if result == "skip":
            continue
        print(path.relative_to(ROOT).as_posix(), result)
        changed += 1
    print("patched", changed)


if __name__ == "__main__":
    main()

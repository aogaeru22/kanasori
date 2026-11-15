"""Hide 2pt/3pt drawing buttons and center 화면지우기 in their place."""
import pathlib
import struct
import zlib

from _swf_matrix import iter_tags, read_matrix
from _swf_patch import read_translate, write_translate_x

ROOT = pathlib.Path(__file__).resolve().parents[1]


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
    if b"penSize2" not in raw or b"clearBtn" not in raw:
        return "skip"
    buttons = named_button_places(bytes(raw))
    if not {"penSize2", "penSize3", "clearBtn"} <= set(buttons):
        return f"missing {sorted(set(buttons))}"

    x2, y2, n2 = read_translate(raw, buttons["penSize2"])
    x3, y3, n3 = read_translate(raw, buttons["penSize3"])
    xc, yc, nc = read_translate(raw, buttons["clearBtn"])

    # Park 2pt/3pt off-canvas (same approach as the hidden 1pt button).
    hide = -(1 << (n2 - 1))
    write_translate_x(raw, buttons["penSize2"], hide)
    hide3 = -(1 << (n3 - 1))
    write_translate_x(raw, buttons["penSize3"], hide3)

    # Center clear in the former 2pt/3pt span; keep its y.
    center = (x2 + x3) // 2
    limit = 1 << (nc - 1)
    if not -limit <= center <= limit - 1:
        return f"clear x {center} does not fit in {nc} bits"

    write_translate_x(raw, buttons["clearBtn"], center)
    nx, ny, _ = read_translate(raw, buttons["clearBtn"])
    path.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
    return (
        f"pens {x2/20:.1f}/{x3/20:.1f} hidden; "
        f"clear {xc/20:.1f},{yc/20:.1f} -> {nx/20:.1f},{ny/20:.1f}"
    )


def main():
    changed = 0
    for path in sorted((ROOT / "kana").rglob("*.swf")):
        if "before" in path.parts or "voca_practice" in path.parts:
            continue
        result = patch(path)
        if result == "skip":
            continue
        print(path.relative_to(ROOT).as_posix(), result)
        if not result.startswith("missing") and "does not fit" not in result:
            changed += 1
    print("patched", changed)


if __name__ == "__main__":
    main()

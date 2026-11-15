"""Set the writing-board default stroke to the former 3pt thickness (penSize=8)."""
import pathlib
import struct
import zlib

from _swf_matrix import iter_tags

ROOT = pathlib.Path(__file__).resolve().parents[1]


def set_default_pensize(raw: bytearray) -> bool:
    """Change the initial penSize SetVariable to 8 (3pt)."""
    data = bytes(raw)
    for code, start, body in iter_tags(data):
        if code != 12 or b"lineStyle" not in body or b"penSize\x00" not in body:
            continue
        if body[0] != 0x88:
            continue
        pos = 3
        count = struct.unpack_from("<H", body, pos)[0]
        pos += 2
        pool = []
        for _ in range(count):
            end = body.index(b"\x00", pos)
            pool.append(body[pos:end].decode("latin1"))
            pos = end + 1
        if "penSize" not in pool:
            continue
        idx = pool.index("penSize")
        # Walk actions; first Push(penSize, int N) + SetVariable is the default.
        i = pos
        body_start = start + (6 if data[start] & 63 == 63 else 2)
        while i < len(body):
            op = body[i]
            if op == 0x96:
                n = struct.unpack_from("<H", body, i + 1)[0]
                payload = body[i + 3 : i + 3 + n]
                nxt = body[i + 3 + n] if i + 3 + n < len(body) else None
                # Expect: type8 const idx, type7 int32
                if (
                    n == 7
                    and len(payload) == 7
                    and payload[0] == 0x08
                    and payload[1] == idx
                    and payload[2] == 0x07
                    and nxt == 0x1D
                ):
                    value = struct.unpack_from("<i", payload, 3)[0]
                    if value == 8:
                        return False
                    # Write int 8 into the decompressed tag body inside raw.
                    abs_int = body_start + i + 3 + 3  # skip push hdr + type8+idx+type7
                    struct.pack_into("<i", raw, abs_int, 8)
                    return True
                i += 3 + n
            elif op >= 0x80:
                n = struct.unpack_from("<H", body, i + 1)[0]
                i += 3 + n
            elif op == 0:
                break
            else:
                i += 1
        return False
    return False


def main():
    changed = 0
    for path in sorted((ROOT / "kana").rglob("*.swf")):
        if "before" in path.parts:
            continue
        source = path.read_bytes()
        if source[:3] != b"CWS" or b"penSize" not in zlib.decompress(source[8:]):
            continue
        raw = bytearray(zlib.decompress(source[8:]))
        if not set_default_pensize(raw):
            continue
        path.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
        print(path.relative_to(ROOT).as_posix(), "default -> 3pt (8)")
        changed += 1
    print("patched", changed)


if __name__ == "__main__":
    main()

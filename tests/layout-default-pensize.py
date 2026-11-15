"""Set the writing-board default stroke to the former 3pt thickness (penSize=8)."""
import pathlib
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[1]

# First init: ActionPush penSize + int 5, ActionSetVariable, ActionPush...
# penSize2's onPress also assigns 5, but is followed by SetMember (4f), not Push (96).
OLD = bytes.fromhex("960700080e07050000001d96")
NEW = bytes.fromhex("960700080e07080000001d96")


def main():
    changed = 0
    for path in sorted((ROOT / "kana").rglob("*.swf")):
        if "before" in path.parts:
            continue
        source = path.read_bytes()
        if source[:3] != b"CWS":
            continue
        raw = bytearray(zlib.decompress(source[8:]))
        count = raw.count(OLD)
        if count == 0:
            continue
        if count != 1:
            print("unexpected", path.relative_to(ROOT).as_posix(), "hits", count)
            continue
        raw = raw.replace(OLD, NEW, 1)
        path.write_bytes(source[:8] + zlib.compress(bytes(raw), 9))
        print(path.relative_to(ROOT).as_posix(), "default penSize 5 -> 8 (3pt)")
        changed += 1
    print("patched", changed)


if __name__ == "__main__":
    main()

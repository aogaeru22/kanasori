import pathlib
import struct
import zlib

NAMES = {
    0: "End",
    11: "DefineText",
    12: "DoAction",
    26: "PlaceObject2",
    33: "DefineText2",
    34: "DefineButton2",
    37: "DefineEditText",
    39: "DefineSprite",
    48: "DefineFont2",
    70: "PlaceObject3",
    75: "DefineFont3",
    76: "SymbolClass",
    82: "DoABC",
    87: "DefineBinaryData",
}


def read_rect_end(data):
    nbits = data[0] >> 3
    total_bits = 5 + nbits * 4
    return (total_bits + 7) // 8


def dump_range(raw, start, length):
    chunk = raw[start : start + length]
    print(start, chunk.hex())


def main():
    path = pathlib.Path("kana/01_hiragana/a_ka_sa/03-02.swf")
    data = path.read_bytes()
    raw = zlib.decompress(data[8:])
    pos = read_rect_end(raw) + 4
    target = raw.find("123pt".encode("utf-16le"))
    print("target", target, "tags start", pos, "len", len(raw))
    count = 0
    while pos < len(raw) - 2:
        code_len = struct.unpack_from("<H", raw, pos)[0]
        code = code_len >> 6
        length = code_len & 0x3F
        hdr = 2
        if length == 0x3F:
            length = struct.unpack_from("<I", raw, pos + 2)[0]
            hdr = 6
        start = pos
        end = pos + hdr + length
        if start <= target < end or code in (11, 33, 37):
            name = NAMES.get(code, "?")
            hit = start <= target < end
            if hit or code in (11, 33, 37):
                print(f"tag {code} {name} off {start} len {length} hit={hit}")
        if code == 0:
            break
        pos = end
        count += 1
        if count > 50000:
            print("too many")
            break
    print("done", count, "pos", pos)


if __name__ == "__main__":
    main()

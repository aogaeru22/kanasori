import pathlib
import struct
import zlib


def read_rect_end(data):
    nbits = data[0] >> 3
    total_bits = 5 + nbits * 4
    return (total_bits + 7) // 8


def iter_tags(raw):
    pos = read_rect_end(raw) + 4
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
        yield code, start, end, raw[start + hdr : end]
        if code == 0:
            break
        pos = end


def main():
    path = pathlib.Path("kana/01_hiragana/a_ka_sa/03-02.swf")
    raw = zlib.decompress(path.read_bytes()[8:])
    focus = range(71500, 74000)
    for code, start, end, body in iter_tags(raw):
        if start < 71000 or start > 78000:
            continue
        cid = struct.unpack_from("<H", body, 0)[0] if len(body) >= 2 else None
        print(f"code={code:3} start={start:6} body={len(body):4} id={cid} hex={body[:48].hex()}")


if __name__ == "__main__":
    main()

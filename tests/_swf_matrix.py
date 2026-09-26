import pathlib
import struct
import zlib


class Bits:
    def __init__(self, data, bit=0):
        self.data = data
        self.bit = bit

    def get(self, n):
        val = 0
        for _ in range(n):
            byte_i = self.bit // 8
            bit_i = 7 - (self.bit % 8)
            val = (val << 1) | ((self.data[byte_i] >> bit_i) & 1)
            self.bit += 1
        return val

    def get_signed(self, n):
        val = self.get(n)
        if n and val & (1 << (n - 1)):
            val -= 1 << n
        return val


def read_matrix(data):
    bits = Bits(data)
    has_scale = bits.get(1)
    scale = None
    if has_scale:
        n = bits.get(5)
        scale = (bits.get_signed(n), bits.get_signed(n), n)
    has_rotate = bits.get(1)
    rotate = None
    if has_rotate:
        n = bits.get(5)
        rotate = (bits.get_signed(n), bits.get_signed(n), n)
    n = bits.get(5)
    translate = (bits.get_signed(n), bits.get_signed(n), n)
    return {
        "bytes": (bits.bit + 7) // 8,
        "scale": scale,
        "rotate": rotate,
        "translate": translate,
    }


def read_rect_end(data):
    nbits = data[0] >> 3
    return (5 + nbits * 4 + 7) // 8


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
        end = pos + hdr + length
        yield code, pos, raw[pos + hdr : end]
        if code == 0:
            break
        pos = end


def places(raw):
    found = []
    for code, start, body in iter_tags(raw):
        if code != 26 or len(body) < 8:
            continue
        if b"penSize" not in body:
            continue
        flags = body[0]
        name_at = body.find(b"penSize")
        matrix = read_matrix(body[5:])
        found.append((body[name_at:name_at + 9], matrix, start, body.hex()))
    return found


def load_body(path):
    data = path.read_bytes()
    if data[:3] != b"CWS":
        return None
    return zlib.decompress(data[8:])


def main():
    root = pathlib.Path("kana")
    for path in root.rglob("*.swf"):
        raw = load_body(path)
        if raw is None or b"penSize1" not in raw:
            continue
        rows = places(raw)
        summary = " ".join(
            f"{name.decode().strip(chr(0))}={matrix['translate'][0]}"
            for name, matrix, start, _hex in rows
        )
        print(path.as_posix(), summary)


if __name__ == "__main__":
    main()

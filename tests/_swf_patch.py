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

    def set(self, n, value):
        if value < 0:
            value += 1 << n
        for i in range(n - 1, -1, -1):
            bit = (value >> i) & 1
            byte_i = self.bit // 8
            bit_i = 7 - (self.bit % 8)
            mask = 1 << bit_i
            if bit:
                self.data[byte_i] |= mask
            else:
                self.data[byte_i] &= ~mask
            self.bit += 1


def translate_x_location(data, offset):
    bits = Bits(data, (offset + 5) * 8)
    if bits.get(1):
        n = bits.get(5)
        bits.get_signed(n)
        bits.get_signed(n)
    if bits.get(1):
        n = bits.get(5)
        bits.get_signed(n)
        bits.get_signed(n)
    nbits = bits.get(5)
    return bits.bit, nbits


def read_translate(data, offset):
    bit, nbits = translate_x_location(data, offset)
    bits = Bits(data, bit)
    x = bits.get_signed(nbits)
    y = bits.get_signed(nbits)
    return x, y, nbits


def write_translate_x(data, offset, new_x):
    bit, nbits = translate_x_location(data, offset)
    limit = 1 << (nbits - 1)
    if not -limit <= new_x <= limit - 1:
        raise ValueError(f"translate {new_x} does not fit in {nbits} bits")
    Bits(data, bit).set(nbits, new_x)


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
        yield code, pos + hdr, end
        if code == 0:
            break
        pos = end


def patch(raw):
    buttons = {}
    for code, start, end in iter_tags(raw):
        if code != 26:
            continue
        body = raw[start:end]
        if body[:1] != b"\x26" or b"penSize" not in body:
            continue
        name = body[body.find(b"penSize"):].split(b"\x00", 1)[0].decode()
        buttons[name] = start
    if set(buttons) != {"penSize1", "penSize2", "penSize3"}:
        return False
    x1, _y1, n1 = read_translate(raw, buttons["penSize1"])
    x2, _y2, _n2 = read_translate(raw, buttons["penSize2"])
    x3, _y3, _n3 = read_translate(raw, buttons["penSize3"])
    if x1 < 0:
        return False
    shift = (x2 - x1) // 2
    write_translate_x(raw, buttons["penSize1"], -(1 << (n1 - 1)))
    write_translate_x(raw, buttons["penSize2"], x2 - shift)
    write_translate_x(raw, buttons["penSize3"], x3 - shift)
    return True


def main():
    changed = 0
    for root in (pathlib.Path("gana"), pathlib.Path("kana")):
        if not root.exists():
            continue
        for path in root.rglob("*.swf"):
            original = path.read_bytes()
            if original[:3] != b"CWS" or b"penSize1" not in zlib.decompress(original[8:]):
                continue
            raw = bytearray(zlib.decompress(original[8:]))
            if not patch(raw):
                print("skip", path)
                continue
            path.write_bytes(original[:8] + zlib.compress(bytes(raw), 9))
            changed += 1
    print("patched", changed)


if __name__ == "__main__":
    main()

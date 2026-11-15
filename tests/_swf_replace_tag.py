"""Replace a DefineShape body inside a CWS SWF, updating tag length."""
import pathlib
import struct
import zlib

from _swf_matrix import iter_tags, load_body, read_rect_end


def replace_define_shape(raw: bytearray, character_id: int, new_body: bytes, shape_code=32):
    """Replace DefineShape/2/3/4 body for character_id. new_body includes the UI16 id."""
    if struct.unpack_from("<H", new_body, 0)[0] != character_id:
        raise ValueError("new_body character id mismatch")
    for code, start, body in iter_tags(bytes(raw)):
        if code != shape_code or len(body) < 2:
            continue
        if struct.unpack_from("<H", body, 0)[0] != character_id:
            continue
        # start is tag header start in _swf_matrix.iter_tags
        code_len = struct.unpack_from("<H", raw, start)[0]
        length = code_len & 0x3F
        hdr = 2
        if length == 0x3F:
            length = struct.unpack_from("<I", raw, start + 2)[0]
            hdr = 6
        old_end = start + hdr + length
        if length != len(body):
            raise RuntimeError("length mismatch")
        new_len = len(new_body)
        if hdr == 6 or new_len >= 0x3F:
            new_header = struct.pack("<HI", (shape_code << 6) | 0x3F, new_len)
        else:
            new_header = struct.pack("<H", (shape_code << 6) | new_len)
        raw[start:old_end] = new_header + new_body
        return True
    return False


def extract_shape(path, character_id, shape_code=32):
    raw = load_body(pathlib.Path(path))
    for code, start, body in iter_tags(raw):
        if code == shape_code and struct.unpack_from("<H", body, 0)[0] == character_id:
            return body
    raise KeyError(character_id)

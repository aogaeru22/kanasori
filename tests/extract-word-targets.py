"""Extract the visible (up-state) word and circle from each SWF's first frame.

Nested sprite translations matter: later rows reposition the original buttons.
Never use the hit-state text, which contains stale words from the source template.
"""
import json
import pathlib
import re
import struct
import zlib
from _swf_matrix import Bits, iter_tags, read_matrix, read_rect_end

ROOT = pathlib.Path(__file__).resolve().parents[1]

def u16(b, p=0):
    return struct.unpack_from('<H', b, p)[0]

def frame(b):
    result = []
    for code, _, body in iter_tags(b):
        if code == 1:
            break
        if code == 26 and body[0] & 6 == 6:
            result.append((u16(body, 3), read_matrix(body[5:])))
    return result

def translate(m):
    assert m['scale'] is None and m['rotate'] is None
    return m['translate'][:2]

def edit_text(body):
    pos = 2 + read_rect_end(body[2:])
    bits = Bits(body[pos:])
    flags = [bits.get(1) for _ in range(16)]
    pos += 2
    has_text, has_color, has_max, has_font, has_class, has_layout = flags[0], flags[5], flags[6], flags[7], flags[8], flags[10]
    if has_font:
        pos += 2
    if has_class:
        pos = body.index(0, pos) + 1
    if has_font:
        pos += 2
    if has_color:
        pos += 4
    if has_max:
        pos += 2
    if has_layout:
        pos += 9
    pos = body.index(0, pos) + 1
    if not has_text:
        return ''
    end = body.index(0, pos)
    return re.sub(r'<[^>]+>', '', body[pos:end].decode('utf-8', 'replace'))

def extract(path):
    raw = zlib.decompress(path.read_bytes()[8:])
    tags = list(iter_tags(raw))
    definitions = {u16(b): (c, b) for c, _, b in tags if c in (2, 22, 32, 83, 11, 33, 34, 39)}
    fonts = {}
    for c, _, b in tags:
        if c not in (48, 75):
            continue
        flags = b[2]
        pos = 5 + b[4]
        count = u16(b, pos)
        pos += 2
        width = 4 if flags & 8 else 2
        offset = int.from_bytes(b[pos + count*width:pos + (count+1)*width], 'little')
        at = pos + offset
        width = 2 if flags & 4 else 1
        fonts[u16(b)] = [chr(int.from_bytes(b[at+i*width:at+(i+1)*width], 'little')) for i in range(count)]
    texts = {}
    for cid, (c, b) in definitions.items():
        if c not in (11, 33):
            continue
        pos = 2 + read_rect_end(b[2:])
        pos += read_matrix(b[pos:])['bytes']
        gb, ab = b[pos:pos+2]
        pos += 2
        word = ''
        font = None
        while b[pos]:
            flags = b[pos]
            pos += 1
            if flags & 8:
                font = u16(b, pos)
                pos += 2
            if flags & 4:
                pos += 4 if c == 33 else 3
            if flags & 1:
                pos += 2
            if flags & 2:
                pos += 2
            if flags & 8:
                pos += 2
            count = b[pos]
            pos += 1
            bits = Bits(b[pos:])
            for _ in range(count):
                word += fonts[font][bits.get(gb)]
                bits.get_signed(ab)
            pos += (bits.bit+7)//8
        texts[cid] = word
    if not any(code in (11, 33) for code, _, _ in tags):
        for code, _, body in tags:
            if code == 37:
                texts[u16(body)] = edit_text(body)

    words = []
    for cid, matrix in frame(raw):
        code, body = definitions.get(cid, (None, None))
        if code != 39:
            continue
        x, y = translate(matrix)
        for child, cm in frame(b'\0'*5 + body[4:]):
            code, button = definitions.get(child, (None, None))
            if code != 34:
                continue
            dx, dy = translate(cm)
            pos = 5
            word = ''
            circle = None
            while button[pos]:
                flags = button[pos]
                shape = u16(button, pos+1)
                pos += 5
                m = read_matrix(button[pos:])
                pos += m['bytes']
                bits = Bits(button[pos:])
                add, mul, n = bits.get(1), bits.get(1), bits.get(4)
                bits.get(n*4*(add+mul))
                pos += (bits.bit+7)//8
                if not flags & 1:
                    continue
                if shape in texts:
                    word += texts[shape]
                elif definitions.get(shape, (None,))[0] in (2, 22, 32, 83):
                    b = definitions[shape][1]
                    bits = Bits(b[2:])
                    n = bits.get(5)
                    xmin, xmax, ymin, ymax = [bits.get_signed(n) for _ in range(4)]
                    sx, sy = translate(m)
                    circle = [round((x+dx+sx+(xmin+xmax)/2)/20, 3), round((y+dy+sy+(ymin+ymax)/2)/20, 3), round((xmax-xmin)/40, 3), round((ymax-ymin)/40, 3)]
            if word and all('\u3040' <= ch <= '\u309f' for ch in word) and circle:
                words.append({'reading': word, 'x': circle[0], 'y': circle[1], 'radius': circle[2], **({'radiusY': circle[3]} if circle[3] != circle[2] else {})})
    assert len(words) == (3 if path.name.startswith(('ya', 'wa')) else 5), path
    return words

if __name__ == '__main__':
    data = {p.name.split('행')[0]: extract(p) for p in sorted((ROOT/'kana/voca_practice_hiragana').glob('*.swf'))}
    output = '// Generated by tests/extract-word-targets.py from SWF up-state text and geometry.\n'
    output += "import { WORD_READINGS } from './word-readings.js';\n"
    output += 'export const WORD_TARGETS = ' + json.dumps(data, ensure_ascii=False, indent=2) + ';\n'
    output += '''
export function wordTarget(rowId, index) {
  const word = WORD_TARGETS[rowId]?.[index];
  return word ? { ...word, id: `${rowId}-word-${index}`, ruby: WORD_READINGS[word.reading] || '' } : null;
}

'''
    (ROOT/'js/word-targets.js').write_text(output, encoding='utf-8')
    print(json.dumps(data, ensure_ascii=False))

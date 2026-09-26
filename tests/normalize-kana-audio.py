"""Normalize short kana pronunciations embedded in the ten lesson SWFs.

Run with Python + numpy and pass --ffmpeg PATH. Originals are retained in data/.
No recording or learner data is processed. --apply writes verified PCM sound tags.
"""
import argparse
import json
import pathlib
import struct
import subprocess
import zlib
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILES = [('a', 'a_ka_sa/03-02'), ('ka', 'a_ka_sa/03-04'),
         ('sa', 'a_ka_sa/03-08'), ('ta', 'ta_na_ha/03-02'),
         ('na', 'ta_na_ha/03-04'), ('ha', 'ta_na_ha/03-07'),
         ('ma', 'ma_ya_ra_wa/03-01'), ('ya', 'ma_ya_ra_wa/03-03'),
         ('ra', 'ma_ya_ra_wa/03-06'), ('wa', 'ma_ya_ra_wa/03-09')]

def unpack(data):
    raw = zlib.decompress(data[8:]) if data[:3] == b'CWS' else data[8:]
    pos = ((5 + 4 * (raw[0] >> 3) + 7) // 8) + 4
    prefix, tags = raw[:pos], []
    while pos < len(raw):
        value, = struct.unpack_from('<H', raw, pos)
        pos += 2
        code, size = value >> 6, value & 63
        if size == 63:
            size, = struct.unpack_from('<I', raw, pos)
            pos += 4
        tags.append((code, raw[pos:pos+size]))
        pos += size
    return prefix, tags

def level(pcm, rate):
    # Exclude silence using 20ms windows, relative to the loudest window.
    mono_power = np.mean(pcm.astype(np.float64)**2, axis=1)
    width = rate // 50
    energies = np.array([np.mean(mono_power[i:i+width]) for i in range(0, len(pcm), width)])
    active = energies[energies > energies.max() * .01]
    return float(np.sqrt(np.mean(active)))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    clips, movies = [], []
    for row, stem in FILES:
        path = ROOT / 'kana/01_hiragana' / (stem + '.swf')
        backup = ROOT / 'data/audio-originals' / (stem + '.swf')
        original = (backup if backup.exists() else path).read_bytes()
        prefix, tags = unpack(original)
        movies.append((path, backup, original, prefix, tags))
        for index, (code, body) in enumerate(tags):
            if code != 14:
                continue
            flags = body[2]
            count, = struct.unpack_from('<I', body, 3)
            rate = [5512, 11025, 22050, 44100][(flags >> 2) & 3]
            # Only isolated kana syllables (not clicks, explanations or row narration).
            if flags >> 4 != 2 or rate != 44100 or not .3 < count/rate < 1.1:
                continue
            channels = 1 + (flags & 1)
            result = subprocess.run([args.ffmpeg, '-v', 'error', '-f', 'mp3', '-i',
                'pipe:0', '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'],
                input=body[9:], capture_output=True, check=True)
            pcm = np.frombuffer(result.stdout, dtype='<f4').reshape(-1, channels)
            seek, = struct.unpack_from('<h', body, 7)
            pcm = pcm[max(0, seek):]
            if seek < 0:
                pcm = np.pad(pcm, ((-seek, 0), (0, 0)))
            pcm = np.pad(pcm, ((0, max(0, count-len(pcm))), (0, 0)))[:count]
            clips.append(dict(row=row, movie=len(movies)-1, index=index, pcm=pcm,
                              rms=level(pcm, rate), peak=float(np.max(np.abs(pcm)))))
    assert len(clips) == 48, f'Unexpected pronunciation count: {len(clips)}'
    baseline = float(np.median([c['rms'] for c in clips if c['row'] in ('a', 'ka', 'sa')]))
    # Shared target limited by the highest crest factor: no clipping or compression.
    target = min(baseline, min(.95*c['rms']/c['peak'] for c in clips))
    report = {'baseline_db':20*np.log10(baseline), 'target_db':20*np.log10(target), 'clips':[]}
    for clip in clips:
        gain = target / clip['rms']
        pcm = np.round(clip['pcm'] * gain * 32767).astype('<i2')
        path, backup, original, prefix, tags = movies[clip['movie']]
        code, body = tags[clip['index']]
        replacement = body[:2] + bytes([(body[2] & 15) | 0x30]) + body[3:7] + pcm.tobytes()
        tags[clip['index']] = (code, replacement)
        report['clips'].append({'row':clip['row'], 'sound_id':int.from_bytes(body[:2], 'little'),
            'before_db':round(20*np.log10(clip['rms']),2), 'gain_db':round(20*np.log10(gain),2),
            'after_db':round(20*np.log10(level(pcm/32768,44100)),2),
            'peak':float(np.max(np.abs(pcm.astype(np.int32))))/32768})
    if args.apply:
        for path, backup, original, prefix, tags in movies:
            backup.parent.mkdir(parents=True, exist_ok=True)
            if not backup.exists():
                backup.write_bytes(original)
            raw = prefix + b''.join(struct.pack('<HI', (code<<6)|63, len(body))+body for code,body in tags)
            output = b'CWS' + original[3:4] + struct.pack('<I', len(raw)+8) + zlib.compress(raw,9)
            assert unpack(output) == (prefix, tags)
            path.write_bytes(output)
        (ROOT/'data/audio-normalization.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()

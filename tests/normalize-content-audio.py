"""Normalize all audio in the 20 active kana/word lessons and score feedback.
Backs up current assets (including layout edits), verifies non-audio SWF tags,
and retains sample rates, channels, event sample counts and movie frame counts.
Run without --apply to measure. Requires numpy and --ffmpeg.
"""
import argparse, importlib.util, json, pathlib, struct, subprocess, wave, zlib
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('kana',ROOT/'tests/normalize-kana-audio.py')
kana=importlib.util.module_from_spec(spec);spec.loader.exec_module(kana)
BACKUP=ROOT/'data/content-audio-originals'

def decode(data, ffmpeg, channels, rate, fmt='mp3'):
    out=subprocess.run([ffmpeg,'-v','error','-f',fmt,'-i','pipe:0','-ar',str(rate),'-ac',str(channels),'-f','f32le','pipe:1'],input=data,capture_output=True,check=True)
    return np.frombuffer(out.stdout,dtype='<f4').reshape(-1,channels).copy()

def fit(pcm,count,seek=0):
    pcm=pcm[seek:] if seek>=0 else np.pad(pcm,((-seek,0),(0,0)))
    return np.pad(pcm,((0,max(0,count-len(pcm))),(0,0)))[:count]

def stats(pcm,rate):
    if not np.any(pcm): return 0.0,0.0
    rms=kana.level(pcm,rate)
    return rms,float(np.abs(pcm).max())

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--ffmpeg',required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    paths=[ROOT/'kana/01_hiragana'/(stem+'.swf') for _,stem in kana.FILES]+sorted((ROOT/'kana/voca_practice_hiragana').glob('*.swf'))+sorted((ROOT/'audio/feedback').glob('*.wav'))
    assets=[];clips=[]
    def add(pcm,rate,label,apply,quiet=False):
        if len(pcm)==0:return
        rms,peak=stats(pcm,rate)
        if rms<1e-7:return
        clips.append(dict(pcm=pcm,rate=rate,label=label,apply=apply,quiet=quiet,rms=rms,peak=peak))
    for path in paths:
        relative=path.relative_to(ROOT);backup=BACKUP/relative
        original=(backup if backup.exists() else path).read_bytes()
        asset=dict(path=path,backup=backup,original=original);assets.append(asset)
        if path.suffix=='.wav':
            import io
            with wave.open(io.BytesIO(original),'rb') as w:
                channels,rate,count=w.getnchannels(),w.getframerate(),w.getnframes()
            pcm=decode(original,args.ffmpeg,channels,rate,'wav')
            asset.update(rate=rate,channels=channels,count=count)
            add(pcm,rate,str(relative),lambda value,a=asset:a.update(pcm=value))
            continue
        prefix,tags=kana.unpack(original);asset.update(prefix=prefix,tags=tags,before=list(tags))
        for i,(code,body) in enumerate(tags):
            if code!=14:continue
            flags=body[2];rate=[5512,11025,22050,44100][(flags>>2)&3];channels=1+(flags&1);count=int.from_bytes(body[3:7],'little');codec=flags>>4
            if codec==2:
                pcm=fit(decode(body[9:],args.ffmpeg,channels,rate),count,struct.unpack_from('<h',body,7)[0])
            elif codec==3:
                dtype='<i2' if flags&2 else 'u1';pcm=np.frombuffer(body[7:],dtype=dtype).reshape(-1,channels).astype(float)
                pcm=pcm/32768 if flags&2 else (pcm-128)/128
                assert len(pcm)==count
            else:raise ValueError(f'Unsupported event codec {codec}: {relative}')
            def apply(value,tags=tags,i=i,body=body):
                tags[i]=(14,body[:2]+bytes([0x30|(body[2]&15)|2])+body[3:7]+value.tobytes())
            add(pcm,rate,f'{relative}#{int.from_bytes(body[:2],"little")}',apply,quiet=count/rate<.2)
        # Decode each continuous stream once, retaining the original frame positions.
        heads=[i for i,(c,b) in enumerate(tags) if c in (18,45)]
        for hidx,h in enumerate(heads):
            end=heads[hidx+1] if hidx+1<len(heads) else len(tags)
            indices=[i for i in range(h+1,end) if tags[i][0]==19]
            if not indices:continue
            header=tags[h][1];flags=header[1];assert flags>>4==2
            rate=[5512,11025,22050,44100][(flags>>2)&3];channels=1+(flags&1)
            per_frame=int.from_bytes(header[2:4],'little')
            seek=struct.unpack_from('<h',tags[indices[0]][1],2)[0]
            pcm=decode(b''.join(tags[i][1][4:] for i in indices),args.ffmpeg,channels,rate)
            pcm=fit(pcm,len(indices)*per_frame,seek)
            def apply_stream(value,tags=tags,h=h,header=header,indices=indices,per_frame=per_frame,flags=flags):
                tags[h]=(tags[h][0],header[:1]+bytes([0x30|(flags&15)|2])+header[2:4])
                for n,i in enumerate(indices):tags[i]=(19,value[n*per_frame:(n+1)*per_frame].tobytes())
            add(pcm,rate,f'{relative}#stream-{h}',apply_stream)
    speech=[c for c in clips if not c['quiet']]
    # Use a common, conservative gain target; leave >= 3 dB sample peak headroom.
    target=min(10**(-20/20),min(10**(-3/20)*c['rms']/c['peak'] for c in speech))
    report=dict(target_active_rms_db=20*np.log10(target),assets=len(assets),speech_clips=len(speech),effects=len(clips)-len(speech),clips=[])
    for c in clips:
        gain=min(1,target/c['rms'],.15/c['peak']) if c['quiet'] else target/c['rms']
        pcm=np.round(c['pcm']*gain*32767).astype('<i2');rms,peak=stats(pcm/32768,c['rate'])
        assert peak<.709
        if not c['quiet']:assert abs(20*np.log10(rms/target))<.02
        c['apply'](pcm)
        report['clips'].append(dict(asset=c['label'],kind='effect' if c['quiet'] else 'speech',before_db=round(20*np.log10(c['rms']),3),after_db=round(20*np.log10(rms),3),peak_db=round(20*np.log10(peak),3),samples=len(pcm)))
    if args.apply:
        import io
        for a in assets:
            if 'tags' in a:
                tags=a['tags'];assert len(tags)==len(a['before'])
                for old,new in zip(a['before'],tags):
                    assert old[0]==new[0]
                    if old[0] not in (14,18,19,45):assert old==new
                    if old[0]==14:assert old[1][:2]==new[1][:2] and old[1][3:7]==new[1][3:7]
                raw=a['prefix']+b''.join(struct.pack('<HI',(c<<6)|63,len(b))+b for c,b in tags)
                output=b'CWS'+a['original'][3:4]+struct.pack('<I',len(raw)+8)+zlib.compress(raw,9)
                assert kana.unpack(output)==(a['prefix'],tags)
            else:
                buffer=io.BytesIO()
                with wave.open(buffer,'wb') as w:
                    w.setnchannels(a['channels']);w.setframerate(a['rate']);w.setsampwidth(2);w.writeframes(a['pcm'].tobytes())
                output=buffer.getvalue();assert len(a['pcm'])==a['count']
            a['backup'].parent.mkdir(parents=True,exist_ok=True)
            if not a['backup'].exists():a['backup'].write_bytes(a['original'])
            a['path'].write_bytes(output)
        (ROOT/'data/content-audio-normalization.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in report.items() if k!='clips'},indent=2))
    print('Before speech range:',min(c['before_db'] for c in report['clips'] if c['kind']=='speech'),max(c['before_db'] for c in report['clips'] if c['kind']=='speech'))
    print('After speech range:',min(c['after_db'] for c in report['clips'] if c['kind']=='speech'),max(c['after_db'] for c in report['clips'] if c['kind']=='speech'))
if __name__=='__main__':main()

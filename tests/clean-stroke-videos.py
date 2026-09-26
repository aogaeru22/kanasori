"""Clean compression speckles in the 15 legacy stroke videos; keep timing and all other tags."""
import pathlib,struct,subprocess,zlib,importlib.util,json
import numpy as np
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('n',ROOT/'tests/normalize-kana-audio.py');n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n)
FF=str(ROOT/'data/audio-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe')
OUT=ROOT/'data/stroke-cleanup';OUT.mkdir(exist_ok=True)
def flv(frames):
 result=b'FLV\x01\x01\0\0\0\x09'+b'\0'*4
 for i,f in enumerate(frames):
  payload=b'\x12'+f;ts=round(i*1000/15);tag=b'\x09'+len(payload).to_bytes(3,'big')+(ts&0xffffff).to_bytes(3,'big')+bytes([ts>>24])+b'\0'*3+payload
  result+=tag+len(tag).to_bytes(4,'big')
 return result

def clean(frame):
 # Preserve dark stroke pixels; remove the pale ringing/ghost edges of H.263.
 mask=frame<150;h,w=mask.shape;seen=np.zeros_like(mask)
 for y,x in zip(*np.nonzero(mask)):
  if seen[y,x]:continue
  stack=[(y,x)];seen[y,x]=True;component=[]
  while stack:
   yy,xx=stack.pop();component.append((yy,xx))
   for dy in (-1,0,1):
    for dx in (-1,0,1):
     ny,nx=yy+dy,xx+dx
     if 0<=ny<h and 0<=nx<w and mask[ny,nx] and not seen[ny,nx]:seen[ny,nx]=True;stack.append((ny,nx))
  if len(component)<=3:
   for yy,xx in component:mask[yy,xx]=False
 # Retain anti-aliasing only immediately beside real strokes.
 padded=np.pad(mask,1);near=np.zeros_like(mask)
 for dy in range(3):
  for dx in range(3):near|=padded[dy:dy+h,dx:dx+w]
 return np.where(near & (frame<230),frame,255).astype('uint8')

def packets(raw):
 pos=int.from_bytes(raw[5:9],'big')+4;result=[]
 while pos<len(raw):
  kind=raw[pos];size=int.from_bytes(raw[pos+1:pos+4],'big');body=raw[pos+11:pos+11+size]
  if kind==9 and body[0]&15==2:result.append(body[1:])
  pos+=11+size+4
 return result

def main():
 report=[];samples=[]
 for row,stem in n.FILES[:3]:
  path=ROOT/'kana/01_hiragana'/(stem+'.swf');original=path.read_bytes();prefix,tags=n.unpack(original);before=list(tags)
  source=ROOT/'data/stroke-cleanup-originals'/path.relative_to(ROOT)
  if source.exists():
   _,source_tags=n.unpack(source.read_bytes())
   source_frames={(int.from_bytes(b[:2],'little'),int.from_bytes(b[2:4],'little')):b for c,b in source_tags if c==61}
   tags=[(c,source_frames[(int.from_bytes(b[:2],'little'),int.from_bytes(b[2:4],'little'))]) if c==61 else (c,b) for c,b in tags]
  for code,header in before:
   if code!=60:continue
   sid,count,w,h=struct.unpack_from('<4H',header);assert header[9]==2
   indices=[i for i,(c,b) in enumerate(tags) if c==61 and int.from_bytes(b[:2],'little')==sid]
   frames=[tags[i][1][4:] for i in indices]
   decoded=subprocess.run([FF,'-v','error','-i','pipe:0','-f','rawvideo','-pix_fmt','gray','pipe:1'],input=flv(frames),capture_output=True,check=True).stdout
   pixels=np.frombuffer(decoded,dtype='uint8').reshape(-1,h,w);assert len(pixels)==len(frames)
   cleaned=np.stack([clean(frame) for frame in pixels])
   # A faint endpoint from the preceding full glyph persists during these
   # partial-stroke frames. Clear only its small, verified region; retain the
   # endpoint once the real final stroke reaches it.
   residue = (10,49,54,68,88,104) if row=='a' and sid==148 else (8,46,34,47,92,104) if row=='sa' and sid==138 else None
   if residue:
    first,last,x0,x1,y0,y1=residue
    cleaned[first:last,y0:y1,x0:x1]=255
   encoded=subprocess.run([FF,'-v','error','-f','rawvideo','-pix_fmt','gray','-s',f'{w}x{h}','-r','15','-i','pipe:0','-an','-c:v','flv','-q:v','1','-g','1','-f','flv','pipe:1'],input=cleaned.tobytes(),capture_output=True,check=True).stdout
   replacement=packets(encoded);assert len(replacement)==len(indices)
   for i,frame in zip(indices,replacement):tags[i]=(61,tags[i][1][:4]+frame)
   roundtrip=subprocess.run([FF,'-v','error','-i','pipe:0','-f','rawvideo','-pix_fmt','gray','pipe:1'],input=flv(replacement),capture_output=True,check=True).stdout
   verified=np.frombuffer(roundtrip,dtype='uint8').reshape(-1,h,w);assert verified.shape==pixels.shape
   if residue:
    first,last,x0,x1,y0,y1=residue
    minimum = 255 if row=='a' and sid==148 else 245
    assert np.min(verified[first:last,y0:y1,x0:x1]) >= minimum, 'Residue remains in decoded frames'
   # Every dark decoded pixel must remain adjacent to a retained stroke pixel.
   for mask,result in zip(cleaned<128,verified):
    padded=np.pad(mask,1);near=np.zeros_like(mask)
    for dy in range(3):
     for dx in range(3):near|=padded[dy:dy+h,dx:dx+w]
    assert not np.any((result<128)&~near)
   record=dict(row=row,id=sid,frames=len(frames),width=w,height=h);report.append(record)
   samples.append((pixels[-1],verified[-1],f'{row}-{sid}'))
  backup=ROOT/'data/stroke-cleanup-originals'/path.relative_to(ROOT);backup.parent.mkdir(parents=True,exist_ok=True)
  if not backup.exists():backup.write_bytes(original)
  for old,new in zip(before,tags):
   if old[0]!=61:assert old==new
  raw=prefix+b''.join(struct.pack('<HI',(c<<6)|63,len(b))+b for c,b in tags)
  output=b'CWS'+original[3:4]+struct.pack('<I',len(raw)+8)+zlib.compress(raw,9);assert n.unpack(output)==(prefix,tags);path.write_bytes(output)
 canvas=Image.new('RGB',(15*160,340),'white')
 for i,(old,new,label) in enumerate(samples):
  canvas.paste(Image.fromarray(old).resize((150,150)),(i*160,10));canvas.paste(Image.fromarray(new).resize((150,150)),(i*160,180))
 canvas.save(OUT/'comparison.png');(OUT/'report.json').write_text(json.dumps(report,indent=2));print('Cleaned',len(report),'videos;',sum(r['frames'] for r in report),'frames. Audio, fonts, animation timing and other tags preserved.')
if __name__=='__main__':main()

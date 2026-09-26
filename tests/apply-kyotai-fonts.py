"""Use supplied Kyotai fonts in web text and embedded kana glyphs of active SWFs."""
import sys,pathlib,struct,zlib,importlib.util
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'data/font-tools'))
from fontTools.ttLib import TTCollection
from fontTools.pens.basePen import BasePen
spec=importlib.util.spec_from_file_location('kana',ROOT/'tests/normalize-kana-audio.py');kana=importlib.util.module_from_spec(spec);spec.loader.exec_module(kana)
class Bits:
 def __init__(self):self.bits=[]
 def put(self,v,n):self.bits.extend((v>>i)&1 for i in range(n-1,-1,-1))
 def signed(self,v,n):self.put(v&((1<<n)-1),n)
 def bytes(self):
  self.bits.extend([0]*((-len(self.bits))%8));return bytes(sum(self.bits[i+j]<<(7-j) for j in range(8)) for i in range(0,len(self.bits),8))
def width(*values):return max(2,max(abs(v).bit_length()+1 for v in values))
class ShapePen(BasePen):
 def __init__(self,glyphs,scale):
  super().__init__(glyphs);self.scale=scale;self.b=Bits();self.b.put(1,4);self.b.put(0,4);self.point=(0,0);self.start=(0,0)
 def xy(self,p):return round(p[0]*self.scale),round(-p[1]*self.scale)
 def _moveTo(self,p):
  x,y=self.xy(p);self.b.put(0,1);self.b.put(3,5);n=width(x,y);self.b.put(n,5);self.b.signed(x,n);self.b.signed(y,n);self.b.put(1,1);self.point=self.start=(x,y)
 def line(self,p):
  dx,dy=p[0]-self.point[0],p[1]-self.point[1]
  if not(dx or dy):return
  n=width(dx,dy);assert n<=17
  self.b.put(1,1);self.b.put(1,1);self.b.put(n-2,4);self.b.put(1,1);self.b.signed(dx,n);self.b.signed(dy,n);self.point=p
 def _lineTo(self,p):self.line(self.xy(p))
 def _qCurveToOne(self,p1,p2):
  control,end=self.xy(p1),self.xy(p2);ds=(control[0]-self.point[0],control[1]-self.point[1],end[0]-control[0],end[1]-control[1]);n=width(*ds);assert n<=17
  self.b.put(1,1);self.b.put(0,1);self.b.put(n-2,4)
  for v in ds:self.b.signed(v,n)
  self.point=end
 def _closePath(self):self.line(self.start)
 def _endPath(self):pass
 def result(self):self.b.put(0,6);return self.b.bytes()
def main():
 fonts={}
 (ROOT/'fonts').mkdir(exist_ok=True)
 for weight in (2,3,4):
  font=TTCollection(f'E:/DATA/교과서체/일본어쓰기 폰트/NTk{weight}kp.ttc').fonts[0]
  fonts[weight]=font;font.flavor='woff2';font.save(ROOT/f'fonts/kyotai-w{weight}.woff2')
 font=fonts[3];glyphs=font.getGlyphSet();cmap=font.getBestCmap();changed=0
 paths=[ROOT/'kana/01_hiragana'/(stem+'.swf') for _,stem in kana.FILES]+list((ROOT/'kana/voca_practice_hiragana').glob('*.swf'))
 for path in paths:
  original=path.read_bytes();prefix,tags=kana.unpack(original);before=list(tags)
  for i,(code,b) in enumerate(tags):
   if code not in (48,75):continue
   flags=b[2];pos=5+b[4];count=int.from_bytes(b[pos:pos+2],'little');pos+=2;ow=4 if flags&8 else 2;cw=2 if flags&4 else 1
   offsets=[int.from_bytes(b[pos+j*ow:pos+(j+1)*ow],'little') for j in range(count+1)]
   table=pos+offsets[-1];codes=[int.from_bytes(b[table+j*cw:table+(j+1)*cw],'little') for j in range(count)];shapes=[]
   for j,cp in enumerate(codes):
    shape=b[pos+offsets[j]:pos+offsets[j+1]]
    if 0x3041<=cp<=0x30ff and cp in cmap:
     pen=ShapePen(glyphs,(20480 if code==75 else 1024)/font['head'].unitsPerEm);glyphs[cmap[cp]].draw(pen);shape=pen.result();changed+=1
    shapes.append(shape)
   offsets=[];offset=(count+1)*4
   for shape in shapes:offsets.append(offset);offset+=len(shape)
   offsets.append(offset)
   header=b[:2]+bytes([flags|8])+b[3:pos]
   tags[i]=(code,header+b''.join(struct.pack('<I',o) for o in offsets)+b''.join(shapes)+b[table:])
  backup=ROOT/'data/font-originals'/path.relative_to(ROOT);backup.parent.mkdir(parents=True,exist_ok=True)
  if not backup.exists():backup.write_bytes(original)
  for old,new in zip(before,tags):
   if old[0] not in (48,75):assert old==new
  raw=prefix+b''.join(struct.pack('<HI',(c<<6)|63,len(b))+b for c,b in tags)
  output=b'CWS'+original[3:4]+struct.pack('<I',len(raw)+8)+zlib.compress(raw,9)
  assert kana.unpack(output)==(prefix,tags);path.write_bytes(output)
 print(f'Converted 3 webfonts; replaced {changed} kana glyphs across {len(paths)} SWFs; other tags preserved.')
if __name__=='__main__':main()

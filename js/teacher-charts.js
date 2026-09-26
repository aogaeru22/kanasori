const NS = 'http://www.w3.org/2000/svg';
const BLUE = '#FFD700', RED = '#FF6B6B', GRAY = '#bac8ac';
export const number = value => value === null ? '—' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(value);
export const change = value => value === null ? '비교 전' : value > 0 ? `▲ ${number(value)}` : value < 0 ? `▼ ${number(-value)}` : '—';
export function svgNode(tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [key,value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
function canvas(container, label, width = 900, height = 290) {
  container.replaceChildren();
  const svg = svgNode('svg', { viewBox:`0 0 ${width} ${height}`, role:'img', 'aria-label':label });
  container.append(svg); return svg;
}
function empty(container, message = '표시할 평가 결과가 없습니다.') {
  container.replaceChildren(); const p = document.createElement('p'); p.className = 'chart-empty'; p.textContent = message; container.append(p);
}
function tip(node, text) {
  node.setAttribute('tabindex', '0'); node.setAttribute('aria-label', text); node.setAttribute('data-tip', text);
  node.append(svgNode('title', {}, text));
}
function grid(svg, width, threshold, height = 230) {
  for (const value of [0,50,100]) {
    const y = height - value / 100 * (height - 20);
    svg.append(svgNode('line', {x1:42,x2:width-16,y1:y,y2:y,stroke:'#f5f5dc30'}));
    svg.append(svgNode('text', {x:34,y:y+4,'text-anchor':'end',fill:'#78828b','font-size':14},value));
  }
  const y = height - threshold / 100 * (height - 20);
  svg.append(svgNode('line', {x1:42,x2:width-16,y1:y,y2:y,stroke:'#f5f5dc70','stroke-dasharray':'4 4'}));
  svg.append(svgNode('text', {x:width-18,y:y-7,'text-anchor':'end',fill:'#727b84','font-size':14},`통과 기준 ${threshold}`));
}
export function classChart(container, classes, threshold, label) {
  const values = classes.filter(group => group.average !== null);
  if (!values.length) return empty(container);
  const width = Math.max(900, values.length * 105);
  const svg = canvas(container,'반별 평균 점수',width,280); grid(svg,width,threshold);
  const step = (width - 80) / values.length;
  values.forEach((group,index) => {
    const x = 50 + index * step + step / 2, y = 230 - group.average / 100 * 210;
    const bar = svgNode('rect', {x:x-Math.min(36,step*.32),y,width:Math.min(72,step*.64),height:230-y,rx:5,fill:BLUE});
    tip(bar,`${label(group.classId)} · 평균 ${number(group.average)}점 · ${group.count}명`); svg.append(bar);
    svg.append(svgNode('text',{x,y:y-8,'text-anchor':'middle','font-size':16,'font-weight':600},number(group.average)));
    svg.append(svgNode('text',{x,y:254,'text-anchor':'middle','font-size':14,fill:'#59636d'},label(group.classId)));
  });
}
export function growthChart(container, students, threshold, onStudent) {
  const comparable = students.filter(student => student.delta !== null);
  if (!comparable.length) return empty(container,'2회 이상 평가받은 학생이 생기면 성장 그래프가 표시됩니다.');
  const svg = canvas(container,'학생별 첫 시도와 최근 시도 점수',440,290); grid(svg,440,threshold);
  svg.append(svgNode('text',{x:83,y:256,'text-anchor':'middle','font-size':15,fill:'#727b84'},'첫 시도'));
  svg.append(svgNode('text',{x:365,y:256,'text-anchor':'middle','font-size':15,fill:'#727b84'},'최근 시도'));
  for (const student of comparable) {
    const color = student.delta > 0 ? BLUE : student.delta < 0 ? RED : GRAY;
    const y1 = 230 - student.first * 2.1, y2 = 230 - student.last * 2.1;
    const group = svgNode('g',{'class':'growth-line',role:'button'});
    tip(group,`${student.name} (${student.classId} · ${student.number}) · ${student.first} → ${student.last}점 · ${change(student.delta)} · 상세 보기`);
    group.append(svgNode('line',{x1:83,x2:365,y1,y2,stroke:color,'stroke-width':2,opacity:.7}));
    group.append(svgNode('circle',{cx:83,cy:y1,r:4.5,fill:color,stroke:'white','stroke-width':2}));
    group.append(svgNode('circle',{cx:365,cy:y2,r:4.5,fill:color,stroke:'white','stroke-width':2}));
    group.onclick = () => onStudent(student);
    group.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onStudent(student); } };
    svg.append(group);
  }
}
export function distributionChart(container, bins, threshold) {
  if (!bins.some(bin => bin.count)) return empty(container);
  const svg = canvas(container,'모든 시도의 10점 구간별 점수 분포',440,290);
  const max = Math.max(...bins.map(bin => bin.count),1), step = 37;
  svg.append(svgNode('line',{x1:42,x2:418,y1:230,y2:230,stroke:'#f5f5dc30'}));
  bins.forEach((bin,index) => {
    const height = bin.count / max * 190, x = 45 + index * step;
    const bar = svgNode('rect',{x,y:230-height,width:32,height,fill:BLUE,rx:4}); tip(bar,`${bin.label}점 · ${bin.count}회`); svg.append(bar);
    if (bin.count) svg.append(svgNode('text',{x:x+16,y:222-height,'text-anchor':'middle','font-size':15,'font-weight':600},bin.count));
    svg.append(svgNode('text',{x:x+16,y:249,'text-anchor':'middle','font-size':12,fill:'#78828b'},index*10));
  });
  const x = 45 + threshold / 10 * step;
  svg.append(svgNode('line',{x1:x,x2:x,y1:20,y2:232,stroke:'#f5f5dc70','stroke-dasharray':'4 4'}));
  svg.append(svgNode('text',{x:Math.min(x+4,360),y:15,'font-size':13,fill:'#727b84'},`기준 ${threshold}`));
  svg.append(svgNode('text',{x:235,y:277,'text-anchor':'middle','font-size':13,fill:'#78828b'},'점수 구간 시작값 · 마지막 구간은 100점 포함'));
}
export function lessonChart(container, lessons, threshold) {
  if (!lessons.length) return empty(container);
  const width = 900, height = lessons.length * 46 + 38;
  const svg = canvas(container,'연습 항목별 평균 점수',width,height);
  const x0 = 235, range = 595;
  svg.append(svgNode('line',{x1:x0+threshold/100*range,x2:x0+threshold/100*range,y1:0,y2:height-27,stroke:'#f5f5dc70','stroke-dasharray':'4 4'}));
  svg.append(svgNode('text',{x:x0+threshold/100*range,y:height-8,'text-anchor':'middle','font-size':14,fill:'#727b84'},`통과 기준 ${threshold}`));
  lessons.forEach((lesson,index) => {
    const y = index * 46 + 10;
    const caption = svgNode('text',{x:x0-16,y:y+19,'text-anchor':'end','font-size':17},lesson.target.length > 16 ? lesson.target.slice(0,16)+'…' : lesson.target);
    caption.append(svgNode('title',{},lesson.target)); svg.append(caption);
    const bar = svgNode('rect',{x:x0,y,width:lesson.average/100*range,height:28,fill:BLUE,rx:4});
    tip(bar,`${lesson.target} · 평균 ${number(lesson.average)}점 · ${lesson.count}회 · 통과율 ${number(lesson.passRate)}%`); svg.append(bar);
    svg.append(svgNode('text',{x:x0+lesson.average/100*range+9,y:y+19,'font-size':15,'font-weight':600},number(lesson.average)));
  });
}
export function sparkline(scores) {
  const values = scores.slice(-12);
  if (values.length < 2) return document.createTextNode('—');
  const svg = svgNode('svg',{viewBox:'0 0 100 30',width:100,height:30,role:'img','aria-label':`최근 ${values.length}회 점수: ${values.join(', ')}`});
  svg.append(svgNode('title',{},`최근 ${values.length}회: ${values.join(' → ')}`));
  const points = values.map((value,index) => `${3+index/(values.length-1)*94},${27-value*.24}`).join(' ');
  svg.append(svgNode('polyline',{points,fill:'none',stroke:values.at(-1)>=values[0]?BLUE:RED,'stroke-width':2}));
  return svg;
}

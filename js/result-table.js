export function renderRecords(container, rows, onStudent) {
  container.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = '아직 저장된 학습 결과가 없습니다.'; container.append(empty); return;
  }
  const wrap = document.createElement('div'); wrap.className = 'table-wrap';
  const table = document.createElement('table');
  const caption = document.createElement('caption'); caption.textContent = `학습 결과 ${rows.length}건`; caption.style.textAlign = 'left'; caption.style.padding = '12px'; table.append(caption);
  const head = document.createElement('thead'); const tr = document.createElement('tr');
  for (const title of ['학습자','학급','목표 글자','인식된 말','일치율','판정','학습 일시']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = title; tr.append(th); }
  head.append(tr); table.append(head);
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const values = [`${row.number} ${row.name}`,row.classId,row.target,row.heard || '인식 없음',row.score === null ? '—' : `${row.score}%`,row.score === null ? '판정 대기' : row.passed ? '통과' : '재연습',new Date(row.at).toLocaleString('ko-KR')];
    values.forEach((value,index) => {
      const td = document.createElement('td'); td.textContent = value;
      if (index === 0 && onStudent) { const button = document.createElement('button'); button.className = 'link-button'; button.textContent = value; button.onclick = () => onStudent(row); td.replaceChildren(button); }
      if (index === 3) td.className = 'heard';
      if (index === 5) { const badge = document.createElement('span'); badge.className = `badge ${row.score === null ? 'pending' : row.passed ? '' : 'again'}`; badge.textContent = value; td.replaceChildren(badge); }
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(body); wrap.append(table); container.append(wrap);
}

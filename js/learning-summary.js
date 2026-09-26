const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const hasScore = row => Number.isFinite(row.score) && row.score >= 0 && row.score <= 100;
export const studentKey = row => JSON.stringify([row.classId, row.number]);

export function summarizeLearning(rows, threshold = 70) {
  const grouped = new Map();
  for (const row of rows) {
    const key = studentKey(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const students = [...grouped].map(([key, attempts]) => {
    const ordered = [...attempts].sort((a, b) => a.at.localeCompare(b.at) || String(a.id).localeCompare(String(b.id)));
    const scored = ordered.filter(hasScore);
    const latest = ordered.at(-1);
    const scores = scored.map(row => row.score);
    const first = scores[0] ?? null;
    const last = scores.at(-1) ?? null;
    const delta = scores.length >= 2 ? last - first : null;
    const best = scores.length ? Math.max(...scores) : null;
    const average = mean(scores);
    const lessons = summarizeLessons(scored, threshold);
    const reasons = [];
    let priority = 0;
    if (ordered.length < 2) { reasons.push('아직 1번만 연습했습니다.'); priority = 1; }
    if (best !== null && best < threshold) {
      reasons.push(`한 번도 통과하지 못했습니다 (최고 ${best}점, 기준 ${threshold}점).`);
      priority = best < threshold - 20 ? 3 : 2;
    }
    if (delta !== null && delta <= -10) { reasons.push(`처음보다 ${Math.abs(delta)}점 내려갔습니다.`); priority = Math.max(priority, 2); }
    if (!scores.length) { reasons.push('인식된 말이 없어 점수를 확인할 수 없습니다.'); priority = Math.max(priority, 1); }
    return { key, classId: latest.classId, number: latest.number, name: latest.name, count: ordered.length, first, last, delta, best, average, lastAt: latest.at, attempts: ordered, scores, priority, reasons, weakest: lessons[0] || null };
  });
  students.sort((a,b) => b.priority - a.priority || (a.best ?? -1) - (b.best ?? -1) || a.number.localeCompare(b.number));
  const comparable = students.filter(student => student.delta !== null);
  const scored = rows.filter(hasScore);
  const bins = Array.from({ length: 10 }, (_, index) => ({ label: index === 9 ? '90–100' : `${index * 10}–${index * 10 + 9}`, count: 0 }));
  for (const row of scored) bins[Math.min(9, Math.floor(row.score / 10))].count++;
  const classes = [...new Set(students.map(student => student.classId))].sort().map(classId => {
    const members = students.filter(student => student.classId === classId);
    return { classId, count: members.length, average: mean(members.map(student => student.average).filter(value => value !== null)) };
  });
  return { students, classes, bins, lessons: summarizeLessons(scored, threshold), attempts: rows.length, scoredCount: scored.length,
    average: mean(students.map(student => student.average).filter(value => value !== null)),
    growth: mean(comparable.map(student => student.delta)), comparableCount: comparable.length,
    improved: comparable.filter(student => student.delta > 0).length,
    declined: comparable.filter(student => student.delta < 0).length,
    unchanged: comparable.filter(student => student.delta === 0).length,
  };
}

export function summarizeLessons(rows, threshold = 70) {
  const groups = new Map();
  for (const row of rows.filter(hasScore)) {
    const key = JSON.stringify([row.lesson, row.target]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map(attempts => ({ lesson: attempts[0].lesson, target: attempts[0].target,
    count: attempts.length, students: new Set(attempts.map(studentKey)).size,
    average: mean(attempts.map(row => row.score)), passRate: attempts.filter(row => row.score >= threshold).length / attempts.length * 100,
  })).sort((a,b) => a.average - b.average || a.target.localeCompare(b.target));
}

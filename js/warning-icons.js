// The lesson SWF draws a grey "발음상 주의" mark. A yellow HTML icon sits
// exactly on that spot so only the yellow mark remains. Kana-card marks in
// the SWF are already yellow. Coordinates: 800 × 520 stage, crop y=71.
const voiceCaution = { a: 94.4, sa: 98.9, ta: 94.4, ha: 94.4 };
const icon = '<svg viewBox="0 0 32 30" aria-hidden="true"><path d="M14.2 3.2Q16 .2 17.8 3.2L29.3 25Q31 28 27.5 28H4.5Q1 28 2.7 25Z" fill="#ffff00" stroke="#000" stroke-width="3" stroke-linejoin="round"/><path d="M16 10v8" stroke="#000" stroke-width="3.6" stroke-linecap="round"/><circle cx="16" cy="23" r="1.8" fill="#000"/></svg>';

export function renderWarningIcons(container, row, wordMode) {
  container?.replaceChildren();
  const key = String(row || '').replace(/^kata-/, '');
  const y = voiceCaution[key];
  if (wordMode || y == null || !container) return;
  const marker = document.createElement('span');
  marker.className = 'unified-warning';
  // Cover the grey SWF mark (slightly left of the earlier offset).
  marker.style.cssText = 'left:' + (601 / 800 * 100) + '%;top:' + ((y - 71) / 409 * 100) + '%;width:' + (26 / 800 * 100) + '%;height:' + (22 / 409 * 100) + '%';
  marker.innerHTML = icon;
  container.append(marker);
}

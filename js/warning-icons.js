// Coordinates follow the original 800 × 520 lesson stage (cropped at y=71).
// Decorative overlays preserve the original pronunciation click targets beneath.
const columns = [198.5, 322.35, 443.3, 565.3, 685.3];
const warnings = { a: [0,1,2,3,4], sa: [1,2], ta: [1,2], ha: [1,2] };
const icon = '<svg viewBox="0 0 32 30" aria-hidden="true"><path d="M14.2 3.2Q16 .2 17.8 3.2L29.3 25Q31 28 27.5 28H4.5Q1 28 2.7 25Z" fill="#ffff00" stroke="#000" stroke-width="3" stroke-linejoin="round"/><path d="M16 10v8" stroke="#000" stroke-width="3.6" stroke-linecap="round"/><circle cx="16" cy="23" r="1.8" fill="#000"/></svg>';
export function renderWarningIcons(container, row, wordMode) {
  container.replaceChildren();
  if (wordMode || !warnings[row]) return;
  const add = (x,y,width,height) => {
    const marker=document.createElement('span');marker.className='unified-warning';
    marker.style.cssText='left:'+x/800*100+'%;top:'+(y-71)/409*100+'%;width:'+width/800*100+'%;height:'+height/409*100+'%';
    marker.innerHTML=icon;container.append(marker);
  };
  for (const column of warnings[row]) add(columns[column],222,25.5,21);
  add(619.6,row==='sa'?98.9:94.4,20,17);
}

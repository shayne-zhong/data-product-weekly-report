// Framework-neutral report contract and HTML renderer. No network or dependencies.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = n => typeof n === 'number' && Number.isFinite(n);
const array = x => Array.isArray(x) ? x : [];
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export function completion(actual, target) {
  if (!finite(actual) || actual < 0 || !finite(target) || target <= 0) throw new Error('完成率要求actual>=0且target>0');
  const rate = actual / target * 100;
  if (!Number.isFinite(rate)) throw new Error('完成率超出可计算范围');
  return Math.round(rate * 10) / 10;
}
export function validateReport(r) {
  const errors = [], warnings = [];
  const fail = (p, m) => errors.push(`${p}: ${m}`);
  const str = (v, p, max) => {if (typeof v !== 'string' || !v.trim() || v.length > max) fail(p, `需为1–${max}字文本`);};
  const list = (v,p,min,max) => {if (!Array.isArray(v) || v.length < min || v.length > max) fail(p, `需为${min}–${max}项数组`);};
  const ids = (values,p) => {const set = new Set(); array(values).forEach((v,i) => {str(v?.id,`${p}[${i}].id`,60); if(set.has(v?.id)) fail(p,'ID重复'); set.add(v?.id);}); return set;};
  if (!object(r)) return {errors:['report必须是对象'],warnings};
  if(r.schemaVersion !== 1) fail('schemaVersion','只支持1');
  str(r.title,'title',60); str(r.organization,'organization',40);
  if(!['quarter','half','year'].includes(r.period?.kind)) fail('period.kind','需为quarter/half/year');
  str(r.period?.label,'period.label',40);
  const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
  for(const k of ['start','end','asOf']) if(!date(r.period?.[k])) fail(`period.${k}`,'需为有效ISO日期');
  if(r.period?.start > r.period?.end) fail('period','start不能晚于end');
  if(r.period?.asOf < r.period?.start) fail('period.asOf','不能早于报告起始日');
  list(r.domains,'domains',1,12); list(r.sources,'sources',0,500); list(r.slides,'slides',1,40);
  const domains = ids(r.domains,'domains'), sources = ids(r.sources,'sources'); ids(r.slides,'slides');
  array(r.domains).forEach((d,i) => {str(d?.label,`domains[${i}].label`,20); if(!/^#[0-9a-f]{6}$/i.test(d?.color)) fail(`domains[${i}].color`,'需为#RRGGBB');});
  array(r.sources).forEach((s,i) => str(s?.title,`sources[${i}].title`,200));
  const refs = (v,p,required) => {list(v,p,required ? 1 : 0,10); array(v).forEach(id => {if(!sources.has(id)) fail(p,`未知来源 ${id}`);});};
  array(r.slides).forEach((s,i) => {
    const p = `slides[${i}]`;
    if(!object(s)) {fail(p,'需为对象');return;}
    str(s.title,`${p}.title`,52);
    if(!domains.has(s.domainId)) fail(`${p}.domainId`,'未知领域');
    if(s.summary !== undefined) str(s.summary,`${p}.summary`,110);
    if(!['cover','metrics','cards','combined'].includes(s.kind)) fail(`${p}.kind`,'未知布局');
    const hasMetrics = ['metrics','combined'].includes(s.kind), hasCards = ['cards','combined'].includes(s.kind);
    if(hasMetrics) list(s.metrics,`${p}.metrics`,1,s.kind==='combined'?5:8);
    else if(s.metrics !== undefined) fail(p,'该布局不支持metrics');
    if(hasCards) list(s.cards,`${p}.cards`,1,s.kind==='combined'?3:6);
    else if(s.cards !== undefined) fail(p,'该布局不支持cards');
    array(s.metrics).forEach((m,j) => {
      const q = `${p}.metrics[${j}]`;
      if(!object(m)){fail(q,'需为对象');return;}
      str(m.label,`${q}.label`,20); str(m.definition,`${q}.definition`,48);
      if(typeof m.unit !== 'string' || m.unit.length > 8) fail(`${q}.unit`,'单位需为0–8字文本');
      if(m.value !== null && !finite(m.value)) fail(`${q}.value`,'需为有限数字或null');
      if(m.value !== null && `${m.value}${m.unit}`.length > 16) fail(q,'数字与单位过长，请换算为万/亿等并明确口径');
      if(m.note !== undefined) str(m.note,`${q}.note`,40);
      refs(m.sourceIds,`${q}.sourceIds`,m.value !== null);
      if(m.value === null) warnings.push(`${q}: 数值待确认`);
      if(m.progress !== undefined) {
        try {completion(m.progress?.actual,m.progress?.target);} catch(e) {fail(`${q}.progress`,e.message);}
        if(m.value !== m.progress?.actual) fail(q,'progress.actual必须与value一致');
      }
    });
    array(s.cards).forEach((c,j) => {
      const q = `${p}.cards[${j}]`;
      if(!object(c)){fail(q,'需为对象');return;}
      str(c.title,`${q}.title`,24); str(c.body,`${q}.body`,110); refs(c.sourceIds,`${q}.sourceIds`,true);
      if(c.value !== undefined) str(c.value,`${q}.value`,14);
    });
  });
  return {errors,warnings};
}

const css = `
*{box-sizing:border-box}html,body{margin:0;background:#f2eee7;color:#171713;font-family:"Microsoft YaHei","PingFang SC",sans-serif}
.slide{--accent:#bd252b;display:none;position:relative;width:1600px;height:900px;padding:44px 64px 62px;background:#fbfaf7;transform-origin:top left}
.slide.active{display:flex;flex-direction:column}.mast{display:flex;justify-content:space-between;border-bottom:1px solid #dcd6cc;padding-bottom:18px;font-size:17px;flex:none}.mast strong{color:var(--accent)}.draft{color:#716c63;font-size:14px}
.kicker{color:var(--accent);font-size:16px;margin:25px 0 12px;font-weight:700}h1,h2,h3,p{margin:0}h2{font-size:40px;line-height:1.3;margin-bottom:24px;min-height:52px;overflow-wrap:anywhere}h1{font-size:62px;line-height:1.3;max-width:1250px;overflow-wrap:anywhere}
.body{display:flex;flex-direction:column;gap:20px;flex:1;min-height:0}.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 28px;flex:1}.metric{background:#fff;border-top:4px solid var(--accent);padding:16px 22px;min-width:0}.metric .number{font-size:34px;color:var(--accent);font-weight:800;line-height:1.2}.metric h3{font-size:20px;margin:6px 0}.detail{font-size:16px;line-height:1.45;color:#514d46;overflow-wrap:anywhere}.source{font-size:12px;color:#716c63;margin-top:7px;overflow-wrap:anywhere}.track{height:9px;background:#e8e3dc;margin:10px 0 5px}.fill{height:100%;background:#16855b}.note{font-size:13px;color:#716c63;margin-top:5px}
.page-metrics .metric .number{float:right;font-size:28px;margin-left:14px}.page-metrics .metric h3{margin:0 0 6px;font-size:19px}.page-metrics .metric .detail{font-size:14px}.page-metrics .metric{padding:10px 20px}.page-metrics .metric .source{margin-top:4px}.page-metrics .track{clear:both;margin-top:7px} .page-metrics .metrics{gap:8px 28px} .slide{flex-direction:column}.page-metrics .summary{padding:10px 18px}.page-metrics .body{gap:12px}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;flex:1}.card{min-width:0;background:#fff;border-top:5px solid var(--accent);padding:24px}.card .number{color:var(--accent);font-size:38px;font-weight:800}.card h3{font-size:24px;margin:12px 0}.card p{font-size:20px;line-height:1.5;overflow-wrap:anywhere}
.combined .metrics{grid-template-columns:repeat(var(--count),minmax(0,1fr));flex:0 0 208px;gap:14px}.combined .metric{padding:14px 16px}.combined .metric .number{font-size:30px}.combined .metric h3{font-size:19px}.combined .detail{font-size:14px}.combined .cards{min-height:260px}.summary{padding:18px 22px;background:#edf1ef;border-left:5px solid var(--accent);font-size:19px;line-height:1.5;overflow-wrap:anywhere;flex:none}
.footer{position:absolute;bottom:24px;left:64px;right:64px;display:flex;justify-content:space-between;color:#716c63;font-size:14px}.cover .body{justify-content:center;gap:30px}.cover .summary{max-width:1200px;font-size:25px}.controls{position:fixed;bottom:6px;left:50%;transform:translateX(-50%);display:flex;gap:10px;z-index:5}.controls button{cursor:pointer;padding:7px 14px;background:#fff;border:1px solid #dcd6cc;color:#514d46}.stage{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
@media(max-width:700px){.stage{position:static;transform:none!important;width:auto!important;height:auto!important}.slide,.slide.active{display:flex!important;transform:none!important;width:100%;height:auto;min-height:100vh;padding:24px 20px 58px;margin-bottom:16px}.mast{gap:15px;font-size:14px}h1{font-size:36px}h2{font-size:29px}.metrics,.cards,.combined .metrics{grid-template-columns:1fr!important;flex:auto}.body{min-height:auto}.combined .cards{min-height:0}.footer{left:20px;right:20px;font-size:11px}.controls{display:none}.cover .body{padding:35px 0}.combined .metric .number{font-size:34px}}
@media print{@page{size:1600px 900px;margin:0}html,body{background:#fff}.stage{position:static;transform:none!important;width:auto!important;height:auto!important}.slide,.slide.active{display:flex!important;transform:none!important;width:1600px;height:900px;break-after:page;print-color-adjust:exact;-webkit-print-color-adjust:exact}.slide:last-child{break-after:auto}.controls{display:none}}
`;
const runtime = `(()=>{const slides=[...document.querySelectorAll('.slide')];let current=0;const stage=document.querySelector('.stage');function fit(){const scale=Math.min(innerWidth/1600,innerHeight/900);stage.style.width=1600*scale+'px';stage.style.height=900*scale+'px';slides.forEach(s=>s.style.transform='scale('+scale+')')}function show(n){current=Math.min(slides.length-1,Math.max(0,n));slides.forEach((s,i)=>s.classList.toggle('active',i===current));try{history.replaceState(null,'','#'+(current+1))}catch{}document.querySelector('#prev').disabled=current===0;document.querySelector('#next').disabled=current===slides.length-1}function hash(){const n=Number(location.hash.slice(1));show(Number.isInteger(n)&&n>0?n-1:0)}document.querySelector('#prev').onclick=()=>show(current-1);document.querySelector('#next').onclick=()=>show(current+1);document.querySelector('#print').onclick=()=>print();document.querySelector('#full').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen().catch(()=>{});addEventListener('keydown',e=>{if(e.target.closest('button,input,textarea,select')||e.target.isContentEditable)return;if(['ArrowRight','PageDown',' '].includes(e.key)){e.preventDefault();show(current+1)}if(['ArrowLeft','PageUp'].includes(e.key)){e.preventDefault();show(current-1)}if(e.key==='Home')show(0);if(e.key==='End')show(slides.length-1)});addEventListener('resize',fit);addEventListener('hashchange',hash);fit();hash()})();`;

export function renderReport(r) {
  const result = validateReport(r);
  if(result.errors.length) throw new Error(result.errors.join('\n'));
  const source = ids => `<div class="source">来源 ${esc(ids.join(' · ') || '待补充')}</div>`;
  const metric = m => `<article class="metric"><div class="number">${m.value===null?'待确认':esc(m.value)+esc(m.unit)}</div><h3>${esc(m.label)}</h3><p class="detail">${esc(m.definition)}</p>${m.progress?`<div class="track"><div class="fill" style="width:${Math.min(100,completion(m.progress.actual,m.progress.target))}%"></div></div><div class="note">完成 ${completion(m.progress.actual,m.progress.target)}%</div>`:''}${m.note?`<div class="note">${esc(m.note)}</div>`:''}${source(m.sourceIds)}</article>`;
  const card = c => `<article class="card">${c.value?`<div class="number">${esc(c.value)}</div>`:''}<h3>${esc(c.title)}</h3><p>${esc(c.body)}</p>${source(c.sourceIds)}</article>`;
  const slides = r.slides.map((s,i)=> {
    const d = r.domains.find(d=>d.id===s.domainId);
return `<section class="slide ${['metrics','cards'].includes(s.kind)?'page-'+s.kind:s.kind}${i===0?' active':''}" style="--accent:${d.color}" data-slide-id="${esc(s.id)}"><div class="mast"><strong>${esc(r.organization)} · ${esc(d.label)}</strong><span class="draft">${esc(r.period.label)} · 截至${esc(r.period.asOf)} · 草稿·待审核</span></div><div class="kicker">${esc(r.period.label)}</div>${s.kind!=='cover'?`<h2>${esc(s.title)}</h2>`:''}<div class="body">${s.kind==='cover'?`<h1>${esc(s.title)}</h1>`:''}${s.metrics?`<div class="metrics" style="--count:${s.metrics.length}">${s.metrics.map(metric).join('')}</div>`:''}${s.cards?`<div class="cards">${s.cards.map(card).join('')}</div>`:''}${s.summary?`<div class="summary">${esc(s.summary)}</div>`:''}</div><div class="footer"><span>${esc(r.period.start)} — ${esc(r.period.end)}</span><span>${String(i+1).padStart(2,'0')} / ${r.slides.length}</span></div></section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(r.title)}</title><link rel="icon" href="data:,"><style>${css}</style></head><body><main class="stage">${slides}</main><nav class="controls" aria-label="报告控制"><button id="prev">上一页</button><button id="next">下一页</button><button id="full">全屏</button><button id="print">打印</button></nav><script>${runtime}</script></body></html>`;
}

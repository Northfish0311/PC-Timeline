const $ = id => document.getElementById(id);
const M = TimelineModel;
const fmt = n => `${(n / 1024 ** 3).toFixed(1)} GB`;
const clock = t => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const eventKey = e => e.id || `${e.time}|${e.title}`;
let state = null, loading = false, filter = 'all', limit = 60, appsLimit = 80, settingsDirty = false, saving = false;
let historySignature = '', recentSignature = '', drivesSignature = '', usbSignature = '', appsSignature = '', weekSignature = '';
let toastTimer;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function icon(name) { const e = el('i'); e.dataset.lucide = name; return e; }
function icons() { lucide.createIcons({ attrs: { 'aria-hidden': 'true' } }); }
function empty(text, name = 'inbox') { const e = el('div', 'empty'); e.append(icon(name), el('span', '', text)); return e; }
function toast(text, failed = false) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.toggle('error', failed); $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, failed ? 8000 : 4500); }
function view() {
  const names = { overview: '概览', timeline: '变化时间轴', devices: '设备与软件', privacy: '记录设置' };
  const name = names[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  document.querySelectorAll('.view').forEach(e => { e.hidden = e.id !== name; });
  document.querySelectorAll('[data-view]').forEach(e => { const active = e.dataset.view === name; e.classList.toggle('active', active); if (active) e.setAttribute('aria-current', 'page'); else e.removeAttribute('aria-current'); });
  $('title').textContent = names[name];
  if (state) render();
  icons();
}
function showDetail(event) {
  $('detail-title').textContent = event.title;
  $('detail-type').textContent = M.TYPES[event.type] || '系统';
  $('detail-time').textContent = new Date(event.time).toLocaleString('zh-CN');
  $('detail-text').textContent = event.detail;
  $('comparison').replaceChildren();
  if (!event.comparison?.length) $('comparison').append(el('p', '', event.type === 'system' ? '这条记录用于标记开始采集的时间。' : '这条旧记录没有保存变化前后的独立数值。'));
  for (const c of event.comparison || []) {
    const row = el('div', 'compare-row');
    row.append(el('div', 'compare-label', c.label));
    const values = el('div', 'compare-values');
    const before = el('span'); before.append(el('small', '', '变化前'), el('span', '', c.format === 'bytes' ? fmt(c.before) : c.before));
    const after = el('span'); after.append(el('small', '', '变化后'), el('span', '', c.format === 'bytes' ? fmt(c.after) : c.after));
    values.append(before, icon('arrow-right'), after); row.append(values); $('comparison').append(row);
  }
  icons(); $('detail-dialog').showModal();
}
function eventRow(event) {
  const row = el('button', 'event'); row.dataset.type = event.type; row.dataset.key = eventKey(event);
  const badge = el('span', 'badge'); badge.append(icon({ usb: 'usb', disk: 'hard-drive', software: 'app-window', system: 'flag' }[event.type] || 'activity'));
  const body = el('span'); body.append(el('span', 'event-title', event.title), el('div', 'detail', event.detail));
  const t = el('time', '', new Date(event.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })); t.dateTime = event.time;
  row.append(badge, body, t); row.addEventListener('click', () => showDetail(event)); return row;
}
function renderHistory() {
  const list = M.filterEvents(state.events, { type: filter, range: $('range').value, query: $('event-search').value, day: $('day').value });
  const signature = JSON.stringify([list, limit]);
  $('result-count').textContent = `${list.length} 条记录`;
  $('shown-count').textContent = list.length ? `显示 ${Math.min(limit, list.length)} / ${list.length}` : '';
  $('more').hidden = list.length <= limit;
  if (signature === historySignature) return;
  const anchor = [...$('history').querySelectorAll('.event')].find(e => e.getBoundingClientRect().top >= 0 && e.getBoundingClientRect().top < innerHeight);
  const anchorKey = anchor?.dataset.key, anchorTop = anchor?.getBoundingClientRect().top;
  historySignature = signature; $('history').replaceChildren();
  if (!list.length) { $('history').append(empty(state.events.length ? '这个筛选条件下没有记录。换个日期或关键词试试。' : '首次检查会建立基准，之后的变化会出现在这里。')); return; }
  let previousDay = '';
  for (const event of list.slice(0, limit)) {
    const day = M.dateKey(event.time);
    if (day !== previousDay) { const h = el('div', 'day-label', day === M.dateKey(new Date()) ? '今天' : new Date(event.time).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })); h.append(el('span', '', `${list.filter(e => M.dateKey(e.time) === day).length} 条`)); $('history').append(h); previousDay = day; }
    $('history').append(eventRow(event));
  }
  if (anchorKey) requestAnimationFrame(() => { const next = [...$('history').querySelectorAll('.event')].find(e => e.dataset.key === anchorKey); if (next) window.scrollBy(0, next.getBoundingClientRect().top - anchorTop); });
}
function drawSpark(canvas) {
  const points = canvas.points;
  const rect = canvas.getBoundingClientRect(); if (!rect.width) return;
  const ratio = Math.min(devicePixelRatio || 1, 2), w = rect.width, h = 56;
  canvas.width = w * ratio; canvas.height = h * ratio;
  const c = canvas.getContext('2d'); c.scale(ratio, ratio); c.clearRect(0, 0, w, h);
  const min = Math.min(...points.map(p => p.free)), max = Math.max(...points.map(p => p.free));
  const t0 = Date.parse(points[0].time), span = Math.max(1, Date.parse(points.at(-1).time) - t0);
  const pos = p => [(Date.parse(p.time) - t0) / span * (w - 8) + 4, max === min ? h / 2 : h - 8 - (p.free - min) / (max - min) * (h - 16)];
  c.strokeStyle = '#74a68a'; c.lineWidth = 1.7; c.beginPath();
  points.forEach((p, i) => { const [x, y] = pos(p); if (!i || Date.parse(p.time) - Date.parse(points[i - 1].time) > (state.settings?.intervalSeconds || 60) * 2000) c.moveTo(x, y); else c.lineTo(x, y); }); c.stroke();
  const [x, y] = pos(points.at(-1)); c.fillStyle = '#548d6d'; c.beginPath(); c.arc(x, y, 2.8, 0, Math.PI * 2); c.fill();
}
function renderDrives() {
  const drives = state.snapshot?.drives || [], samples = state.samples || [];
  const signature = JSON.stringify([drives, samples]); if (signature === drivesSignature) return; drivesSignature = signature;
  $('drives').replaceChildren();
  if (!drives.length) { $('drives').append(empty(state.snapshot?.warnings?.includes('disk') ? '本次磁盘读取失败，稍后可以再试。' : '磁盘信息尚未就绪。', 'hard-drive')); return; }
  for (const d of drives) {
    const row = el('article', 'drive'); const top = el('div', 'drive-top'), name = el('div', 'drive-name'); name.append(icon('hard-drive'), el('span', '', d.id)); top.append(name, el('span', 'drive-tag', d.total && d.free / d.total < .1 ? '空间较少' : '本地磁盘'));
    const cap = el('div', 'capacity', fmt(d.free)); cap.append(el('small', '', '可用'));
    const meter = el('div', `meter${d.total && d.free / d.total < .1 ? ' low' : ''}`); const fill = el('span'); fill.style.width = `${Math.min(100, Math.max(0, d.total ? (1 - d.free / d.total) * 100 : 0))}%`; meter.append(fill);
    row.append(top, cap, meter, el('p', '', `已用 ${fmt(d.total - d.free)} / 共 ${fmt(d.total)}`));
    const points = M.diskSeries(samples, d.id, Date.now() - 24 * 60 * 60 * 1000);
    if (points.length < 2) row.append(el('div', 'spark-empty', points.length ? '下一次采样后显示趋势' : '尚无趋势采样'));
    else {
      const canvas = el('canvas', 'spark'); canvas.points = points; canvas.setAttribute('role', 'img'); const delta = points.at(-1).free - points[0].free; canvas.setAttribute('aria-label', `${d.id} 可用空间趋势，共 ${points.length} 次采样，变化 ${fmt(delta)}`); row.append(canvas);
      const caption = el('div', 'trend-caption'); caption.append(el('span', '', `${clock(points[0].time).slice(0, 5)} — ${clock(points.at(-1).time).slice(0, 5)}`), el('span', delta >= 0 ? 'up' : 'down', `${delta > 0 ? '+' : ''}${fmt(delta)}`)); row.append(caption);
    }
    $('drives').append(row);
  }
  requestAnimationFrame(() => document.querySelectorAll('.spark').forEach(drawSpark));
}
function renderWeek() {
  const today = state.events.filter(e => M.dateKey(e.time) === M.dateKey(new Date()) && e.type !== 'system');
  const days = M.weekCounts(state.events); const signature = JSON.stringify([today, days]); if (signature === weekSignature) return; weekSignature = signature;
  $('week').replaceChildren(); const max = Math.max(1, ...days.map(d => d.count));
  for (const d of days) { const b = el('button', 'day-bar'); b.title = `${d.day}：${d.count} 项变化`; b.setAttribute('aria-label', b.title); const track = el('span', 'bar-track'), fill = el('span', 'bar-fill'); fill.style.height = `${Math.max(3, d.count / max * 88)}px`; track.append(fill); b.append(el('small', '', d.count || '—'), track, el('span', '', d.label)); b.addEventListener('click', () => { $('day').value = d.day; $('range').value = 'all'; limit = 60; location.hash = 'timeline'; renderHistory(); icons(); }); $('week').append(b); }
  $('breakdown').replaceChildren();
  for (const [type, ico] of [['usb', 'usb'], ['software', 'app-window'], ['disk', 'hard-drive']]) { const r = el('div', 'breakdown-row'), label = el('span'); label.append(icon(ico), el('span', '', `今日${M.TYPES[type]}变化`)); r.append(label, el('strong', '', today.filter(e => e.type === type).length)); $('breakdown').append(r); }
}
function renderInventory() {
  const usb = state.snapshot?.usb || [];
  if (JSON.stringify(usb) !== usbSignature) {
    usbSignature = JSON.stringify(usb); $('usb-list').replaceChildren();
    if (!usb.length) $('usb-list').append(empty('当前没有可显示的 USB 登记。', 'usb'));
    for (const u of usb) { const r = el('div', 'inventory-row'), badge = el('span', 'badge'); badge.append(icon('usb')); const body = el('div'); body.append(el('span', '', u.name || '未命名设备'), el('div', `device-status${u.status && u.status !== 'OK' ? ' warn' : ''}`, u.status === 'OK' ? '系统状态正常' : u.status || '未提供状态')); r.append(badge, body, el('small', '', u.version || '未提供类别')); $('usb-list').append(r); }
  }
  $('usb-info').textContent = `${usb.length} 项接口登记`;
  const apps = (state.snapshot?.software || []).filter(x => x.name.toLocaleLowerCase().includes($('search').value.trim().toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const signature = JSON.stringify([apps, appsLimit]); $('apps-more').hidden = apps.length <= appsLimit; $('apps-shown').textContent = apps.length ? `${Math.min(appsLimit, apps.length)} / ${apps.length} 项登记` : '';
  if (signature !== appsSignature) { appsSignature = signature; $('apps-list').replaceChildren(); if (!apps.length) $('apps-list').append(empty('没有匹配的软件登记。', 'search')); for (const a of apps.slice(0, appsLimit)) { const r = el('div', 'inventory-row'), badge = el('span', 'badge'); badge.append(icon('app-window')); r.append(badge, el('span', '', a.name), el('small', '', a.version || '未提供版本')); $('apps-list').append(r); } }
}
function render() {
  const s = state.snapshot, today = state.events.filter(e => M.dateKey(e.time) === M.dateKey(new Date()) && e.type !== 'system');
  $('count').textContent = s ? today.length : '—'; $('count-detail').textContent = s ? '已记录的设备、软件与磁盘变化' : '等待建立基准'; $('nav-count').textContent = state.events.length;
  $('usb-count').textContent = s ? s.usb.length : '—'; $('apps-count').textContent = s ? s.software.length : '—'; $('scan').textContent = s ? clock(s.time) : '等待采集';
  $('status').textContent = state.busy ? '正在采集…' : state.paused ? '自动记录已暂停' : state.error ? '上次采集未完成' : `每 ${state.settings?.intervalSeconds || 60} 秒检查`;
  const pauseLabel = state.paused ? '继续记录' : '暂停记录';
  if ($('pause').textContent !== pauseLabel) { $('pause').replaceChildren(icon(state.paused ? 'play' : 'pause'), el('span', '', pauseLabel)); }
  $('refresh').disabled = !!state.busy; $('refresh').querySelector('span').textContent = state.busy ? '检查中' : '立即检查'; $('export').disabled = !s;
  const warnings = [state.error, state.recoveryNotice, ...(s?.warnings || []).map(x => `${{ disk: '磁盘', usb: 'USB', software: '软件' }[x]}读取失败，本次跳过该类比较。`)].filter(Boolean); $('notice').hidden = !warnings.length; $('notice').textContent = warnings.join(' ');
  $('side-status').textContent = warnings.length ? '采集需要留意' : state.paused ? '记录已暂停' : state.busy ? '正在检查' : '正在记录'; $('side-dot').className = `status-dot${warnings.length ? ' error' : state.paused ? ' paused' : ''}`;
  renderDrives(); renderWeek(); renderHistory(); renderInventory();
  const recent = state.events.slice(0, 5), signature = JSON.stringify(recent); if (signature !== recentSignature) { recentSignature = signature; $('recent').replaceChildren(); if (!recent.length) $('recent').append(empty('首次检查建立基准后，新的变化会出现在这里。')); for (const e of recent) $('recent').append(eventRow(e)); }
  $('footer').textContent = state.paused ? '记录已暂停 · 历史仍保留' : s ? `最近检查 ${clock(s.time)}` : '准备建立基准'; $('version').textContent = state.version || '0.2.0';
  $('stop').querySelector('span').textContent = state.desktop ? '退出软件' : '停止本地服务';
  $('storage-help').textContent = state.desktop ? '历史保存在 %APPDATA%\\PC Timeline\\data。安装版和便携版共用当前用户的记录；清除前先退出软件，再删除该目录。' : '历史保存在项目的 data/timeline.json。清除前先停止服务，再删除 data 目录；该目录不加入 Git。';
  $('retention-help').textContent = '最多保存 2,000 条事件和 1,440 个磁盘采样点，达到上限后移除最早记录。更新软件不会主动清空历史。';
  $('started-at').textContent = state.startedAt ? new Date(state.startedAt).toLocaleString('zh-CN') : '尚未建立基准'; $('saved-count').textContent = `${state.events.length} / 2,000`; $('samples-count').textContent = `${state.samples?.length || 0} / 1,440`;
  if (!settingsDirty && !saving) { for (const [id, value] of [['interval', state.settings?.intervalSeconds || 60], ['threshold', state.settings?.diskThresholdMiB || 256]]) { if (![...$(id).options].some(o => +o.value === value)) $(id).append(new Option(`${value}${id === 'interval' ? ' 秒' : ' MiB'}`, value)); $(id).value = value; } }
  icons();
}
async function load() {
  if (loading) return; loading = true;
  try { const response = await fetch('/api/state'); if (!response.ok) throw Error(); state = await response.json(); render(); }
  catch { $('notice').hidden = false; $('notice').textContent = '本地服务暂时无法连接。当前显示的是之前的数据，重新打开软件后可继续。'; $('side-status').textContent = '连接中断'; $('side-dot').className = 'status-dot error'; }
  finally { loading = false; }
}
async function post(name, body) { const r = await fetch(`/api/${name}`, { method: 'POST', headers: { 'X-Timeline-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); const result = await r.json(); if (!r.ok) throw Error(result.error || '操作未完成'); return result; }
async function action(name) { $(name).disabled = true; try { await post(name); await load(); } catch (e) { toast(e.message || '操作未完成，请稍后重试。', true); } finally { $(name).disabled = name === 'refresh' && !!state?.busy; } }
document.querySelectorAll('[data-view]').forEach(e => e.addEventListener('click', () => { location.hash = e.dataset.view; }));
document.querySelectorAll('[data-filter]').forEach(e => e.addEventListener('click', () => { filter = e.dataset.filter; limit = 60; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === e)); if (state) { renderHistory(); icons(); } }));
for (const id of ['event-search', 'range', 'day']) $(id).addEventListener(id === 'event-search' ? 'input' : 'change', () => { limit = 60; if (state) { renderHistory(); icons(); } });
$('reset').addEventListener('click', () => { filter = 'all'; limit = 60; $('range').value = 'all'; $('day').value = ''; $('event-search').value = ''; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all')); if (state) { renderHistory(); icons(); } });
$('more').addEventListener('click', () => { limit += 60; renderHistory(); icons(); });
$('search').addEventListener('input', () => { appsLimit = 80; if (state) { renderInventory(); icons(); } });
$('apps-more').addEventListener('click', () => { appsLimit += 80; renderInventory(); icons(); });
$('pause').addEventListener('click', () => action('pause')); $('refresh').addEventListener('click', () => action('refresh'));
$('close-detail').addEventListener('click', () => $('detail-dialog').close()); $('detail-dialog').addEventListener('click', e => { if (e.target === $('detail-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
for (const id of ['interval', 'threshold']) $(id).addEventListener('change', () => { settingsDirty = true; });
$('settings-form').addEventListener('submit', async e => { e.preventDefault(); if (saving) return; saving = true; $('save-settings').disabled = true; try { await post('settings', { intervalSeconds: +$('interval').value, diskThresholdMiB: +$('threshold').value }); settingsDirty = false; toast('设置已保存，下次自动检查按新间隔进行。'); await load(); } catch (error) { toast(error.message, true); } finally { saving = false; $('save-settings').disabled = false; } });
$('export').addEventListener('click', () => {
  if (!state?.snapshot) return; const c = document.createElement('canvas'); c.width = 1080; c.height = 720; const x = c.getContext('2d'), today = state.events.filter(e => M.dateKey(e.time) === M.dateKey(new Date()) && e.type !== 'system');
  x.fillStyle = '#f6f8fa'; x.fillRect(0, 0, 1080, 720); x.fillStyle = '#2e4a3e'; x.font = 'bold 46px "Microsoft YaHei",sans-serif'; x.fillText('今天，电脑发生了什么？', 72, 106); x.fillStyle = '#8a9ca6'; x.font = '24px "Microsoft YaHei",sans-serif'; x.fillText(new Date().toLocaleDateString('zh-CN'), 72, 162); x.fillStyle = '#397e5b'; x.font = 'bold 90px sans-serif'; x.fillText(String(today.length), 72, 290); x.font = '24px "Microsoft YaHei",sans-serif'; x.fillText('项已记录变化', 72, 340);
  ['usb', 'software', 'disk'].forEach((type, i) => { x.fillStyle = '#7b8f9d'; x.font = '24px "Microsoft YaHei",sans-serif'; x.fillText(`${M.TYPES[type]} ${today.filter(e => e.type === type).length}`, 72 + i * 250, 395); });
  state.snapshot.drives.slice(0, 3).forEach((d, i) => { x.fillStyle = '#617987'; x.font = '23px "Microsoft YaHei",sans-serif'; x.fillText(`${d.id}    可用 ${fmt(d.free)} / ${fmt(d.total)}`, 72, 462 + i * 45); }); x.fillStyle = '#97a5ae'; x.font = '19px "Microsoft YaHei",sans-serif'; x.fillText('电脑时光机 · 仅统计运行后记录 · 不含名称和私人路径', 72, 664);
  c.toBlob(blob => { if (!blob) { toast('日报图片生成失败。', true); return; } const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = `PC-Timeline-${M.dateKey(new Date())}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); });
});
$('stop').addEventListener('click', async () => { if (!confirm(state?.desktop ? '退出软件后不再记录。确定退出？' : '停止后不再记录。下次双击 Start.cmd 重新打开。确定停止？')) return; try { await post('stop'); clearInterval(poll); $('refresh').disabled = true; $('pause').disabled = true; $('notice').hidden = false; $('notice').textContent = '本地服务已停止。'; } catch { toast('停止未完成，可直接关闭软件窗口。', true); } });
window.addEventListener('hashchange', view); window.addEventListener('resize', () => { document.querySelectorAll('.spark').forEach(drawSpark); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { $('date').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }); void load(); } });
$('date').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
view(); void load(); const poll = setInterval(() => { if (!document.hidden) void load(); }, 3000);

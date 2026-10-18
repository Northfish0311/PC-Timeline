const $ = id => document.getElementById(id);
const M = TimelineModel;
const fmt = n => `${(n / 1024 ** 3).toFixed(1)} GB`;
const clock = t => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const eventKey = e => e.id || `${e.time}|${e.title}`;
let state = null, loadPromise = null, filter = 'all', limit = 60, settingsDirty = false, saving = false;
let currentView = 'overview', displayedEvents = null, selectedKey = null, detailCandidates = [], connected = false, stopped = false, mutationEpoch = 0;
const scrollPositions = {}, pendingActions = new Set();
let historySignature = '', recentSignature = '', drivesSignature = '', usbSignature = '', appsSignature = '', weekSignature = '';
let toastTimer;
let inventoryKind = 'usb', inventoryLimit = 80;
const inventoryQueries = { usb: '', software: '' };
let timelineVisited = false;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function highlight(node, text, query) { node.replaceChildren(...M.searchSegments(text, query).map(part => part.match ? el('mark', '', part.text) : document.createTextNode(part.text))); return node; }
function dateLabel(time) {
  const date = new Date(time), now = new Date(), yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  return M.dateKey(date) === M.dateKey(now) ? '今天' : M.dateKey(date) === M.dateKey(yesterday) ? '昨天' : date.toLocaleDateString('zh-CN', { ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}), month: 'numeric', day: 'numeric' });
}
function icon(name) { const e = el('i'); e.dataset.lucide = name; return e; }
function icons() { if (!document.querySelector('i[data-lucide]')) return; lucide.createIcons({ attrs: { 'aria-hidden': 'true' } }); document.querySelectorAll('svg[data-lucide]').forEach(e => e.removeAttribute('data-lucide')); }
function empty(text, name = 'inbox') { const e = el('div', 'empty'); e.append(icon(name), el('span', '', text)); return e; }
function toast(text, failed = false) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.toggle('error', failed); $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, failed ? 8000 : 4500); }
function view() {
  const names = { overview: '概览', timeline: '变化时间轴', devices: '设备与软件', privacy: '记录设置' };
  const name = names[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  const changed = name !== currentView;
  if (changed) { scrollPositions[currentView] = scrollY; currentView = name; }
  if (name === 'timeline' && !timelineVisited) { if (state) displayedEvents = state.events; timelineVisited = true; }
  document.querySelectorAll('.view').forEach(e => { e.hidden = e.id !== name; });
  document.querySelectorAll('[data-view]').forEach(e => { const active = e.dataset.view === name; e.classList.toggle('active', active); if (active) e.setAttribute('aria-current', 'page'); else e.removeAttribute('aria-current'); });
  $('title').textContent = names[name];
  if (state) render();
  icons();
  if (changed) requestAnimationFrame(() => window.scrollTo(0, scrollPositions[name] || 0));
  if (name === 'overview') requestAnimationFrame(() => document.querySelectorAll('.spark').forEach(drawSpark));
}
function filteredEvents() { return M.filterEvents(displayedEvents || state?.events || [], { type: filter, range: $('range').value, query: $('event-search').value, day: $('day').value }); }
function showDetail(event, reuseList = false) {
  if (!reuseList) detailCandidates = currentView === 'timeline' ? filteredEvents() : state.events;
  selectedKey = eventKey(event);
  $('detail-title').textContent = event.title;
  $('detail-type').replaceChildren(icon({ usb: 'usb', disk: 'hard-drive', software: 'app-window', system: 'flag' }[event.type] || 'activity'), el('span', '', M.TYPES[event.type] || '系统')); $('detail-type').dataset.type = event.type;
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
    if (c.format === 'bytes' && Number.isFinite(c.before) && Number.isFinite(c.after)) after.classList.add(c.after < c.before ? 'decreased' : c.after > c.before ? 'increased' : 'unchanged');
    values.append(before, icon('arrow-right'), after); row.append(values);
    if (c.format === 'bytes' && Number.isFinite(c.before) && Number.isFinite(c.after)) row.append(el('p', 'compare-delta', `净变化 ${M.formatDelta(c.after - c.before)}`));
    $('comparison').append(row);
  }
  const position = detailCandidates.findIndex(e => eventKey(e) === selectedKey);
  $('detail-position').textContent = position < 0 ? '单条记录' : `${position + 1} / ${detailCandidates.length}`;
  $('previous-detail').disabled = position <= 0; $('next-detail').disabled = position < 0 || position >= detailCandidates.length - 1;
  document.querySelectorAll('.event').forEach(e => { e.classList.toggle('selected', e.dataset.key === selectedKey); e.setAttribute('aria-expanded', String(e.dataset.key === selectedKey)); });
  icons(); if (!$('detail-dialog').open) $('detail-dialog').showModal(); $('detail-dialog').scrollTop = 0;
}
function navigateDetail(direction) { const index = detailCandidates.findIndex(e => eventKey(e) === selectedKey), next = detailCandidates[index + direction]; if (next) showDetail(next, true); }
function eventRow(event, query = '', withDate = false) {
  const row = el('button', 'event'); row.dataset.type = event.type; row.dataset.key = eventKey(event);
  row.setAttribute('aria-haspopup', 'dialog'); row.setAttribute('aria-expanded', 'false');
  const badge = el('span', 'badge'); badge.append(icon({ usb: 'usb', disk: 'hard-drive', software: 'app-window', system: 'flag' }[event.type] || 'activity'));
  const body = el('span'); body.append(highlight(el('span', 'event-title'), event.title, query), highlight(el('div', 'detail'), event.detail, query));
  const t = el('time', '', new Date(event.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })); t.dateTime = event.time;
  t.title = new Date(event.time).toLocaleString('zh-CN'); if (withDate) t.prepend(el('small', 'event-date', dateLabel(event.time)));
  row.append(badge, body, t); row.addEventListener('click', () => showDetail(event)); return row;
}
function renderHistory(preserveScroll = false) {
  const list = filteredEvents();
  const query = $('event-search').value;
  const signature = JSON.stringify([list, limit, query, M.dateKey(new Date())]);
  const candidates = M.filterEvents(displayedEvents || [], { range: $('range').value, query, day: $('day').value });
  document.querySelectorAll('[data-filter]').forEach(button => {
    const type = button.dataset.filter, active = type === filter;
    button.querySelector('small').textContent = type === 'all' ? candidates.length : candidates.filter(event => event.type === type).length;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  const summary = [$('day').value || {all:'全部时间',today:'今天',week:'最近 7 天'}[$('range').value], filter === 'all' ? '' : M.TYPES[filter], $('event-search').value.trim() ? `“${$('event-search').value.trim()}”` : ''].filter(Boolean);
  $('filter-summary').textContent = summary.join(' · ');
  $('reset').disabled = filter === 'all' && $('range').value === 'all' && !$('day').value && !$('event-search').value;
  const displayedKeys = new Set((displayedEvents || []).map(eventKey));
  const latestMatching = M.filterEvents(state.events, { type: filter, range: $('range').value, query: $('event-search').value, day: $('day').value });
  const additions = latestMatching.filter(e => !displayedKeys.has(eventKey(e))).length;
  const globalAdditions = state.events.filter(e => !displayedKeys.has(eventKey(e))).length;
  const changed = JSON.stringify(state.events) !== JSON.stringify(displayedEvents || []);
  $('new-events').hidden = !changed;
  $('new-events').querySelector('span').textContent = additions ? `${additions} 条新记录` : globalAdditions ? '其他分类有新记录' : '记录已更新';
  $('result-count').textContent = `${list.length} 条记录`;
  $('shown-count').textContent = list.length ? `显示 ${Math.min(limit, list.length)} / ${list.length}` : '';
  $('more').hidden = list.length <= limit;
  if (signature === historySignature) return;
  const anchor = preserveScroll ? [...$('history').querySelectorAll('.event')].find(e => e.getBoundingClientRect().top >= 0 && e.getBoundingClientRect().top < innerHeight) : null;
  const anchorKey = anchor?.dataset.key, anchorTop = anchor?.getBoundingClientRect().top;
  historySignature = signature; $('history').replaceChildren();
  if (!list.length) { const box = empty(state.events.length ? '没有符合当前条件的记录' : '尚未记录到变化'); if (!$('reset').disabled) { const clear = el('button', '', '清除筛选'); clear.addEventListener('click', resetFilters); box.append(clear); } $('history').append(box); return; }
  const dayCounts = new Map(); list.forEach(e => { const key = M.dateKey(e.time); dayCounts.set(key, (dayCounts.get(key) || 0) + 1); });
  let previousDay = '';
  for (const event of list.slice(0, limit)) {
    const day = M.dateKey(event.time);
    if (day !== previousDay) { const h = el('div', 'day-label', day === M.dateKey(new Date()) ? '今天' : new Date(event.time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })); h.append(el('span', '', `${dayCounts.get(day)} 条`)); $('history').append(h); previousDay = day; }
    $('history').append(eventRow(event, query));
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
  if (Number.isInteger(canvas.activeIndex)) {
    const [sx, sy] = pos(points[canvas.activeIndex]);
    c.strokeStyle = '#718795'; c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(sx, 0); c.lineTo(sx, h); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#fff'; c.beginPath(); c.arc(sx, sy, 4, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#397e5b'; c.lineWidth = 2; c.stroke();
    const tooltip = canvas.nextElementSibling;
    tooltip.style.left = `${Math.max(0, Math.min(w - tooltip.offsetWidth, sx - tooltip.offsetWidth / 2))}px`;
  }
}
function sparkChart(points, drive) {
  const wrap = el('div', 'spark-wrap'), canvas = el('canvas', 'spark'), tooltip = el('div', 'spark-tooltip');
  canvas.points = points; canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${drive.id} 可用空间趋势，共 ${points.length} 次采样，净变化 ${M.formatDelta(points.at(-1).free - points[0].free)}`);
  tooltip.id = `sample-${drive.id.replace(/[^a-z0-9]/gi, '')}`; tooltip.setAttribute('role', 'tooltip'); tooltip.hidden = true; canvas.setAttribute('aria-describedby', tooltip.id);
  const show = index => {
    canvas.activeIndex = index; const p = points[index];
    tooltip.replaceChildren(el('span', '', new Date(p.time).toLocaleString('zh-CN')), el('strong', '', `可用 ${fmt(p.free)}`)); tooltip.hidden = false;
    drawSpark(canvas);
  };
  const clear = () => { if (document.activeElement === canvas) return; canvas.activeIndex = null; tooltip.hidden = true; drawSpark(canvas); };
  canvas.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); show(M.nearestSample(points, (e.clientX - r.left - 4) / Math.max(1, r.width - 8))); });
  canvas.addEventListener('pointerleave', clear); canvas.addEventListener('focus', () => show(points.length - 1)); canvas.addEventListener('blur', clear);
  canvas.addEventListener('keydown', e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const current = canvas.activeIndex ?? points.length - 1; show(e.key === 'Home' ? 0 : e.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, current + (e.key === 'ArrowRight' ? 1 : -1)))); });
  wrap.append(canvas, tooltip); return wrap;
}
function renderDrives() {
  const drives = state.snapshot?.drives || [], samples = state.samples || [];
  const signature = JSON.stringify([drives, samples, state.settings?.intervalSeconds, Math.floor(Date.now() / 60000)]); if (signature === drivesSignature) return; drivesSignature = signature;
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
      const delta = points.at(-1).free - points[0].free; row.append(sparkChart(points, d));
      const caption = el('div', 'trend-caption'); caption.append(el('span', '', `${clock(points[0].time).slice(0, 5)} — ${clock(points.at(-1).time).slice(0, 5)}`), el('span', delta > 0 ? 'up' : delta < 0 ? 'down' : '', M.formatDelta(delta))); row.append(caption);
    }
    $('drives').append(row);
  }
  requestAnimationFrame(() => document.querySelectorAll('.spark').forEach(drawSpark));
}
function renderWeek() {
  const today = state.events.filter(e => M.dateKey(e.time) === M.dateKey(new Date()) && e.type !== 'system');
  const days = M.weekCounts(state.events, new Date(), state.startedAt); const signature = JSON.stringify([today, days]); if (signature === weekSignature) return; weekSignature = signature;
  $('week').replaceChildren(); const max = Math.max(1, ...days.map(d => d.count));
  for (const d of days) { const b = el('button', `day-bar${d.tracked ? '' : ' untracked'}`); b.title = d.tracked ? `${d.day}：${d.count} 项已记录变化` : `${d.day}：尚未开始记录`; b.disabled = !d.tracked; b.setAttribute('aria-label', b.title); const track = el('span', 'bar-track'), fill = el('span', 'bar-fill'); fill.style.height = d.tracked ? `${Math.max(3, d.count / max * 88)}px` : '0px'; track.append(fill); b.append(el('small', '', d.tracked ? d.count : '—'), track, el('span', '', d.label)); b.addEventListener('click', () => { resetFilters(false); $('day').value = d.day; scrollPositions.timeline = 0; displayedEvents = state.events; location.hash = 'timeline'; renderHistory(); icons(); }); $('week').append(b); }
  $('breakdown').replaceChildren();
  for (const [type, ico] of [['usb', 'usb'], ['software', 'app-window'], ['disk', 'hard-drive']]) { const r = el('div', 'breakdown-row'), label = el('span'); label.append(icon(ico), el('span', '', `今日${M.TYPES[type]}变化`)); r.append(label, el('strong', '', today.filter(e => e.type === type).length)); $('breakdown').append(r); }
}
function selectInventory(kind, focus = false) {
  inventoryQueries[inventoryKind] = $('search').value;
  if (inventoryKind !== kind) inventoryLimit = 80;
  inventoryKind = kind; $('search').value = inventoryQueries[kind];
  document.querySelectorAll('[data-inventory]').forEach(tab => { const active = tab.dataset.inventory === kind; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; if (active && focus) tab.focus(); });
  $('inventory-panel').setAttribute('aria-labelledby', `${kind}-tab`); $('usb-list').hidden = kind !== 'usb'; $('apps-list').hidden = kind !== 'software';
  $('search').placeholder = kind === 'usb' ? '搜索设备名称或类别' : '搜索软件名称或版本'; $('search').setAttribute('aria-label', kind === 'usb' ? '搜索 USB 设备' : '搜索软件');
  $('inventory-title').textContent = kind === 'usb' ? '当前 USB 设备' : '软件登记列表'; $('inventory-note').textContent = kind === 'usb' ? '接口登记数量不等于物理设备数量。' : '来自 Windows 软件卸载登记，不含所有便携应用和商店应用。';
  if (state) { renderInventory(); icons(); }
}
function renderInventory() {
  const source = state.snapshot?.[inventoryKind] || [], query = $('search').value;
  const items = M.filterInventory(source, query).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const usb = inventoryKind === 'usb', target = $(usb ? 'usb-list' : 'apps-list');
  $('usb-total').textContent = state.snapshot ? state.snapshot.usb.length : '—'; $('software-total').textContent = state.snapshot ? state.snapshot.software.length : '—';
  $('inventory-summary').textContent = `${query.trim() ? `匹配 ${items.length} / ` : ''}${source.length} 项${usb ? '接口' : '软件'}登记`;
  $('apps-more').hidden = items.length <= inventoryLimit; $('apps-shown').textContent = items.length ? `显示 ${Math.min(inventoryLimit, items.length)} / ${items.length}` : '';
  const signature = JSON.stringify([items, inventoryLimit, query, !!state.snapshot, state.snapshot?.warnings]); if (signature === (usb ? usbSignature : appsSignature)) return;
  if (usb) usbSignature = signature; else appsSignature = signature;
  target.replaceChildren();
  if (!items.length) {
    const failed = state.snapshot?.warnings?.includes(inventoryKind);
    const box = empty(query.trim() ? '没有符合条件的登记' : failed ? '本次读取未完成，请稍后重试' : !state.snapshot ? '等待首次采集' : usb ? '当前没有 USB 接口登记' : '当前没有软件登记', query.trim() ? 'search' : usb ? 'usb' : 'app-window');
    if (query.trim()) { const clear = el('button', '', '清除搜索'); clear.addEventListener('click', () => { $('search').value = ''; inventoryQueries[inventoryKind] = ''; renderInventory(); icons(); $('search').focus(); }); box.append(clear); }
    target.append(box); return;
  }
  for (const item of items.slice(0, inventoryLimit)) {
    const row = el('div', `inventory-row ${usb ? 'usb-item' : 'software-item'}`), badge = el('span', 'badge'), body = el('div', 'inventory-body'); badge.append(icon(usb ? 'usb' : 'app-window'));
    body.append(highlight(el('span', 'inventory-name'), item.name || '未命名设备', query));
    if (usb) body.append(highlight(el('div', `device-status${item.status && item.status !== 'OK' ? ' warn' : ''}`), item.status === 'OK' ? '系统状态正常' : item.status || '未提供状态', query));
    row.append(badge, body, highlight(el('small', 'inventory-value'), item.version || (usb ? '未提供类别' : '未提供版本'), query)); target.append(row);
  }
}
function render() {
  const s = state.snapshot, today = state.events.filter(e => M.dateKey(e.time) === M.dateKey(new Date()) && e.type !== 'system');
  $('date').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  $('count').textContent = s ? today.length : '—'; $('count-detail').textContent = s ? '已记录的设备、软件与磁盘变化' : '等待建立基准'; $('nav-count').textContent = state.events.length;
  $('usb-count').textContent = s ? s.usb.length : '—'; $('apps-count').textContent = s ? s.software.length : '—'; $('scan').textContent = s ? clock(s.time) : '等待采集';
  $('status').textContent = stopped ? '已停止记录' : !connected ? '上次采集的数据' : state.busy ? '正在采集…' : state.paused ? '自动记录已暂停' : state.error ? '上次采集未完成' : `每 ${state.settings?.intervalSeconds || 60} 秒检查`;
  const pauseLabel = state.paused ? '继续记录' : '暂停记录';
  if ($('pause').textContent !== pauseLabel) { $('pause').replaceChildren(icon(state.paused ? 'play' : 'pause'), el('span', '', pauseLabel)); }
  $('refresh').querySelector('span').textContent = state.busy || pendingActions.has('refresh') ? '检查中' : connected ? '立即检查' : '重新连接'; $('export').disabled = !s;
  const warnings = [state.error, state.recoveryNotice, ...(s?.warnings || []).map(x => `${{ disk: '磁盘', usb: 'USB', software: '软件' }[x]}读取失败，本次跳过该类比较。`)].filter(Boolean);
  $('notice').hidden = !stopped && connected && !warnings.length; $('notice').textContent = stopped ? '本地服务已停止。' : !connected ? '本地服务暂时无法连接，当前显示的是之前的数据。' : warnings.join(' ');
  $('side-status').textContent = stopped ? '已停止' : !connected ? '连接中断' : warnings.length ? '采集需要留意' : state.paused ? '记录已暂停' : state.busy ? '正在检查' : '正在记录'; $('side-dot').className = `status-dot${!connected || warnings.length ? ' error' : stopped || state.paused ? ' paused' : ''}`;
  if (currentView === 'overview') {
    renderDrives(); renderWeek();
    const recent = state.events.slice(0, 5), signature = JSON.stringify([recent, M.dateKey(new Date())]); if (signature !== recentSignature) { recentSignature = signature; $('recent').replaceChildren(); if (!recent.length) $('recent').append(empty('尚未记录到变化')); for (const e of recent) $('recent').append(eventRow(e, '', true)); }
  } else if (currentView === 'timeline') renderHistory(true);
  else if (currentView === 'devices') renderInventory();
  $('footer').textContent = state.paused ? '记录已暂停 · 历史仍保留' : s ? `最近检查 ${new Date(s.time).toLocaleString('zh-CN')}` : '准备建立基准'; $('version').textContent = state.version || '0.4.0';
  $('stop').querySelector('span').textContent = state.desktop ? '退出软件' : '停止本地服务';
  $('storage-help').textContent = state.desktop ? '历史保存在 %APPDATA%\\PC Timeline\\data。安装版和便携版共用当前用户的记录；清除前先退出软件，再删除该目录。' : '历史保存在项目的 data/timeline.json。清除前先停止服务，再删除 data 目录；该目录不加入 Git。';
  $('retention-help').textContent = '最多保存 2,000 条事件和 1,440 个磁盘采样点，达到上限后移除最早记录。更新软件不会主动清空历史。';
  $('started-at').textContent = state.startedAt ? new Date(state.startedAt).toLocaleString('zh-CN') : '尚未建立基准'; $('saved-count').textContent = `${state.events.length} / 2,000`; $('samples-count').textContent = `${state.samples?.length || 0} / 1,440`;
  if (currentView === 'privacy') syncSettings();
  renderControls();
  icons();
}
function syncSettings(force = false) {
  if (force || !settingsDirty && !saving) { for (const [id, value] of [['interval', state?.settings?.intervalSeconds || 60], ['threshold', state?.settings?.diskThresholdMiB || 256]]) { if (![...$(id).options].some(o => +o.value === value)) $(id).append(new Option(`${value}${id === 'interval' ? ' 秒' : ' MiB'}`, value)); $(id).value = value; } }
  settingsDirty = !!state && (+$('interval').value !== state.settings.intervalSeconds || +$('threshold').value !== state.settings.diskThresholdMiB);
  $('settings-state').textContent = saving ? '正在保存…' : settingsDirty ? '有未保存更改' : '已保存';
  $('settings-state').classList.toggle('dirty', settingsDirty);
  $('interval').disabled = saving; $('threshold').disabled = saving;
  $('save-settings').disabled = !connected || saving || !settingsDirty;
  $('undo-settings').disabled = saving || !settingsDirty;
}
function renderControls() {
  $('pause').disabled = !connected || !state || pendingActions.has('pause') || stopped;
  $('refresh').disabled = pendingActions.has('refresh') || connected && !!state?.busy || stopped;
  const checking = pendingActions.has('refresh') || connected && !!state?.busy;
  $('refresh').classList.toggle('is-busy', checking); $('refresh').setAttribute('aria-busy', String(checking));
  $('refresh').querySelector('span').textContent = checking ? '检查中' : connected ? '立即检查' : '重新连接';
  for (const id of ['today-link', 'usb-link', 'software-link']) $(id).disabled = !state?.snapshot;
  if (currentView === 'privacy') syncSettings();
}
async function load() {
  if (stopped) return; if (loadPromise) return loadPromise;
  const epoch = mutationEpoch; let repeat = false;
  const task = (async () => {
    try {
      const response = await fetch('/api/state', { signal: AbortSignal.timeout(8000) }); if (!response.ok) throw Error(); const data = await response.json();
      if (epoch !== mutationEpoch) { repeat = true; return; }
      state = data; connected = true;
      if (displayedEvents === null) displayedEvents = data.events;
      render();
    } catch {
      if (epoch !== mutationEpoch) { repeat = true; return; }
      connected = false;
      if (state) render();
      else { $('notice').hidden = false; $('notice').textContent = '本地服务暂时无法连接，请点击“重新连接”。'; $('side-status').textContent = '连接中断'; $('side-dot').className = 'status-dot error'; $('refresh').querySelector('span').textContent = '重新连接'; renderControls(); }
    }
  })();
  loadPromise = task;
  try { await task; } finally { if (loadPromise === task) loadPromise = null; if (repeat && !stopped) queueMicrotask(() => void load()); }
}
async function post(name, body) {
  let r; try { r = await fetch(`/api/${name}`, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'X-Timeline-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw Error('本地服务无法连接，稍后重试或重新打开软件。'); }
  let result; try { result = await r.json(); } catch { throw Error('本地服务返回了无法读取的内容，请重新打开软件。'); }
  if (!r.ok) throw Error(result.error || '操作未完成，请稍后重试。'); return result;
}
async function action(name) {
  if (pendingActions.has(name) || stopped) return;
  pendingActions.add(name); mutationEpoch++; renderControls();
  try { if (name === 'refresh' && !connected) await load(); else { const result = await post(name); mutationEpoch++; if (state && name === 'pause') { state.paused = result.paused; render(); } await load(); } }
  catch (e) { toast(e.message, true); }
  finally { pendingActions.delete(name); renderControls(); }
}
function resetFilters(update = true) { filter = 'all'; limit = 60; $('range').value = 'all'; $('day').value = ''; $('event-search').value = ''; document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active', b.dataset.filter === 'all'); b.setAttribute('aria-pressed', String(b.dataset.filter === 'all')); }); if (update && state) { renderHistory(); icons(); } }
document.querySelectorAll('[data-view]').forEach(e => e.addEventListener('click', () => { location.hash = e.dataset.view; }));
document.querySelectorAll('[data-filter]').forEach(e => e.addEventListener('click', () => { filter = e.dataset.filter; limit = 60; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === e)); if (state) { renderHistory(); icons(); } }));
for (const id of ['event-search', 'range', 'day']) $(id).addEventListener(id === 'event-search' ? 'input' : 'change', () => { if (id === 'range') $('day').value = ''; if (id === 'day' && $('day').value) $('range').value = 'all'; limit = 60; if (state) { renderHistory(); icons(); } });
$('reset').addEventListener('click', () => resetFilters());
$('new-events').addEventListener('click', () => { displayedEvents = state.events; limit = 60; renderHistory(); icons(); window.scrollTo(0, 0); });
$('more').addEventListener('click', () => { limit += 60; renderHistory(); icons(); });
document.querySelectorAll('[data-density]').forEach(button => button.addEventListener('click', () => {
  $('history').classList.toggle('compact-list', button.dataset.density === 'compact');
  document.querySelectorAll('[data-density]').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
}));
$('search').addEventListener('input', () => { inventoryLimit = 80; inventoryQueries[inventoryKind] = $('search').value; if (state) { renderInventory(); icons(); } });
$('apps-more').addEventListener('click', () => { inventoryLimit += 80; renderInventory(); icons(); });
document.querySelectorAll('[data-inventory]').forEach(tab => {
  tab.addEventListener('click', () => selectInventory(tab.dataset.inventory));
  tab.addEventListener('keydown', e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); selectInventory(e.key === 'Home' ? 'usb' : e.key === 'End' ? 'software' : inventoryKind === 'usb' ? 'software' : 'usb', true); });
});
$('today-link').addEventListener('click', () => { resetFilters(false); $('range').value = 'today'; displayedEvents = state.events; scrollPositions.timeline = 0; location.hash = 'timeline'; });
for (const kind of ['usb', 'software']) $(`${kind}-link`).addEventListener('click', () => { selectInventory(kind); scrollPositions.devices = 0; location.hash = 'devices'; });
$('pause').addEventListener('click', () => action('pause')); $('refresh').addEventListener('click', () => action('refresh'));
$('close-detail').addEventListener('click', () => $('detail-dialog').close()); $('detail-dialog').addEventListener('click', e => { if (e.target === $('detail-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
$('detail-dialog').addEventListener('close', () => { selectedKey = null; document.querySelectorAll('.event').forEach(e => { e.classList.remove('selected'); e.setAttribute('aria-expanded', 'false'); }); if (state && currentView !== 'timeline') render(); });
$('previous-detail').addEventListener('click', () => navigateDetail(-1)); $('next-detail').addEventListener('click', () => navigateDetail(1));
$('detail-dialog').addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); navigateDetail(e.key === 'ArrowLeft' ? -1 : 1); } });
for (const id of ['interval', 'threshold']) $(id).addEventListener('change', () => { settingsDirty = true; syncSettings(); });
$('undo-settings').addEventListener('click', () => { settingsDirty = false; syncSettings(true); });
$('settings-form').addEventListener('submit', async e => { e.preventDefault(); if (saving || !settingsDirty || !connected) return; saving = true; mutationEpoch++; syncSettings(); try { const result = await post('settings', { intervalSeconds: +$('interval').value, diskThresholdMiB: +$('threshold').value }); mutationEpoch++; state.settings = result.settings; settingsDirty = false; syncSettings(true); toast('设置已保存，下次自动检查按新间隔进行。'); await load(); } catch (error) { toast(error.message, true); } finally { saving = false; syncSettings(); } });
$('export').addEventListener('click', () => {
  if (!state?.snapshot) return; const c = document.createElement('canvas'); c.width = 1080; c.height = 720; const x = c.getContext('2d'), today = state.events.filter(e => M.dateKey(e.time) === M.dateKey(new Date()) && e.type !== 'system');
  x.fillStyle = '#f6f8fa'; x.fillRect(0, 0, 1080, 720); x.fillStyle = '#2e4a3e'; x.font = 'bold 46px "Microsoft YaHei",sans-serif'; x.fillText('今天，电脑发生了什么？', 72, 106); x.fillStyle = '#8a9ca6'; x.font = '24px "Microsoft YaHei",sans-serif'; x.fillText(new Date().toLocaleDateString('zh-CN'), 72, 162); x.fillStyle = '#397e5b'; x.font = 'bold 90px sans-serif'; x.fillText(String(today.length), 72, 290); x.font = '24px "Microsoft YaHei",sans-serif'; x.fillText('项已记录变化', 72, 340);
  ['usb', 'software', 'disk'].forEach((type, i) => { x.fillStyle = '#7b8f9d'; x.font = '24px "Microsoft YaHei",sans-serif'; x.fillText(`${M.TYPES[type]} ${today.filter(e => e.type === type).length}`, 72 + i * 250, 395); });
  state.snapshot.drives.slice(0, 3).forEach((d, i) => { x.fillStyle = '#617987'; x.font = '23px "Microsoft YaHei",sans-serif'; x.fillText(`${d.id}    可用 ${fmt(d.free)} / ${fmt(d.total)}`, 72, 462 + i * 45); }); x.fillStyle = '#97a5ae'; x.font = '19px "Microsoft YaHei",sans-serif'; x.fillText('电脑时光机 · 仅统计运行后记录 · 不含名称和私人路径', 72, 664);
  c.toBlob(blob => { if (!blob) { toast('日报图片生成失败。', true); return; } const url = URL.createObjectURL(blob), a = el('a'); a.href = url; a.download = `PC-Timeline-${M.dateKey(new Date())}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); });
});
$('stop').addEventListener('click', async () => { if (!confirm(state?.desktop ? '退出软件后不再记录。确定退出？' : '停止后不再记录。下次双击 Start.cmd 重新打开。确定停止？')) return; try { await post('stop'); stopped = true; mutationEpoch++; clearInterval(poll); renderControls(); $('notice').hidden = false; $('notice').textContent = '本地服务已停止。'; } catch { toast('停止未完成，可直接关闭软件窗口。', true); } });
window.addEventListener('hashchange', view); window.addEventListener('resize', () => { document.querySelectorAll('.spark').forEach(drawSpark); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { $('date').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }); void load(); } });
$('date').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
view(); renderControls(); void load(); const poll = setInterval(() => { if (!document.hidden) void load(); }, 3000);

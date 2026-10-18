(function (root) {
  const TYPES = { disk: '磁盘', usb: 'USB', software: '软件', system: '系统' };
  const dateKey = date => { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const queryTerms = query => query.trim().split(/\s+/).filter(Boolean);
  function matchesQuery(text, query) { const lower = text.toLocaleLowerCase(); return queryTerms(query).every(term => lower.includes(term.toLocaleLowerCase())); }
  function searchSegments(text, query) {
    const terms = [...new Set(queryTerms(query))].sort((a, b) => b.length - a.length);
    if (!terms.length) return [{ text, match: false }];
    // Treat query punctuation literally; return text for safe DOM construction.
    const pattern = new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
    const segments = []; let end = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > end) segments.push({ text: text.slice(end, match.index), match: false });
      segments.push({ text: match[0], match: true }); end = match.index + match[0].length;
    }
    if (end < text.length) segments.push({ text: text.slice(end), match: false });
    return segments;
  }
  function filterEvents(events, { type = 'all', range = 'all', query = '', day = '' } = {}, now = new Date()) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const week = new Date(today); week.setDate(week.getDate() - 6);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    return events.filter(e => (type === 'all' || e.type === type) && (day ? dateKey(e.time) === day : (range !== 'today' || (new Date(e.time) >= today && new Date(e.time) < tomorrow)) && (range !== 'week' || (new Date(e.time) >= week && new Date(e.time) < tomorrow))) && matchesQuery(`${e.title} ${e.detail}`, query));
  }
  function weekCounts(events, now = new Date(), startedAt = null) {
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - 6 + i); const key = dateKey(d); return { day: key, label: i === 6 ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`, tracked: !startedAt || key >= dateKey(startedAt), count: events.filter(e => dateKey(e.time) === key && e.type !== 'system').length }; });
  }
  function diskSeries(samples, id, since = 0) { return samples.filter(s => Date.parse(s.time) >= since && s.drives.some(d => d.id === id)).map(s => ({ time: s.time, free: s.drives.find(d => d.id === id).free })).sort((a, b) => Date.parse(a.time) - Date.parse(b.time)); }
  function formatDelta(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes === 0) return '无净变化';
    const magnitude = Math.abs(bytes);
    const unit = magnitude >= 1024 ** 3 ? 'GB' : magnitude >= 1024 ** 2 ? 'MiB' : magnitude >= 1024 ? 'KiB' : 'B';
    const divisor = { GB: 1024 ** 3, MiB: 1024 ** 2, KiB: 1024, B: 1 }[unit];
    return `${bytes > 0 ? '+' : '-'}${(magnitude / divisor).toFixed(unit === 'B' ? 0 : 1)} ${unit}`;
  }
  function nearestSample(points, fraction) {
    if (!points.length) return -1;
    const first = Date.parse(points[0].time), last = Date.parse(points.at(-1).time);
    const target = first + Math.max(0, Math.min(1, fraction)) * (last - first);
    let index = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(Date.parse(points[i].time) - target) < Math.abs(Date.parse(points[index].time) - target)) index = i;
    return index;
  }
  function filterInventory(items, query = '') {
    return items.filter(item => matchesQuery(`${item.name} ${item.version || ''} ${item.status || ''}`, query));
  }
  const api = { TYPES, dateKey, filterEvents, weekCounts, diskSeries, formatDelta, nearestSample, filterInventory, searchSegments };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimelineModel = api;
})(typeof window !== 'undefined' ? window : globalThis);

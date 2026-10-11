(function (root) {
  const TYPES = { disk: '磁盘', usb: 'USB', software: '软件', system: '系统' };
  const dateKey = date => { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function filterEvents(events, { type = 'all', range = 'all', query = '', day = '' } = {}, now = new Date()) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const week = new Date(today); week.setDate(week.getDate() - 6);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const q = query.trim().toLocaleLowerCase();
    return events.filter(e => (type === 'all' || e.type === type) && (range !== 'today' || (new Date(e.time) >= today && new Date(e.time) < tomorrow)) && (range !== 'week' || (new Date(e.time) >= week && new Date(e.time) < tomorrow)) && (!day || dateKey(e.time) === day) && (!q || `${e.title} ${e.detail}`.toLocaleLowerCase().includes(q)));
  }
  function weekCounts(events, now = new Date()) {
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - 6 + i); const key = dateKey(d); return { day: key, label: i === 6 ? '今天' : `${d.getMonth() + 1}/${d.getDate()}`, count: events.filter(e => dateKey(e.time) === key && e.type !== 'system').length }; });
  }
  function diskSeries(samples, id, since = 0) { return samples.filter(s => Date.parse(s.time) >= since && s.drives.some(d => d.id === id)).map(s => ({ time: s.time, free: s.drives.find(d => d.id === id).free })).sort((a, b) => Date.parse(a.time) - Date.parse(b.time)); }
  const api = { TYPES, dateKey, filterEvents, weekCounts, diskSeries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimelineModel = api;
})(typeof window !== 'undefined' ? window : globalThis);

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const run = require('node:util').promisify(require('node:child_process').execFile);
const DEFAULTS = { intervalSeconds: 60, diskThresholdMiB: 256 };
const EVENT_LIMIT = 2000;
const SAMPLE_LIMIT = 1440;

function diff(old, now, threshold = DEFAULTS.diskThresholdMiB * 1024 ** 2) {
  const events = [];
  const add = (type, title, detail, comparison = []) => events.push({ id: randomUUID(), type, title, detail, comparison, time: now.time });
  if (!old) {
    add('system', '开始记录这台电脑', '首次采集建立基准，不推测此前的历史。');
    return events;
  }
  for (const [key, type, label] of [['usb', 'usb', 'USB'], ['software', 'software', '软件']]) {
    if (old.warnings.includes(type) || now.warnings.includes(type)) continue;
    const before = new Map(old[key].map(x => [x.id, x]));
    const after = new Map(now[key].map(x => [x.id, x]));
    for (const [id, item] of after) {
      const previous = before.get(id);
      if (!previous) add(type, `${label}${type === 'usb' ? '接入' : '新增登记'}：${item.name || '未命名'}`, item.version || '未提供版本', [{ label: type === 'usb' ? '连接状态' : '软件登记', before: '未在列表中', after: type === 'usb' ? '已连接' : item.version || '已登记' }]);
      else if (type === 'software' && item.version !== previous.version) add(type, `软件版本变化：${item.name}`, `${previous.version || '未知'} → ${item.version || '未知'}`, [{ label: '版本', before: previous.version || '未知', after: item.version || '未知' }]);
      else if (type === 'usb' && item.status !== previous.status) add(type, `USB 状态变化：${item.name || '未命名'}`, `${previous.status || '未知'} → ${item.status || '未知'}`, [{ label: '系统状态', before: previous.status || '未知', after: item.status || '未知' }]);
    }
    for (const [id, item] of before) if (!after.has(id)) add(type, `${label}${type === 'usb' ? '移除' : '登记移除'}：${item.name || '未命名'}`, '本次采集已不在列表中。', [{ label: type === 'usb' ? '连接状态' : '软件登记', before: type === 'usb' ? '已连接' : item.version || '已登记', after: '未在列表中' }]);
  }
  if (!old.warnings.includes('disk') && !now.warnings.includes('disk')) for (const d of now.drives) {
    const previous = old.drives.find(x => x.id === d.id);
    if (previous && Math.abs(d.free - previous.free) >= threshold) add('disk', `${d.id} 可用空间${d.free > previous.free ? '增加' : '减少'}`, `${(Math.abs(d.free - previous.free) / 1024 ** 3).toFixed(2)} GB；未定位具体文件。`, [{ label: '可用空间', before: previous.free, after: d.free, format: 'bytes' }]);
  }
  return events;
}
function valid(s) {
  return !!(s && typeof s.time === 'string' && Number.isFinite(Date.parse(s.time)) && ['drives', 'usb', 'software', 'warnings'].every(k => Array.isArray(s[k])) && s.drives.every(d => d && typeof d.id === 'string' && Number.isFinite(d.total) && d.total >= 0 && Number.isFinite(d.free) && d.free >= 0 && d.free <= d.total) && ['usb', 'software'].every(k => s[k].every(x => x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.version === 'string')) && s.warnings.every(w => ['disk', 'usb', 'software'].includes(w)));
}
function validSettings(s) {
  return !!(s && Object.keys(s).length === 2 && Number.isInteger(s.intervalSeconds) && s.intervalSeconds >= 30 && s.intervalSeconds <= 300 && Number.isInteger(s.diskThresholdMiB) && s.diskThresholdMiB >= 64 && s.diskThresholdMiB <= 2048);
}
function validHistory(x) {
  return !!(x && (!x.snapshot || valid(x.snapshot)) && typeof x.paused === 'boolean' && Array.isArray(x.events) && x.events.every(e => e && ['usb', 'software', 'disk', 'system'].includes(e.type) && typeof e.title === 'string' && typeof e.detail === 'string' && Number.isFinite(Date.parse(e.time))));
}
function migrate(x) {
  if (!validHistory(x)) throw Error('Invalid history');
  return {
    snapshot: x.snapshot || null,
    paused: x.paused,
    settings: validSettings(x.settings) ? x.settings : { ...DEFAULTS },
    startedAt: Number.isFinite(Date.parse(x.startedAt)) ? x.startedAt : x.events.at(-1)?.time || x.snapshot?.time || null,
    events: x.events.slice(0, EVENT_LIMIT).map((e, i) => ({ ...e, id: typeof e.id === 'string' ? e.id : createHash('sha256').update(JSON.stringify([e.time, e.title, e.detail, i])).digest('hex'), comparison: Array.isArray(e.comparison) ? e.comparison.filter(c => c && typeof c.label === 'string' && ['string', 'number'].includes(typeof c.before) && ['string', 'number'].includes(typeof c.after)).slice(0, 8) : [] })),
    samples: Array.isArray(x.samples) ? x.samples.filter(s => s && Number.isFinite(Date.parse(s.time)) && Array.isArray(s.drives) && valid({time:s.time, drives:s.drives, usb:[], software:[], warnings:[]})).slice(-SAMPLE_LIMIT) : []
  };
}
async function readJSON(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(Error('请使用 JSON 请求。'), { status: 415 });
  const chunks = [];
  let size = 0, oversized = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) oversized = true;
    else chunks.push(chunk);
  }
  if (oversized) throw Object.assign(Error('请求内容过大。'), { status: 413 });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(Error('请求内容不是有效 JSON。'), { status: 400 }); }
}
function start(options = {}) {
  const dir = options.dataDir || path.join(__dirname, 'data');
  const file = path.join(dir, 'timeline.json');
  fs.mkdirSync(dir, { recursive: true });
  let db = migrate({ snapshot: null, events: [], paused: false });
  let busy = false, error = '', recoveryNotice = '', lastAttempt = null, nextScanAt = Date.now(), closed = false;
  if (fs.existsSync(file)) try { db = migrate(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { fs.copyFileSync(file, `${file}.backup-${Date.now()}`); recoveryNotice = '历史文件无法读取，已保留备份。本次重新建立基准。'; }
  const save = candidate => {
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(candidate));
    fs.renameSync(`${file}.tmp`, file);
    db = candidate;
  };
  async function collect() {
    if (busy || closed) return;
    busy = true;
    lastAttempt = new Date().toISOString();
    try {
      let s;
      if (options.collector) s = await options.collector();
      else {
        if (process.platform !== 'win32') throw Error('采集器仅支持 Windows');
        const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', options.collectorPath || path.join(__dirname, 'collector.ps1')], { windowsHide: true, timeout: 45000, maxBuffer: 8 * 1024 ** 2, encoding: 'utf8' });
        s = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
      }
      if (!valid(s)) throw Error('采集格式不正确');
      const events = [...diff(db.snapshot, s, db.settings.diskThresholdMiB * 1024 ** 2), ...db.events].slice(0, EVENT_LIMIT);
      const samples = s.warnings.includes('disk') ? db.samples : [...db.samples, { time: s.time, drives: s.drives }].slice(-SAMPLE_LIMIT);
      save({ ...db, snapshot: s, events, samples, startedAt: db.startedAt || s.time });
      error = '';
    } catch (e) { error = e.killed ? '采集超时，旧数据保留。' : '本次采集或保存未完成，旧记录仍保留，请稍后重试。'; }
    finally { busy = false; nextScanAt = Date.now() + db.settings.intervalSeconds * 1000; }
  }
  const server = http.createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== host) return json(403, { error: '只允许本机访问' });
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'GET' && url.pathname === '/api/state') return json(200, { ...db, busy, error, recoveryNotice, lastAttempt, nextScanAt: db.paused ? null : new Date(nextScanAt).toISOString(), desktop: !!options.desktop, version: '0.2.0' });
      if (req.method === 'POST') {
        if (req.headers.origin !== `http://${host}` || req.headers['x-timeline-request'] !== '1') return json(403, { error: '来源检查未通过' });
        if (url.pathname === '/api/refresh') { void collect(); return json(202, { ok: true }); }
        if (url.pathname === '/api/pause') { save({ ...db, paused: !db.paused }); nextScanAt = Date.now(); return json(200, { paused: db.paused }); }
        if (url.pathname === '/api/settings') {
          const settings = await readJSON(req);
          if (!validSettings(settings)) return json(400, { error: '检查间隔须为 30–300 秒，容量阈值须为 64–2048 MiB 的整数。' });
          save({ ...db, settings });
          nextScanAt = Date.now() + settings.intervalSeconds * 1000;
          return json(200, { settings });
        }
        if (url.pathname === '/api/stop') { json(200, { ok: true }); setImmediate(() => { server.close(); server.closeIdleConnections(); }); return; }
        return json(404, { error: '操作不存在' });
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/model.js': ['model.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/vendor/lucide.min.js': ['vendor/lucide.min.js', 'text/javascript'] };
      if (req.method !== 'GET' || !files[url.pathname]) return json(404, { error: '页面不存在' });
      const [name, mime] = files[url.pathname];
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'", 'Referrer-Policy': 'no-referrer' });
      res.end(fs.readFileSync(path.join(__dirname, 'public', name)));
    } catch (e) { if (!res.headersSent) json(e.status || 500, { error: e.status ? e.message : '请求未完成，旧记录保留。' }); else res.end(); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.on('error', e => { console.error(`启动失败：${e.code || '未知错误'}`); process.exitCode = 1; });
  server.listen(options.port ?? Number(process.env.PORT || 8790), '127.0.0.1', () => { if (!options.quiet) console.log(`电脑时光机：http://127.0.0.1:${server.address().port}`); if (options.autoCollect !== false && !db.paused) void collect(); });
  const timer = setInterval(() => { if (!closed && options.autoCollect !== false && !db.paused && Date.now() >= nextScanAt) void collect(); }, 1000);
  timer.unref();
  server.on('close', () => { closed = true; clearInterval(timer); options.onClose?.(); });
  return server;
}
if (require.main === module) start();
module.exports = { diff, valid, validSettings, validHistory, migrate, start };

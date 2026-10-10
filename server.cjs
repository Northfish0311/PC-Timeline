const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const run = promisify(require('node:child_process').execFile);
function diff(old, now) {
  const events = [];
  const add = (type, title, detail) => events.push({type, title, detail, time: now.time});
  if (!old) { add('system', '开始记录这台电脑', '首次采集建立基准，不推测此前的历史。'); return events; }
  for (const [key, type, label] of [['usb','usb','USB'], ['software','software','软件']]) {
    if (old.warnings.includes(type) || now.warnings.includes(type)) continue;
    const before = new Map(old[key].map(x => [x.id,x]));
    const after = new Map(now[key].map(x => [x.id,x]));
    for (const [id,x] of after) {
      if (!before.has(id)) add(type, `${label}${type === 'usb' ? '接入' : '新增登记'}：${x.name || '未命名'}`, x.version || '未提供版本');
      else if (type === 'software' && x.version !== before.get(id).version) add(type, `软件版本变化：${x.name}`, `${before.get(id).version || '未知'} → ${x.version || '未知'}`);
    }
    for (const [id,x] of before) if (!after.has(id)) add(type, `${label}${type === 'usb' ? '移除' : '登记移除'}：${x.name || '未命名'}`, '本次采集已不在列表中。');
  }
  if (!old.warnings.includes('disk') && !now.warnings.includes('disk')) for (const d of now.drives) {
    const p = old.drives.find(x => x.id === d.id);
    if (p && Math.abs(d.free-p.free) >= 256*1024**2) add('disk', `${d.id} 可用空间${d.free > p.free ? '增加' : '减少'}`, `${(Math.abs(d.free-p.free)/1024**3).toFixed(2)} GB；未定位具体文件。`);
  }
  return events;
}
function valid(s) {
  return !!(s && typeof s.time === 'string' && Number.isFinite(Date.parse(s.time)) && ['drives','usb','software','warnings'].every(k => Array.isArray(s[k])) && s.drives.every(d => d && typeof d.id === 'string' && Number.isFinite(d.total) && d.total >= 0 && Number.isFinite(d.free) && d.free >= 0 && d.free <= d.total) && ['usb','software'].every(k => s[k].every(x => x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.version === 'string')) && s.warnings.every(w => ['disk','usb','software'].includes(w)));
}
function validHistory(x) {
  return !!(x && (!x.snapshot || valid(x.snapshot)) && typeof x.paused === 'boolean' && Array.isArray(x.events) && x.events.every(e => e && ['usb','software','disk','system'].includes(e.type) && typeof e.title === 'string' && typeof e.detail === 'string' && Number.isFinite(Date.parse(e.time))));
}
function start(options = {}) {
  const dir = options.dataDir || path.join(__dirname,'data'); const file = path.join(dir,'timeline.json');
  fs.mkdirSync(dir,{recursive:true});
  let db = {snapshot:null, events:[], paused:false}; let busy = false; let error = '';
  if (fs.existsSync(file)) try { const x = JSON.parse(fs.readFileSync(file,'utf8')); if (validHistory(x)) db = {...x,events:x.events.slice(0,2000)}; else throw Error(); } catch { fs.copyFileSync(file,`${file}.backup-${Date.now()}`); error='历史文件损坏，已保留备份，重新建立基准。'; }
  const save = () => { fs.writeFileSync(`${file}.tmp`,JSON.stringify(db)); fs.renameSync(`${file}.tmp`,file); };
  async function collect() {
    if (busy) return; busy=true;
    try {
      if (process.platform !== 'win32') throw Error('采集器仅支持 Windows');
      const {stdout} = await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',options.collectorPath || path.join(__dirname,'collector.ps1')],{windowsHide:true,timeout:45000,maxBuffer:8*1024**2,encoding:'utf8'});
      const s = JSON.parse(stdout.replace(/^\uFEFF/,'').trim()); if (!valid(s)) throw Error('采集格式不正确');
      db.events = [...diff(db.snapshot,s),...db.events].slice(0,2000); db.snapshot=s; save(); error='';
    } catch(e) { error=e.killed ? '采集超时，旧数据保留。' : `采集未完成：${e.message.split('\n')[0].slice(0,140)}`; }
    finally { busy=false; }
  }
  const server = http.createServer((req,res) => {
    const json = (status,body) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(body)); };
    try {
      const host=`127.0.0.1:${server.address().port}`;
      if (req.headers.host !== host) return json(403,{error:'只允许本机访问'});
      const url=new URL(req.url,`http://${host}`);
      if (req.method === 'GET' && url.pathname === '/api/state') return json(200,{...db,busy,error,desktop:!!options.desktop});
      if (req.method === 'POST') {
        if (req.headers.origin !== `http://${host}` || req.headers['x-timeline-request'] !== '1') return json(403,{error:'来源检查未通过'});
        if (url.pathname === '/api/refresh') { void collect(); return json(202,{ok:true}); }
        if (url.pathname === '/api/pause') { db.paused=!db.paused; save(); return json(200,{paused:db.paused}); }
        if (url.pathname === '/api/stop') { json(200,{ok:true}); setImmediate(()=>{server.close();server.closeIdleConnections();}); return; }
        return json(404,{error:'操作不存在'});
      }
      const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
      if (req.method !== 'GET' || !files[url.pathname]) return json(404,{error:'页面不存在'});
      const [name,mime]=files[url.pathname];
      res.writeHead(200,{'Content-Type':`${mime}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});
      res.end(fs.readFileSync(path.join(__dirname,'public',name)));
    } catch { if (!res.headersSent) json(500,{error:'请求失败，旧数据保留'}); else res.end(); }
  });
  server.on('error',e=>{ console.error(`启动失败：${e.message}`); process.exitCode=1; });
  server.listen(options.port ?? Number(process.env.PORT || 8790),'127.0.0.1',()=>{ console.log(`电脑时光机：http://127.0.0.1:${server.address().port}`); if (options.autoCollect !== false && !db.paused) void collect(); });
  const timer=setInterval(()=>{ if (options.autoCollect !== false && !db.paused) void collect(); },60000); timer.unref(); server.on('close',()=>{clearInterval(timer);options.onClose?.();}); return server;
}
if (require.main === module) start();
module.exports={diff,valid,validHistory,start};

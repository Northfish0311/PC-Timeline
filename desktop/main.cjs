const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');
const { start } = require('../server.cjs');
app.setName('PC Timeline');
app.setPath('userData', path.join(app.getPath('appData'),'PC Timeline'));
let mainWindow;
let server;
let quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    server = start({ port: 0, desktop: true, dataDir: path.join(app.getPath('userData'),'data'), collectorPath: app.isPackaged ? path.join(process.resourcesPath,'collector.ps1') : path.join(__dirname,'../collector.ps1'), onClose: () => app.quit() });
    await new Promise((resolve,reject) => { server.once('listening',resolve); server.once('error',reject); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    mainWindow = new BrowserWindow({ width:1280,height:900,minWidth:760,minHeight:600,title:'电脑时光机',backgroundColor:'#f5f7f8',show:false,autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,devTools:!app.isPackaged} });
    mainWindow.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    mainWindow.webContents.on('will-navigate',(event,url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
    mainWindow.webContents.session.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
    mainWindow.once('ready-to-show',()=>mainWindow.show());
    await mainWindow.loadURL(origin);
  }).catch(error => { dialog.showErrorBox('电脑时光机启动失败',error.message); app.quit(); });
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',() => { if (quitting) return; quitting=true; if (server?.listening) { server.close(); server.closeIdleConnections(); } });
}

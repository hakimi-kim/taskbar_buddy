const { app, BrowserWindow, Tray, Menu, screen, powerMonitor, ipcMain, nativeImage } = require('electron');
const path = require('path');
const { tick, LIMIT } = require('./timer');

if (!app.requestSingleInstanceLock()) app.quit();

let win, tray;
let active = 0, paused = false, reminding = false;

// Start-with-Windows needs the app path as an arg when running unpackaged via electron.exe.
const loginOpts = { path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] };

// ponytail: primary display, bottom taskbar only; add left/top/right + multi-monitor when needed.
function sendLayout() {
  const { bounds: b, workArea: wa } = screen.getPrimaryDisplay();
  win.setBounds(b);
  const H = b.y + b.height - (wa.y + wa.height) || 48; // auto-hide taskbar reports 0
  win.webContents.send('layout', { W: b.width, SH: b.height, T: b.height - H, H });
}

function remind() {
  if (reminding) return;
  reminding = true;
  win.webContents.send('remind');
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/buddy.jpg')).resize({ height: 16 });
  tray = new Tray(icon);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Remind me now', click: remind },
    { label: 'Pause timer', type: 'checkbox', click: (i) => { paused = i.checked; } },
    {
      label: 'Start with Windows', type: 'checkbox',
      checked: app.getLoginItemSettings(loginOpts).openAtLogin,
      click: (i) => app.setLoginItemSettings({ ...loginOpts, openAtLogin: i.checked }),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: false, focusable: false, skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('did-finish-load', () => { sendLayout(); win.showInactive(); });

  // ponytail: clicking the real taskbar lifts it above topmost windows; re-assert every second.
  // Swap for a SetWinEventHook native module if the flicker ever bothers you.
  setInterval(() => { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); }, 1000);

  for (const e of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(e, sendLayout);

  ipcMain.on('clickable', (_, on) => win.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on('done', () => { reminding = false; active = 0; });

  const reset = () => { active = 0; };
  powerMonitor.on('lock-screen', reset);
  powerMonitor.on('suspend', reset);

  setInterval(() => {
    if (paused || reminding) return;
    active = tick(active, powerMonitor.getSystemIdleTime());
    tray.setToolTip(`Taskbar Buddy - ${Math.floor(active / 60)} min of screen time`);
    if (active >= LIMIT) remind();
  }, 1000);

  buildTray();
});

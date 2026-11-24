const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let win;
let tray = null;
let prevCpus = os.cpus();
let lastTemp = '--°C';
const posFile = path.join(app.getPath('userData'), 'widget-pos.json');

function getSavedPos() {
  try {
    return JSON.parse(fs.readFileSync(posFile, 'utf8'));
  } catch (e) {
    return {};
  }
}

function getCpuUsage() {
  const cpus = os.cpus();
  let idleDiff = 0;
  let totalDiff = 0;
  cpus.forEach((cpu, i) => {
    const prev = prevCpus[i];
    for (const type in cpu.times) totalDiff += cpu.times[type] - prev.times[type];
    idleDiff += cpu.times.idle - prev.times.idle;
  });
  prevCpus = cpus;
  return totalDiff === 0 ? 0 : Math.round(100 - (100 * idleDiff) / totalDiff);
}

function updateSystemTemp() {
  if (process.platform !== 'win32') return;
  exec(
    'powershell -Command "Get-CimInstance MSAcpi_ThermalZoneTemperature -Namespace root/wmi | Select-Object -First 1 -ExpandProperty CurrentTemperature"',
    (err, stdout) => {
      if (!err && stdout.trim()) {
        const kelvinTenths = parseInt(stdout.trim(), 10);
        if (!isNaN(kelvinTenths)) {
          lastTemp = `${Math.round(kelvinTenths / 10 - 273.15)}°C`;
        }
      }
    }
  );
}

function createWindow() {
  const saved = getSavedPos();
  win = new BrowserWindow({
    width: 390,
    height: 330,
    x: saved.x,
    y: saved.y,
    transparent: true,
    frame: false,
    alwaysOnTop: false,
    focusable: true,
    skipTaskbar: false,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');

  // Guarda automáticamente la posición donde dejaste el widget
  win.on('moved', () => {
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition();
      fs.writeFileSync(posFile, JSON.stringify({ x, y }));
    }
  });

  setInterval(() => {
    if (win && !win.isDestroyed()) {
      const cpu = getCpuUsage();
      const ram = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
      win.webContents.send('system-stats', { cpu, ram, temp: lastTemp });
    }
  }, 1000);

  setInterval(updateSystemTemp, 5000);
  updateSystemTemp();
}

// Movimiento fluido controlado desde index.html
ipcMain.on('move-window', (event, { dx, dy }) => {
  if (win && !win.isDestroyed()) {
    const [x, y] = win.getPosition();
    win.setPosition(x + dx, y + dy);
  }
});

app.whenReady().then(() => {
  createWindow();

  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Solo en el Escritorio (Recomendado)',
        type: 'radio',
        checked: true,
        click: () => {
          win.setAlwaysOnTop(false);
          win.setIgnoreMouseEvents(false);
        }
      },
      {
        label: 'Flotar encima de todo',
        type: 'radio',
        click: () => {
          win.setAlwaysOnTop(true, 'screen-saver');
          win.setIgnoreMouseEvents(false);
        }
      },
      {
        label: 'Modo Fantasma (Clics traspasan)',
        type: 'radio',
        click: () => {
          win.setIgnoreMouseEvents(true, { forward: true });
        }
      },
      { type: 'separator' },
      { label: 'Salir de Galaxia Widget', click: () => app.quit() }
    ]);
    tray.setToolTip('Galaxia Widget - Monitor de Escritorio');
    tray.setContextMenu(contextMenu);
    tray.on("click", () => { if (win.isVisible()) win.hide(); else win.show(); });
  } catch (e) {}
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

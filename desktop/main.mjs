// Planner for Mac: the whiteboard planner as a desktop app.
// - Each planner is a board file in the app's data folder (lib/planners.mjs); the planner pages
//   are served from planner://app/ and save through planner://app/api/state/<id>.
// - Windows: one per open planner, the planner library, pop-out lists, and the desktop pet
//   (a transparent, click-through overlay the pet roams on).
import { app, BrowserWindow, protocol, ipcMain, Menu, Tray, screen, shell, dialog, nativeImage } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLibrary, validId } from './lib/planners.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WEB = app.isPackaged ? join(process.resourcesPath, 'web') : resolve(here, '../planner/public');
const PROXY = app.isPackaged ? join(process.resourcesPath, 'proxy.mjs') : resolve(here, '../planner/proxy.mjs');
const PAGES = join(here, 'pages');
const ORIGIN = 'planner://app';
const MAX_BODY = 5 * 1024 * 1024;

protocol.registerSchemesAsPrivileged([
  { scheme: 'planner', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } },
]);

// Tests run against a scratch data folder.
if (process.env.PLANNER_USER_DATA) app.setPath('userData', process.env.PLANNER_USER_DATA);
if (process.env.PLANNER_DEBUG_PORT && !app.isPackaged) app.commandLine.appendSwitch('remote-debugging-port', process.env.PLANNER_DEBUG_PORT);
if (!app.requestSingleInstanceLock()) app.quit();

const lib = createLibrary(join(app.getPath('userData'), 'planners'));
const CONFIG = join(app.getPath('userData'), 'app.json');
let config = { open: [], lists: [], pet: { planner: null, screen: 'mouse' } };
const proxy = () => import(pathToFileURL(PROXY).href);

async function loadConfig() {
  try {
    config = { ...config, ...JSON.parse(await readFile(CONFIG, 'utf8')) };
  } catch {}
  config.pet = { planner: null, screen: 'mouse', ...(config.pet || {}) };
}
let configTimer = null;
function saveConfig() {
  clearTimeout(configTimer);
  configTimer = setTimeout(() => writeFile(CONFIG, JSON.stringify(config, null, 2)).catch(() => {}), 300);
}

// ---------- planner:// ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
};

const reply = (status, body, type = 'text/plain; charset=utf-8', extra = {}) =>
  new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra } });

/** Serves a file from `root` (no escaping it). */
async function serveFile(root, rel) {
  const file = resolve(root, '.' + rel);
  if (file !== root && !file.startsWith(root + sep)) return reply(404, 'not found');
  try {
    return reply(200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream');
  } catch {
    return reply(404, 'not found');
  }
}

/** Planner pages learn which planner they show through their meta tags. */
function plannerHtml(html, id) {
  return html
    .replace(/content="\/api\/state"/g, `content="/api/state/${id}"`)
    .replace('<head>', `<head>\n  <meta name="planner-id" content="${id}">\n  <meta name="planner-desktop" content="1">`);
}

async function handle(request) {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  const method = request.method;

  const state = /^\/api\/state\/([a-z0-9]+)$/.exec(path);
  if (state) {
    const id = state[1];
    if (!validId(id)) return reply(400, 'bad id');
    if (method === 'GET') {
      const text = await lib.readBoard(id);
      return text == null ? reply(204, null) : reply(200, text, 'application/json');
    }
    if (method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BODY) return reply(413, 'too large');
      try {
        const board = await lib.writeBoard(id, text);
        broadcast('planner:changed', id, Number(board.updatedAt) || Date.now());
        return reply(204, null);
      } catch (e) {
        return reply(e.status || 400, e.message);
      }
    }
    return reply(405, 'method not allowed');
  }
  if (path === '/api/ics') {
    const r = await (await proxy()).fetchFeed(url.searchParams.get('url'));
    return reply(r.status, r.body, r.type);
  }
  if (path.startsWith('/api/canvas/')) {
    const r = await (await proxy()).canvasApi(path.slice('/api/canvas/'.length), method, url.searchParams, request.headers.get('x-canvas-token'), () => request.text());
    return reply(r.status, r.body, r.type);
  }
  if (method !== 'GET' && method !== 'HEAD') return reply(405, 'method not allowed');

  const fromPages = path.startsWith('/pages/');
  const root = fromPages ? PAGES : WEB;
  const rel = fromPages ? path.slice('/pages'.length) : path === '/' ? '/index.html' : path;
  const res = await serveFile(root, rel);
  // The pet loader checks a model exists with HEAD before downloading it.
  if (method === 'HEAD') return new Response(null, { status: res.status, headers: res.headers });
  const id = url.searchParams.get('planner');
  if (res.status === 200 && rel.endsWith('.html') && validId(id)) return reply(200, plannerHtml(await res.text(), id), TYPES['.html']);
  return res;
}

// ---------- Windows ----------

const planners = new Map(); // planner id -> BrowserWindow
const listWins = new Map(); // `${planner}:${list}` -> BrowserWindow
let libraryWin = null;
let petWin = null;
let quitting = false;

const webPrefs = { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true };

function broadcast(channel, ...args) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
}

/** The planner a window belongs to, from its URL. */
function plannerOf(sender) {
  try {
    const id = new URL(sender.getURL()).searchParams.get('planner');
    return validId(id) ? id : null;
  } catch {
    return null;
  }
}

/** Links to the web open in the browser; the app never navigates away from its own pages. */
function guard(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
}

function onScreen(b) {
  return b && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 10 && b.y < a.y + a.height - 80;
  });
}

async function openPlanner(id) {
  if (planners.has(id)) {
    const w = planners.get(id);
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    return w;
  }
  const meta = await lib.get(id);
  if (!meta) return null;
  const b = onScreen(meta.bounds) ? meta.bounds : {};
  const win = new BrowserWindow({
    width: b.width || 1320, height: b.height || 840, x: b.x, y: b.y, minWidth: 720, minHeight: 480,
    title: meta.name, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 17 },
    backgroundColor: '#0b0b0c', show: false, webPreferences: webPrefs,
  });
  planners.set(id, win);
  guard(win);
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${ORIGIN}/index.html?planner=${id}`);
  const remember = () => lib.update(id, { bounds: win.getBounds() });
  win.on('resized', remember);
  win.on('moved', remember);
  win.on('closed', () => {
    planners.delete(id);
    if (!quitting) {
      config.open = config.open.filter((x) => x !== id);
      saveConfig();
    }
  });
  lib.update(id, { openedAt: Date.now() });
  if (!config.open.includes(id)) config.open.push(id);
  saveConfig();
  broadcast('lib:changed');
  return win;
}

function openLibrary(opts = {}) {
  if (libraryWin) {
    libraryWin.show();
    libraryWin.focus();
    if (opts.create) libraryWin.webContents.send('lib:create-dialog', opts.from || null);
    return;
  }
  libraryWin = new BrowserWindow({
    width: 1040, height: 720, minWidth: 620, minHeight: 460, title: 'Planners',
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 20 },
    backgroundColor: '#0b0b0c', show: false, webPreferences: webPrefs,
  });
  guard(libraryWin);
  libraryWin.once('ready-to-show', () => {
    libraryWin.show();
    if (opts.create) libraryWin.webContents.send('lib:create-dialog', opts.from || null);
  });
  libraryWin.loadURL(`${ORIGIN}/pages/planners.html`);
  libraryWin.on('closed', () => (libraryWin = null));
}

function openList(planner, list, saved = {}) {
  const key = `${planner}:${list}`;
  if (listWins.has(key)) return listWins.get(key).focus();
  const b = onScreen(saved.bounds) ? saved.bounds : {};
  const pinned = saved.pinned ?? true;
  const win = new BrowserWindow({
    width: b.width || 340, height: b.height || 520, x: b.x, y: b.y, minWidth: 260, minHeight: 180,
    titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 15 }, transparent: false,
    backgroundColor: '#141416', show: false, alwaysOnTop: pinned, fullscreenable: false, webPreferences: webPrefs,
  });
  if (pinned) win.setAlwaysOnTop(true, 'floating');
  listWins.set(key, win);
  guard(win);
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${ORIGIN}/pages/list.html?planner=${planner}&list=${encodeURIComponent(list)}`);
  const entry = () => config.lists.find((l) => l.planner === planner && l.list === list);
  if (!entry()) config.lists.push({ planner, list, pinned });
  const remember = () => { const e = entry(); if (e) { e.bounds = win.getBounds(); saveConfig(); } };
  win.on('resized', remember);
  win.on('moved', remember);
  win.on('closed', () => {
    listWins.delete(key);
    if (!quitting) {
      config.lists = config.lists.filter((l) => !(l.planner === planner && l.list === list));
      saveConfig();
    }
  });
  saveConfig();
}

// ---------- Desktop pet ----------

function petDisplay() {
  return config.pet.screen === 'main' ? screen.getPrimaryDisplay() : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function openPet(planner) {
  config.pet.planner = planner;
  saveConfig();
  if (petWin) {
    const cur = plannerOf(petWin.webContents);
    if (cur !== planner) petWin.loadURL(`${ORIGIN}/pages/pet.html?planner=${planner}`);
    return;
  }
  const d = petDisplay();
  petWin = new BrowserWindow({
    ...d.workArea, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: true,
    backgroundColor: '#00000000', show: false, webPreferences: { ...webPrefs, backgroundThrottling: false },
  });
  petWin.setAlwaysOnTop(true, 'floating');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.setIgnoreMouseEvents(true, { forward: true });
  guard(petWin);
  petWin.once('ready-to-show', () => petWin.showInactive());
  petWin.loadURL(`${ORIGIN}/pages/pet.html?planner=${planner}`);
  petWin.on('blur', () => petWin?.webContents.send('pet:blur'));
  petWin.on('closed', () => (petWin = null));
  petDisplayId = d.id;
  updateTray();
}

function closePet() {
  config.pet.planner = null;
  saveConfig();
  petWin?.close();
  petWin = null;
  updateTray();
}

// The pet follows the mouse to whichever screen it's on.
let petDisplayId = null;
setInterval(() => {
  if (!petWin || config.pet.screen !== 'mouse' || petInteractive) return;
  const d = petDisplay();
  if (d.id === petDisplayId) return;
  petDisplayId = d.id;
  petWin.setBounds(d.workArea);
  petWin.webContents.send('pet:screen');
}, 1200);
// Resolution or arrangement changed: the overlay keeps covering its screen. (Needs app ready.)
function watchScreens() {
  const fit = () => {
    if (!petWin) return;
    const d = screen.getAllDisplays().find((x) => x.id === petDisplayId) || petDisplay();
    petDisplayId = d.id;
    petWin.setBounds(d.workArea);
  };
  screen.on('display-metrics-changed', fit);
  screen.on('display-removed', fit);
}

let petInteractive = false;
ipcMain.on('pet:interactive', (e, on) => {
  if (!petWin || e.sender !== petWin.webContents) return;
  petInteractive = on;
  petWin.setIgnoreMouseEvents(!on, { forward: true });
});

// ---------- Tray (menu bar paw) ----------

let tray = null;
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: petWin ? 'Bring the pet back to the board' : 'Let the pet roam the desktop', click: () => togglePetFromTray() },
    { label: 'Pet follows my mouse across screens', type: 'checkbox', checked: config.pet.screen === 'mouse', click: (m) => setPetScreen(m.checked ? 'mouse' : 'main') },
    { type: 'separator' },
    { label: 'Planners…', click: () => openLibrary() },
    { label: 'New planner…', click: () => openLibrary({ create: true }) },
    { type: 'separator' },
    { label: 'Quit Planner', role: 'quit' },
  ]));
}

async function togglePetFromTray() {
  if (petWin) {
    const id = plannerOf(petWin.webContents);
    setPetFlag(id, false);
    return closePet();
  }
  const id = config.pet.planner || [...planners.keys()].pop() || config.open[0] || (await lib.list())[0]?.id;
  if (!id) return;
  setPetFlag(id, true);
  openPet(id);
}

/** Flips the "roam on desktop" setting inside a planner's board so its board hides/shows the pet. */
async function setPetFlag(id, on) {
  if (!id) return;
  const text = await lib.readBoard(id);
  const board = text ? JSON.parse(text) : null;
  if (!board) return;
  board.settings = board.settings || {};
  board.settings.pet = { ...(board.settings.pet || {}), desktop: on, on: true };
  board.updatedAt = Date.now();
  await lib.writeBoard(id, JSON.stringify(board));
  broadcast('planner:changed', id, board.updatedAt);
}

function setPetScreen(mode) {
  config.pet.screen = mode === 'main' ? 'main' : 'mouse';
  saveConfig();
  updateTray();
  if (petWin) {
    const d = petDisplay();
    petDisplayId = d.id;
    petWin.setBounds(d.workArea);
    petWin.webContents.send('pet:screen');
  }
}

// ---------- IPC ----------

ipcMain.handle('planner:info', async (e) => {
  const id = plannerOf(e.sender);
  const meta = id && (await lib.get(id));
  return meta ? { id, name: meta.name } : null;
});
ipcMain.on('planner:focus', (e) => {
  const id = plannerOf(e.sender);
  if (id) openPlanner(id);
});
ipcMain.on('list:open', (e, listId) => {
  const id = plannerOf(e.sender);
  if (id && typeof listId === 'string' && listId.length < 64) openList(id, listId);
});
ipcMain.handle('list:pinned', (e) => BrowserWindow.fromWebContents(e.sender)?.isAlwaysOnTop() ?? false);
ipcMain.handle('list:set-pinned', (e, on) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return false;
  win.setAlwaysOnTop(on, 'floating');
  const key = [...listWins].find(([, w]) => w === win)?.[0];
  const entry = key && config.lists.find((l) => `${l.planner}:${l.list}` === key);
  if (entry) { entry.pinned = on; saveConfig(); }
  return on;
});
ipcMain.on('pet:desktop', (e, on) => {
  const id = plannerOf(e.sender);
  if (!id) return;
  if (on) openPet(id);
  else if (petWin && plannerOf(petWin.webContents) === id) closePet();
});
ipcMain.handle('pet:state', () => ({ screen: config.pet.screen, desktop: !!petWin }));
ipcMain.on('pet:screen-mode', (_e, mode) => setPetScreen(mode));

ipcMain.handle('lib:list', () => lib.list());
ipcMain.handle('lib:create', async (_e, name, start) => {
  const p = await lib.create(name, start);
  broadcast('lib:changed');
  return p;
});
ipcMain.handle('lib:update', async (_e, id, patch) => {
  const p = await lib.update(id, patch || {});
  if (p && typeof patch?.name === 'string') {
    planners.get(id)?.setTitle(p.name);
    broadcast('planner:renamed', id, p.name);
  }
  if (p && patch?.archived && planners.has(id)) planners.get(id).close();
  broadcast('lib:changed');
  return p;
});
ipcMain.handle('lib:duplicate', async (_e, id) => {
  const p = await lib.duplicate(id);
  broadcast('lib:changed');
  return p;
});
ipcMain.handle('lib:remove', async (e, id) => {
  const meta = await lib.get(id);
  if (!meta) return false;
  const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(e.sender), {
    type: 'warning', buttons: ['Move to Trash', 'Cancel'], defaultId: 1, cancelId: 1,
    message: `Move “${meta.name}” to the Trash?`, detail: 'You can get it back from the Trash in Finder.',
  });
  if (response !== 0) return false;
  planners.get(id)?.close();
  for (const [key, w] of listWins) if (key.startsWith(`${id}:`)) w.close();
  if (petWin && plannerOf(petWin.webContents) === id) closePet();
  const ok = await lib.remove(id, (file) => shell.trashItem(file));
  broadcast('lib:changed');
  return ok;
});
ipcMain.on('lib:open', (_e, id) => validId(id) && openPlanner(id));
ipcMain.on('lib:show', (_e, opts) => openLibrary(opts));
async function exportPlanner(win, id) {
  const meta = await lib.get(id);
  if (!meta) return false;
  const { filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `${meta.name.replace(/[/\\:]/g, '-')}.planner.json`, filters: [{ name: 'Planner', extensions: ['json'] }],
  });
  if (!filePath) return false;
  await writeFile(filePath, (await lib.readBoard(id)) || JSON.stringify({ version: 1, cards: [] }));
  return true;
}
ipcMain.handle('lib:export', (e, id) => exportPlanner(BrowserWindow.fromWebContents(e.sender), id));
ipcMain.handle('lib:import', async (e) => {
  const { filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    properties: ['openFile'], filters: [{ name: 'Planner', extensions: ['json'] }],
  });
  if (!filePaths?.[0]) return null;
  const text = await readFile(filePaths[0], 'utf8');
  const board = JSON.parse(text);
  if (!Array.isArray(board.cards)) throw new Error('That file is not a planner backup.');
  const name = filePaths[0].split(sep).pop().replace(/(\.planner)?\.json$/i, '');
  const p = await lib.create(name, 'blank');
  await lib.writeBoard(p.id, JSON.stringify({ ...board, updatedAt: Date.now() }));
  broadcast('lib:changed');
  openPlanner(p.id);
  return p;
});

// ---------- Menu ----------

function buildMenu() {
  const focusedPlanner = () => {
    const w = BrowserWindow.getFocusedWindow();
    return w ? plannerOf(w.webContents) : null;
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Planner…', accelerator: 'CmdOrCtrl+Shift+N', click: () => openLibrary({ create: true, from: focusedPlanner() }) },
        { label: 'All Planners…', accelerator: 'CmdOrCtrl+O', click: () => openLibrary() },
        { type: 'separator' },
        { label: 'Import Planner Backup…', click: () => libraryWin ? libraryWin.webContents.send('lib:import') : openLibrary() },
        { label: 'Export This Planner…', click: () => { const id = focusedPlanner(); if (id) exportPlanner(BrowserWindow.getFocusedWindow(), id); } },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom', label: 'Actual Size' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }]),
      ],
    },
    {
      label: 'Pet',
      submenu: [
        { label: 'Roam on the Desktop', accelerator: 'CmdOrCtrl+Shift+P', click: () => togglePetFromTray() },
        { label: 'Follow My Mouse Across Screens', type: 'checkbox', checked: config.pet.screen === 'mouse', click: (m) => setPetScreen(m.checked ? 'mouse' : 'main') },
      ],
    },
    { role: 'windowMenu' },
  ]));
}
// ---------- Start ----------

app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows().find((x) => x !== petWin);
  if (w) { w.show(); w.focus(); } else openLibrary();
});

app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().some((w) => w !== petWin)) openLibrary();
});

app.on('before-quit', () => (quitting = true));
app.on('window-all-closed', () => {}); // stays in the menu bar (the pet may be out)

app.whenReady().then(async () => {
  app.setAboutPanelOptions({ applicationName: 'Planner', applicationVersion: app.getVersion(), copyright: 'Copyright © 2026 Michael Wang. All rights reserved.', credits: 'Made by Michael Wang' });
  protocol.handle('planner', (req) => handle(req).catch((e) => reply(500, String(e?.message || e))));
  await lib.init();
  await lib.recover();
  await loadConfig();
  buildMenu();
  watchScreens();

  const trayIcon = nativeImage.createFromPath(join(here, 'build', 'trayTemplate.png'));
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip('Planner');
  updateTray();

  let all = await lib.list();
  if (!all.length) {
    const first = await lib.create('My planner');
    all = [first];
    config.open = [first.id];
  }
  const ids = new Set(all.map((p) => p.id));
  const open = config.open.filter((id) => ids.has(id));
  if (!open.length) open.push(all.find((p) => !p.archived)?.id || all[0].id);
  for (const id of open) await openPlanner(id);
  for (const l of config.lists.filter((x) => ids.has(x.planner))) openList(l.planner, l.list, l);
  if (config.pet.planner && ids.has(config.pet.planner)) openPet(config.pet.planner);
});


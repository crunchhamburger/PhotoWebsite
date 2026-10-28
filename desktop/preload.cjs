// Bridge between the planner pages and the app. Pages get a small, fixed API on
// window.plannerDesktop; they never see Node or Electron objects.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('plannerDesktop', {
  // Another window of the same planner saved the board.
  onPlannerChanged: on('planner:changed'),
  // This window's planner: { id, name }.
  info: () => ipcRenderer.invoke('planner:info'),
  onRenamed: on('planner:renamed'),

  openList: (listId) => ipcRenderer.send('list:open', listId),
  listPinned: () => ipcRenderer.invoke('list:pinned'),
  setListPinned: (on) => ipcRenderer.invoke('list:set-pinned', !!on),
  openBoard: () => ipcRenderer.send('planner:focus'),

  setDesktopPet: (on) => ipcRenderer.send('pet:desktop', !!on),
  petState: () => ipcRenderer.invoke('pet:state'),
  setPetScreen: (mode) => ipcRenderer.send('pet:screen-mode', mode),
  petInteractive: (on) => ipcRenderer.send('pet:interactive', !!on),
  onPetScreen: on('pet:screen'),
  onPetBlur: on('pet:blur'),

  library: {
    list: () => ipcRenderer.invoke('lib:list'),
    create: (name, start) => ipcRenderer.invoke('lib:create', name, start),
    update: (id, patch) => ipcRenderer.invoke('lib:update', id, patch),
    duplicate: (id) => ipcRenderer.invoke('lib:duplicate', id),
    remove: (id) => ipcRenderer.invoke('lib:remove', id),
    open: (id) => ipcRenderer.send('lib:open', id),
    exportBoard: (id) => ipcRenderer.invoke('lib:export', id),
    importBoard: () => ipcRenderer.invoke('lib:import'),
    onChanged: on('lib:changed'),
  },
  openLibrary: (opts) => ipcRenderer.send('lib:show', opts || {}),
  // Library window: File > New Planner… / Import… from the menu bar.
  onLibCreate: on('lib:create-dialog'),
  onLibImport: on('lib:import'),
});

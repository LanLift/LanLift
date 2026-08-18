'use strict';

const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const QRCode = require('qrcode');
const { TransferServer } = require('./transfer-server');
const { ServerProfileStore } = require('./server-profiles');
const { RemoteHost } = require('./remote-host');

let mainWindow;
let transferServer;
let profileStore;
let remoteHost;

async function stateForRenderer() {
  const state = transferServer.getSessionSummary();
  state.connection = profileStore?.getState() || {
    connectionMode: 'direct',
    activeProfileId: null,
    profiles: [],
    secureStorageAvailable: false,
  };
  state.remote = remoteHost?.getState() || {
    active: false,
    roomCode: null,
    connected: false,
    transport: null,
    secured: false,
    peers: [],
    received: [],
  };
  if (state.active) {
    state.qrDataUrl = await QRCode.toDataURL(state.url, { width: 300, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b1220', light: '#00000000' } });
  }
  return state;
}

async function publishState() {
  if (!mainWindow || mainWindow.isDestroyed()) {return;}
  mainWindow.webContents.send('session-update', await stateForRenderer());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 640,
    minHeight: 640,
    title: 'LanLift',
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  app.setAppUserModelId('im.lanlift.desktop');
  profileStore = new ServerProfileStore({
    filePath: path.join(app.getPath('userData'), 'server-profiles.json'),
    safeStorage,
  });
  await profileStore.init();
  transferServer = new TransferServer({ receiveDir: path.join(app.getPath('downloads'), 'LanLift') });
  transferServer.on('update', () => { publishState().catch(console.error); });
  transferServer.on('ended', ({ reason }) => { publishState().catch(console.error); console.log(`LanLift session ended: ${reason}`); });
  await transferServer.start();
  remoteHost = new RemoteHost({
    receiveDir: path.join(app.getPath('downloads'), 'LanLift'),
    getProfile: () => {
      const state = profileStore.getState();
      if (state.connectionMode !== 'custom' || !state.activeProfileId) {return null;}
      return profileStore.getConnectionCredentials(state.activeProfileId);
    },
  });
  remoteHost.on('update', () => { publishState().catch(console.error); });
  remoteHost.on('error', (error) => console.error('LanLift remote error:', error.message));
  createWindow();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) {createWindow();} });
});

ipcMain.handle('get-state', () => stateForRenderer());
ipcMain.handle('create-session', () => stateForRenderer().then(() => { transferServer.createSession(); return stateForRenderer(); }));
ipcMain.handle('end-session', () => { transferServer.endSession(); return stateForRenderer(); });
ipcMain.handle('approve-client', (_event, id, approved) => { transferServer.approveClient(id, approved); return stateForRenderer(); });
ipcMain.handle('remove-file', (_event, id) => { transferServer.removeFile(id); return stateForRenderer(); });
ipcMain.handle('pick-files', async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: '選取要分享的檔案或資料夾',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
  });
  if (!selection.canceled) {await transferServer.addPaths(selection.filePaths);}
  return stateForRenderer();
});
ipcMain.handle('add-dropped-files', async (_event, paths) => {
  await transferServer.addPaths(Array.isArray(paths) ? paths : []);
  return stateForRenderer();
});
ipcMain.handle('choose-receive-directory', async () => {
  const selection = await dialog.showOpenDialog(mainWindow, { title: '選擇 LanLift 接收資料夾', properties: ['openDirectory', 'createDirectory'] });
  if (!selection.canceled && selection.filePaths[0]) {
    transferServer.setReceiveDir(selection.filePaths[0]);
  }
  return stateForRenderer();
});
ipcMain.handle('open-receive-directory', () => shell.openPath(transferServer.receiveDir));
ipcMain.handle('get-server-profiles', () => profileStore.getState());
ipcMain.handle('save-server-profile', async (_event, profile) => {
  await profileStore.saveProfile(profile);
  await publishState();
  return profileStore.getState();
});
ipcMain.handle('remove-server-profile', async (_event, id) => {
  const state = await profileStore.removeProfile(id);
  await publishState();
  return state;
});
ipcMain.handle('set-connection-mode', async (_event, mode, profileId) => {
  const state = await profileStore.setConnectionMode(mode, profileId || null);
  await publishState();
  return state;
});
ipcMain.handle('create-remote-session', async () => {
  await remoteHost.createSession();
  await publishState();
  return stateForRenderer();
});
ipcMain.handle('end-remote-session', () => {
  remoteHost.close();
  return stateForRenderer();
});
ipcMain.handle('approve-remote', (_event, memberId, approved) => {
  remoteHost.approve(memberId, approved);
  return stateForRenderer();
});
ipcMain.handle('send-remote-files', async (_event, filePaths) => {
  const sent = [];
  for (const filePath of filePaths || []) {
    sent.push(await remoteHost.sendFile(filePath));
  }
  await publishState();
  return sent;
});

app.on('before-quit', async () => {
  remoteHost?.close();
  if (transferServer) {await transferServer.stop();}
});

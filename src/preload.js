'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lanlift', {
  getState: () => ipcRenderer.invoke('get-state'),
  createSession: () => ipcRenderer.invoke('create-session'),
  endSession: () => ipcRenderer.invoke('end-session'),
  approveClient: (id, approved) => ipcRenderer.invoke('approve-client', id, approved),
  removeFile: (id) => ipcRenderer.invoke('remove-file', id),
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  addDroppedFiles: (files) => ipcRenderer.invoke('add-dropped-files', files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)),
  chooseReceiveDirectory: () => ipcRenderer.invoke('choose-receive-directory'),
  openReceiveDirectory: () => ipcRenderer.invoke('open-receive-directory'),
  getServerProfiles: () => ipcRenderer.invoke('get-server-profiles'),
  saveServerProfile: (profile) => ipcRenderer.invoke('save-server-profile', profile),
  removeServerProfile: (id) => ipcRenderer.invoke('remove-server-profile', id),
  setConnectionMode: (mode, profileId) => ipcRenderer.invoke('set-connection-mode', mode, profileId),
  onSessionUpdate: (callback) => ipcRenderer.on('session-update', (_event, state) => callback(state))
});

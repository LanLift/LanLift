'use strict';

const { contextBridge } = require('electron');

const fakeState = {
  active: false,
  receiveDir: 'C:\\Users\\Test\\Downloads\\LanLift',
  server: { port: 62316 },
  connection: { connectionMode: 'direct', activeProfileId: null, profiles: [], secureStorageAvailable: true }
};

contextBridge.exposeInMainWorld('lanlift', {
  getState: async () => fakeState,
  createSession: async () => fakeState,
  endSession: async () => fakeState,
  approveClient: async () => fakeState,
  removeFile: async () => fakeState,
  pickFiles: async () => fakeState,
  addDroppedFiles: async () => fakeState,
  chooseReceiveDirectory: async () => fakeState,
  openReceiveDirectory: async () => '',
  getServerProfiles: async () => fakeState.connection,
  saveServerProfile: async () => fakeState.connection,
  removeServerProfile: async () => fakeState.connection,
  setConnectionMode: async (mode) => { fakeState.connection.connectionMode = mode; return fakeState.connection; },
  onSessionUpdate: () => {}
});

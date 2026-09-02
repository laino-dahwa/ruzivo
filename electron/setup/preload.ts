import { contextBridge, ipcRenderer } from 'electron';

interface SetupConnectPayload {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

contextBridge.exposeInMainWorld('setupBridge', {
  connect: (config: SetupConnectPayload) => ipcRenderer.invoke('setup:connect', config),
  provisionEmbedded: () => ipcRenderer.invoke('setup:provision-embedded'),
});

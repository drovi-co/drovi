import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("droviDesktop", {
  getState: () => ipcRenderer.invoke("desktop:get-state"),
  approveRequest: (payload) =>
    ipcRenderer.invoke("desktop:approve-request", payload),
  enableRemote: () => ipcRenderer.invoke("desktop:enable-remote"),
  onState: (handler) => {
    if (typeof handler !== "function") {
      return () => undefined;
    }
    const listener = (_event, state) => handler(state);
    ipcRenderer.on("desktop:state", listener);
    return () => ipcRenderer.removeListener("desktop:state", listener);
  },
});

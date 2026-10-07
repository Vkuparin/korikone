import { contextBridge, ipcRenderer } from "electron";
const methods = [
  "load",
  "save",
  "setLanguage",
  "cancelTransfer",
  "buildBasket",
  "accept",
  "prepare",
  "execute",
  "recover",
  "scenario",
  "exportList",
  "exportData",
  "importData",
  "searchStores",
  "loginStore",
  "checkStoreLogin",
  "cancelStoreLogin",
  "openStoreCart",
] as const;
contextBridge.exposeInMainWorld(
  "korikone",
  Object.fromEntries(
    methods.map((method) => [
      method,
      (input: unknown) => ipcRenderer.invoke(`app:${method}`, input),
    ]),
  ),
);

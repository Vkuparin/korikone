import { contextBridge, ipcRenderer } from "electron";
const methods = [
  "load",
  "save",
  "buildBasket",
  "accept",
  "prepare",
  "execute",
  "recover",
  "scenario",
  "exportList",
  "exportData",
  "importData",
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

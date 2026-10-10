import { contextBridge, ipcRenderer } from "electron";
import type { AppearanceBootstrap } from "../domain/appearance";
import type { PlanningSnapshot } from "../application/planning";
const methods = [
  "load",
  "getAppInfo",
  "setDevelopmentMode",
  "developmentScenario",
  "copyList",
  "copyWeek",
  "importReceipt",
  "save",
  "setLanguage",
  "setAppearance",
  "setAIModel",
  "cancelTransfer",
  "buildBasket",
  "compareStores",
  "getContextOptions",
  "changeContext",
  "recordError",
  "openRelease",
  "openNotices",
  "accept",
  "rememberCategoryPreference",
  "editCategoryPreference",
  "forgetCategoryPreference",
  "resetCategoryPreferences",
  "setPackSize",
  "omit",
  "prepare",
  "transferDisplayed",
  "execute",
  "recover",
  "scenario",
  "exportList",
  "exportData",
  "exportDiagnostics",
  "importData",
  "searchStores",
  "loginStore",
  "checkStoreLogin",
  "cancelStoreLogin",
  "logoutStore",
  "openStoreCart",
  "storeView",
  "hideStore",
  "storeAction",
  "signInAI",
  "cancelAI",
  "cancelPlanning",
  "invalidatePlanning",
  "signOutAI",
  "modelsAI",
  "usageAI",
  "generate",
  "planShopping",
  "commitPlanning",
  "importRecipe",
  "approveDraft",
  "confirmPurchase",
  "newWeek",
  "reuseWeek",
] as const;
contextBridge.exposeInMainWorld("korikone", {
  ...Object.fromEntries(
    methods.map((method) => [
      method,
      (input: unknown) => ipcRenderer.invoke(`app:${method}`, input),
    ]),
  ),
  getAppearanceBootstrap: () => ipcRenderer.sendSync("app:appearanceBootstrap"),
  onPlanningChange: (callback: (value: PlanningSnapshot) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: PlanningSnapshot,
    ) => callback(value);
    ipcRenderer.on("app:planningChanged", listener);
    return () => ipcRenderer.removeListener("app:planningChanged", listener);
  },
  onAppearanceChange: (callback: (value: AppearanceBootstrap) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: AppearanceBootstrap,
    ) => callback(value);
    ipcRenderer.on("app:appearanceChanged", listener);
    return () => ipcRenderer.removeListener("app:appearanceChanged", listener);
  },
});

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
  "setPriceBasis",
  "setReviewBeforeTransfer",
  "setReceiptText",
  "cancelTransfer",
  "buildBasket",
  "compareStores",
  "getContextOptions",
  "changeContext",
  "recordError",
  "openRelease",
  "openNotices",
  "accept",
  "correctRow",
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
  "storeHistory",
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
  "editList",
  "undoEdit",
  "editLocally",
  "clearList",
  "resetList",
  "previewHouseholdSize",
  "setHouseholdSize",
  "importOrders",
  "importPurchaseReceipt",
  "importLegacyReceipts",
  "enrichPurchase",
  "setReceiptConsent",
  "correctPurchase",
  "interpretPurchase",
  "deletePurchase",
  "listPurchases",
  "purchaseInsights",
  "dismissSuggestion",
  "decidePurchaseLink",
  "repeatList",
  "importRecipe",
  "suggestOffers",
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
  onStoreHistoryChange: (
    callback: (value: { chain: string; canGoBack: boolean }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: { chain: string; canGoBack: boolean },
    ) => callback(value);
    ipcRenderer.on("app:storeHistoryChanged", listener);
    return () =>
      ipcRenderer.removeListener("app:storeHistoryChanged", listener);
  },
  // An update found after the first snapshot was returned.
  onUpdateChange: (
    callback: (value: { version: string; url: string }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: { version: string; url: string },
    ) => callback(value);
    ipcRenderer.on("app:updateChanged", listener);
    return () => ipcRenderer.removeListener("app:updateChanged", listener);
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

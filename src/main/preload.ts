import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppearanceBootstrap } from "../domain/appearance";
import type { PlanningSnapshot } from "../application/planning";
/**
 * Dropped receipts. This script, not the page, reads the dropped files' paths from the operating
 * system and hands them to the main process, so page code can never name a path of its own: a
 * file object made by a script has no path and is ignored. The page only shows the overlay and
 * receives the result. Drops that carry no files are left to the page.
 */
const dropListeners = new Set<(value: unknown) => void>();
window.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
});
window.addEventListener(
  "drop",
  (event) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    // Never let a dropped file navigate the window.
    event.preventDefault();
    const paths = files
      .map((file) => {
        try {
          return webUtils.getPathForFile(file);
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    if (!paths.length) return;
    void ipcRenderer.invoke("app:receiptDrop", { paths }).then((result) => {
      for (const listener of dropListeners) listener(result);
    });
  },
  true,
);
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
  "importReceipts",
  "cancelReceiptIntake",
  "receiptConsentAction",
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
  "suggestStarterIdeas",
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
  // Progress of a multi-file receipt import: the stage, file counts and finished files.
  onReceiptIntake: (callback: (value: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) =>
      callback(value);
    ipcRenderer.on("app:receiptIntakeChanged", listener);
    return () =>
      ipcRenderer.removeListener("app:receiptIntakeChanged", listener);
  },
  // The result of a drop, delivered to the page once the import has finished.
  onReceiptDrop: (callback: (value: unknown) => void) => {
    dropListeners.add(callback);
    return () => dropListeners.delete(callback);
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

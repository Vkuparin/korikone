import React from "react";
import type { Snapshot } from "../application/service";
import type { Key } from "./i18n";

const chains = [
  ["k-ruoka", "K-Ruoka"],
  ["s-kaupat", "S-kaupat"],
] as const;

/** Both retailer chains with their own sign-in and remembered store; one of them is active. */
export function Chains({
  snapshot,
  t,
  busy,
  call,
  only,
}: {
  snapshot: Snapshot;
  t: (key: Key) => string;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
  /** Show just these chains, for example the one not yet set up. */
  only?: string[];
}) {
  const { state } = snapshot;
  return (
    <ul className="chains">
      {chains
        .filter(([id]) => !only || only.includes(id))
        .map(([id, name]) => {
          const store = state.stores[id];
          const login = snapshot.storeLogins[id] ?? "notStarted";
          const active = state.context.providerId === id;
          return (
            <li
              className={`chain${active ? " active" : ""}`}
              key={id}
              aria-label={name}
            >
              <div>
                <strong>{name}</strong>
                {active && <span className="badge">{t("activeStore")}</span>}
                <p>{store ? store.storeName : t("noStoreChosen")}</p>
                <p role="status">
                  {t(
                    login === "signedIn"
                      ? "signedIn"
                      : login === "waiting"
                        ? "waitingLogin"
                        : login === "failed"
                          ? "loginFailed"
                          : "notConnected",
                  )}
                </p>
              </div>
              <div className="actions">
                {store && !active && (
                  <button
                    disabled={busy}
                    aria-label={`${name}: ${t("useThisStore")}`}
                    onClick={() =>
                      void call("save", { ...state, context: store })
                    }
                  >
                    {t("useThisStore")}
                  </button>
                )}
                {login === "waiting" ? (
                  <button
                    className="text"
                    disabled={busy}
                    aria-label={`${name}: ${t("cancel")}`}
                    onClick={() => void call("cancelStoreLogin", id)}
                  >
                    {t("cancel")}
                  </button>
                ) : login === "signedIn" ? (
                  id === "s-kaupat" && (
                    <button
                      className="text"
                      disabled={busy}
                      aria-label={`${name}: ${t("logoutStore")}`}
                      onClick={() => void call("logoutStore", id)}
                    >
                      {t("logoutStore")}
                    </button>
                  )
                ) : (
                  <>
                    <button
                      className="secondary"
                      disabled={busy}
                      aria-label={`${name}: ${t("signInChain")}`}
                      onClick={() => void call("loginStore", id)}
                    >
                      {t("signInChain")}
                    </button>
                    <button
                      className="text"
                      disabled={busy}
                      aria-label={`${name}: ${t("checkLogin")}`}
                      onClick={() => void call("checkStoreLogin", id)}
                    >
                      {t("checkLogin")}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
    </ul>
  );
}

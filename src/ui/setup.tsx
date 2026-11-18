import React, { useState } from "react";
import type { Snapshot } from "../application/service";
import type { Key } from "./i18n";
import { StoreSearch } from "./store-search";
import { isLive } from "../stores/provider";

export function Setup({
  snapshot,
  t,
  busy,
  call,
  finish,
}: {
  snapshot: Snapshot;
  t: (key: Key) => string;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
  finish: () => Promise<boolean>;
}) {
  const { state } = snapshot;
  const [choosingStore, setChoosingStore] = useState(
    !isLive(state.context.providerId),
  );
  return (
    <main className="setup">
      <h1>{t("setupProgress")}</h1>
      <p className="setup-intro">{t("setupOptional")}</p>
      <div className="setup-grid">
        <section className="card form" aria-labelledby="setup-store">
          <h2 id="setup-store">{t("setupStore")}</h2>
          <p>{t("setupStoreInfo")}</p>
          <StoreSearch
            visible={choosingStore}
            busy={busy}
            language={state.language}
            t={t}
            choose={async (store) => {
              if (await call("save", { ...state, context: store }))
                setChoosingStore(false);
            }}
          />
          {choosingStore && isLive(state.context.providerId) && (
            <button
              className="text"
              disabled={busy}
              onClick={() => setChoosingStore(false)}
            >
              {t("cancel")}
            </button>
          )}
          {!choosingStore && (
            <>
              <strong>{state.context.storeName}</strong>
              <button
                className="text"
                disabled={busy || snapshot.storeLogin === "waiting"}
                onClick={() => setChoosingStore(true)}
              >
                {t("changeStore")}
              </button>
              {snapshot.storeLogin === "signedIn" ? (
                <p role="status">{t("signedIn")}</p>
              ) : (
                <>
                  <p role="status">
                    {t(
                      snapshot.storeLogin === "waiting"
                        ? "waitingLogin"
                        : snapshot.storeLogin === "failed"
                          ? "loginFailed"
                          : "setupLoginInfo",
                    )}
                  </p>
                  <button
                    disabled={busy || snapshot.storeLogin === "waiting"}
                    onClick={() => void call("loginStore")}
                  >
                    {t("loginStore")}
                  </button>
                </>
              )}
            </>
          )}
        </section>
        <section className="card form" aria-labelledby="setup-ai">
          <h2 id="setup-ai">{t("setupAI")}</h2>
          <p>{t("setupAIInfo")}</p>
          {snapshot.ai.state === "connected" ? (
            <p role="status">
              {t("signedIn")} · {snapshot.ai.email}
            </p>
          ) : (
            <>
              {snapshot.ai.state === "waiting" && (
                <p role="status">{t("waitingAI")}</p>
              )}
              {snapshot.ai.error && <p role="alert">{t("authFailed")}</p>}
              <button
                disabled={busy || snapshot.ai.state === "waiting"}
                onClick={() => void call("signInAI")}
              >
                Continue with ChatGPT
              </button>
            </>
          )}
        </section>
      </div>
      <div className="actions">
        <button disabled={busy} onClick={() => void finish()}>
          {t("setupDone")}
        </button>
      </div>
    </main>
  );
}

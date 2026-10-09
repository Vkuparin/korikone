import React, { useState } from "react";
import type { Snapshot } from "../application/service";
import type { Key } from "./i18n";
import { isLive } from "../stores/provider";
import { Chains } from "./chains";

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
      <div className="setup-grid">
        <section className="card form" aria-labelledby="setup-store">
          <h2 id="setup-store">{t("setupStore")}</h2>
          <p>{t("setupStoreInfo")}</p>
          {choosingStore ? (
            <>
              <form
                className="inline"
                onSubmit={(event) => {
                  event.preventDefault();
                  void call(
                    "searchStores",
                    String(new FormData(event.currentTarget).get("query")),
                  );
                }}
              >
                <label>
                  {t("searchStores")}
                  <input
                    name="query"
                    minLength={2}
                    required
                    placeholder="Helsinki"
                    autoFocus
                  />
                </label>
                <button disabled={busy}>{t("search")}</button>
              </form>
              {snapshot.storeResults.map((store) => (
                <button
                  key={store.storeId}
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    if (await call("save", { ...state, context: store }))
                      setChoosingStore(false);
                  }}
                >
                  {store.storeName}
                </button>
              ))}
            </>
          ) : (
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
              {isLive(state.context.providerId) && (
                <>
                  <h3>{t("otherChain")}</h3>
                  <p className="muted">{t("chainsHelp")}</p>
                  <Chains
                    snapshot={snapshot}
                    t={t}
                    busy={busy}
                    call={call}
                    only={[
                      state.context.providerId === "s-kaupat"
                        ? "k-ruoka"
                        : "s-kaupat",
                    ]}
                  />
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

import React, { useEffect, useState } from "react";
import type { Snapshot } from "../application/service";
import type { Key } from "./i18n";
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
  const [step, setStep] = useState(0);
  const { state } = snapshot;
  useEffect(() => {
    if (snapshot.storeLogin !== "waiting" || busy) return;
    const timer = setTimeout(() => void call("checkStoreLogin"), 2500);
    return () => clearTimeout(timer);
  }, [snapshot.storeLogin, busy, call]);
  return (
    <main className="welcome">
      <p>
        {t("setupProgress")} {step + 1} / 2
      </p>
      <h1>{t(step === 0 ? "setupStore" : "setupAI")}</h1>
      {step === 0 ? (
        <section className="card form">
          <p>{t("setupStoreInfo")}</p>
          {!isLive(state.context.providerId) ? (
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
                  onClick={() =>
                    void call("save", { ...state, context: store })
                  }
                >
                  {store.storeName}
                </button>
              ))}
            </>
          ) : (
            <>
              <strong>{state.context.storeName}</strong>
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
            </>
          )}
          <div className="actions">
            {snapshot.storeLogin === "signedIn" && (
              <button disabled={busy} onClick={() => setStep(1)}>
                {t("setupNext")}
              </button>
            )}
            <button className="text" disabled={busy} onClick={() => setStep(1)}>
              {t("setupLater")}
            </button>
          </div>
        </section>
      ) : (
        <section className="card form">
          <p>{t("setupAIInfo")}</p>
          {snapshot.ai.state === "connected" ? (
            <>
              <p role="status">
                {t("signedIn")} · {snapshot.ai.email}
              </p>
              <button disabled={busy} onClick={() => void finish()}>
                {t("setupFinish")}
              </button>
            </>
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
              <button
                className="text"
                disabled={busy}
                onClick={() => void finish()}
              >
                {t("setupLater")}
              </button>
            </>
          )}
          <button className="text" disabled={busy} onClick={() => setStep(0)}>
            {t("setupBack")}
          </button>
        </section>
      )}
    </main>
  );
}

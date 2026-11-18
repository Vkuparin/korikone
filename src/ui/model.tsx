import React, { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../application/service";
import { Choice } from "./choice";
import { en, fi, type Key } from "./i18n";

export function ModelSelector({
  snapshot,
  busy,
  call,
  settings,
  connect,
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: (
    method: string,
    input?: unknown,
    options?: { preserveError?: boolean },
  ) => Promise<boolean>;
  settings?: () => void;
  connect?: () => void;
}) {
  const [error, setError] = useState(false);
  const tr = (fi: string, en: string) =>
    snapshot.state.language === "fi" ? fi : en;
  const connected = snapshot.ai.state === "connected";
  const models = snapshot.ai.models;
  const selected = snapshot.state.aiModel;
  const requested = useRef(false);
  useEffect(() => {
    if (!connected) {
      requested.current = false;
      return;
    }
    // Reuse this connection's known list; each explicit generation still discovers and pins its model.
    if (busy || models.length || requested.current) return;
    requested.current = true;
    void call("modelsAI", undefined, { preserveError: true }).then((ok) =>
      setError(!ok),
    );
  }, [connected, busy, models.length]);
  const missing =
    selected !== "auto" && !models.some((model) => model.slug === selected);
  if (connect && !connected) {
    const waiting = snapshot.ai.state === "waiting";
    const t = (key: Key) => (snapshot.state.language === "fi" ? fi : en)[key];
    return (
      <div className="composer-connect">
        <button
          type="button"
          className="secondary"
          disabled={busy || waiting}
          onClick={connect}
        >
          {tr("Yhdistä ChatGPT", "Connect ChatGPT")}
        </button>
        {settings && (
          <button type="button" className="text" onClick={settings}>
            {tr("Avaa ChatGPT ja tekoäly", "Open ChatGPT and AI")}
          </button>
        )}
        {waiting && <span role="status">{t("waitingAI")}</span>}
        {waiting && (
          <button
            type="button"
            className="text"
            disabled={busy}
            onClick={() => void call("cancelAI")}
          >
            {t("cancel")}
          </button>
        )}
        {!waiting &&
          (snapshot.ai.error || snapshot.ai.state === "permissionMissing") && (
            <span role="alert">
              {t(
                snapshot.ai.state === "permissionMissing"
                  ? "permissionMissing"
                  : "authFailed",
              )}
            </span>
          )}
      </div>
    );
  }
  return (
    <div className="model-control">
      <div className="model-selector">
        <span>{tr("AI-malli", "AI model")}</span>
        <Choice
          label={tr("AI-malli", "AI model")}
          value={selected}
          disabled={busy || !connected}
          onChange={(value) => call("setAIModel", value)}
          options={[
            { value: "auto", label: tr("Automaattinen", "Automatic") },
            ...(missing
              ? [
                  {
                    value: selected,
                    label: `${selected} · ${tr("ei saatavilla", "unavailable")}`,
                    disabled: true,
                  },
                ]
              : []),
            ...models.map((model) => ({
              value: model.slug,
              label: model.name,
            })),
          ]}
        />
      </div>
      {connected && !models.length && (
        <small>
          {tr("Malleja ei ole saatavilla.", "No models available.")}
        </small>
      )}
      {missing && (
        <small role="status">
          {tr(
            "Valittu malli ei ole saatavilla. Valitse toinen malli.",
            "The selected model is unavailable. Choose another model.",
          )}
        </small>
      )}
      {error && (
        <small role="alert">
          {tr(
            "Mallien haku epäonnistui. Avaa valitsin uudelleen.",
            "Could not load models. Open the selector again.",
          )}
        </small>
      )}
      {connected && (error || !models.length || !settings) && (
        <button
          className="text"
          disabled={busy}
          onClick={async () => setError(!(await call("modelsAI")))}
        >
          {tr("Hae mallit uudelleen", "Reload models")}
        </button>
      )}
      {settings && (!connected || error || missing || !models.length) && (
        <>
          {/* A space after the note before it, so the two never run together (B6.6). */}{" "}
          <button className="text" onClick={settings}>
            {tr("Avaa ChatGPT ja tekoäly", "Open ChatGPT and AI")}
          </button>
        </>
      )}
    </div>
  );
}

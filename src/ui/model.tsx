import React, { useEffect, useState } from "react";
import type { Snapshot } from "../application/service";
import { Choice } from "./choice";

export function ModelSelector({
  snapshot,
  busy,
  call,
  settings,
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: (
    method: string,
    input?: unknown,
    options?: { preserveError?: boolean },
  ) => Promise<boolean>;
  settings?: () => void;
}) {
  const [error, setError] = useState(false);
  const tr = (fi: string, en: string) =>
    snapshot.state.language === "fi" ? fi : en;
  const connected = snapshot.ai.state === "connected";
  const models = snapshot.ai.models;
  const selected = snapshot.state.aiModel;
  useEffect(() => {
    if (connected)
      void call("modelsAI", undefined, { preserveError: true }).then((ok) =>
        setError(!ok),
      );
  }, [connected]);
  const missing =
    selected !== "auto" && !models.some((model) => model.slug === selected);
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
      {!connected && (
        <small>
          {tr("Yhdistä ChatGPT asetuksissa.", "Connect ChatGPT in Settings.")}
        </small>
      )}
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
      {connected && (error || !models.length) && (
        <button
          className="text"
          disabled={busy}
          onClick={async () => setError(!(await call("modelsAI")))}
        >
          {tr("Hae mallit uudelleen", "Reload models")}
        </button>
      )}
      {settings && (!connected || error || missing || !models.length) && (
        <button className="text" onClick={settings}>
          {tr("Avaa ChatGPT ja tekoäly", "Open ChatGPT and AI")}
        </button>
      )}
    </div>
  );
}

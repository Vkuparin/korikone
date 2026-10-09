import React, { useEffect, useState } from "react";
import type { Snapshot } from "../application/service";

export function ModelSelector({
  snapshot,
  busy,
  call,
}: {
  snapshot: Snapshot;
  busy: boolean;
  call: (method: string, input?: unknown) => Promise<boolean>;
}) {
  const [error, setError] = useState(false);
  const tr = (fi: string, en: string) =>
    snapshot.state.language === "fi" ? fi : en;
  const connected = snapshot.ai.state === "connected";
  const models = snapshot.ai.models;
  const selected = snapshot.state.aiModel;
  useEffect(() => {
    if (connected) void call("modelsAI").then((ok) => setError(!ok));
  }, [connected]);
  const missing =
    selected !== "auto" && !models.some((model) => model.slug === selected);
  return (
    <div className="model-control">
      <label className="model-selector">
        <span>{tr("AI-malli", "AI model")}</span>
        <select
          aria-label={tr("AI-malli", "AI model")}
          value={selected}
          disabled={busy || !connected}
          onChange={(event) =>
            void call("setAIModel", event.currentTarget.value)
          }
        >
          <option value="auto">{tr("Automaattinen", "Automatic")}</option>
          {missing && (
            <option value={selected}>
              {selected} · {tr("ei saatavilla", "unavailable")}
            </option>
          )}
          {models.map((model) => (
            <option key={model.slug} value={model.slug}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
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
    </div>
  );
}

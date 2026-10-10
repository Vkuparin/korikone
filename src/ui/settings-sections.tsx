import React from "react";
import type { SettingsSectionProps } from "./settings-contract";
import { ModelSelector } from "./model";
import { Chains } from "./chains";
import { en, type Key } from "./i18n";
import { isLive } from "../stores/provider";
import { aiScenarios } from "../ai/scenarios";
import { useSettingsDraft } from "./settings";
const field = (label: string, control: React.ReactNode) => (
  <label>
    {label}
    {control}
  </label>
);

export function AdvancedSettings({
  snapshot,
  busy,
  call,
  save,
  t,
  developmentLocked,
}: SettingsSectionProps) {
  return (
    <section className="card form">
      <label>
        <input
          type="checkbox"
          checked={snapshot.developmentMode}
          disabled={busy || developmentLocked}
          onChange={(e) => void call("setDevelopmentMode", e.target.checked)}
        />
        {t("developmentMode")}
      </label>
      <p>{t("developmentModeInfo")}</p>
      {developmentLocked && <p className="muted">{t("developmentRequired")}</p>}
      {snapshot.developmentMode && (
        <>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void save({ ...snapshot.state, setupComplete: false })
            }
          >
            {t("restartSetup")}
          </button>
          <label>
            {t("developmentScenario")}
            <select
              value={snapshot.developmentScenario}
              disabled={busy}
              onChange={(e) => void call("developmentScenario", e.target.value)}
            >
              {aiScenarios.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void call("exportDiagnostics")}
      >
        {t("diagnostics")}
      </button>
    </section>
  );
}

export function DataSettings({
  snapshot,
  busy,
  call,
  save,
  t,
}: SettingsSectionProps) {
  const state = snapshot.state;
  const fi = state.language === "fi";
  const [draft, setDraft] = useSettingsDraft({ receipts: state.receiptText });
  return (
    <>
      <section className="card form">
        <h3>{fi ? "Aiemmat kuitit" : "Previous receipts"}</h3>
        <p>
          {fi
            ? "Tuo PDF-kuitti, teksti- tai CSV-tiedosto tai liitä ostosrivit alle. PDF:n teksti luetaan paikallisesti. Tietoja käytetään seuraavissa ChatGPT-ehdotuksissa. Skannattu PDF tarvitsee tekstintunnistuksen (OCR)."
            : "Import a PDF, text or CSV receipt, or paste purchase lines below. PDF text is extracted locally. These inform future ChatGPT suggestions. Scanned PDFs need OCR."}
        </p>
        <button disabled={busy} onClick={() => void call("importReceipt")}>
          {fi
            ? "Tuo kuitti (PDF, teksti tai CSV)"
            : "Import receipt (PDF, text or CSV)"}
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save({ ...state, receiptText: draft.receipts });
          }}
        >
          <label>
            {fi ? "Kuittien ostosrivit" : "Receipt purchase lines"}
            <textarea
              name="receipts"
              value={draft.receipts}
              onChange={(e) => setDraft({ receipts: e.target.value })}
              maxLength={50000}
            />
          </label>
          {draft.receipts !== state.receiptText && (
            <p role="status" className="muted">
              {t("receiptsUnapplied")}
            </p>
          )}
          <button disabled={busy}>{t("save")}</button>
        </form>
      </section>
      <details className="card">
        <summary>{t("dataManagement")}</summary>
        <p>{t("localData")}</p>
        <div className="actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void call("exportData")}
          >
            {t("backup")}
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void call("importData")}
          >
            {t("restore")}
          </button>
        </div>
      </details>
    </>
  );
}

export function AISettings({
  snapshot,
  busy,
  call,
  t,
  aiRequestLimit,
}: SettingsSectionProps) {
  const state = snapshot.state;
  return (
    <section className="card">
      <p>{t("aiConnectionInfo")}</p>
      <p role="status">
        {t(
          snapshot.ai.state === "connected"
            ? "signedIn"
            : snapshot.ai.state === "waiting"
              ? "waitingAI"
              : snapshot.ai.state === "permissionMissing"
                ? "permissionMissing"
                : "notConnected",
        )}
        {snapshot.ai.email ? ` · ${snapshot.ai.email}` : ""}
      </p>
      {snapshot.ai.error && (
        <p role="alert">
          {t(
            snapshot.ai.error in en ? (snapshot.ai.error as Key) : "authFailed",
          )}
        </p>
      )}
      <div className="actions">
        <button
          disabled={busy || snapshot.ai.state === "waiting"}
          onClick={() => void call("signInAI")}
        >
          Continue with ChatGPT
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void call("signOutAI")}
        >
          {t("signOut")}
        </button>
        <button className="secondary" onClick={() => void call("usageAI")}>
          {t("manageUsage")}
        </button>
        {snapshot.ai.state === "waiting" && (
          <button className="text" onClick={() => void call("cancelAI")}>
            {t("cancel")}
          </button>
        )}
      </div>
      <ModelSelector snapshot={snapshot} busy={busy} call={call} />
      <p data-testid="ai-allowance" className="muted">
        {state.language === "fi"
          ? "Jäljellä oleva ChatGPT-käyttömäärä ja käyttörajan nollausaika eivät ole saatavilla Korikonessa. Tarkista ne ChatGPT:n käyttöasetuksista."
          : "Remaining ChatGPT allowance and reset time are unavailable in Korikone. Check ChatGPT usage settings."}
      </p>
      {aiRequestLimit && (
        <p role="alert">
          {state.language === "fi"
            ? "Viimeisin pyyntö saavutti käyttö- tai pyyntönopeusrajan. Jäljellä oleva käyttömäärä ja nollausaika eivät ole tiedossa."
            : "The latest request reached a usage or rate limit. Remaining allowance and reset time are unknown."}
        </p>
      )}
      <p className="muted">
        {state.language === "fi"
          ? "Automaattinen suosii tilillä saatavilla olevaa pientä mallia käytön vähentämiseksi. Mallin nimi kertoo kokoluokasta, mutta ei tarkkaa hintaa. Jos sopivaa pientä mallia ei löydy, valitse malli itse."
          : "Automatic prefers a small model available to your account to reduce usage. Model names indicate size, but do not establish exact prices. If no suitable small model is available, choose a model yourself."}
      </p>
    </section>
  );
}

export function StoresSettings({
  snapshot,
  busy,
  call,
  save,
  t,
}: SettingsSectionProps) {
  const state = snapshot.state;
  return (
    <section className="card form">
      <details>
        <summary>{t("advancedSettings")}</summary>
        {field(
          t("store"),
          <select
            aria-label={t("store")}
            value={state.context.providerId}
            onChange={(e) =>
              void save({
                ...state,
                context: {
                  ...state.context,
                  providerId: e.target.value,
                  storeName: `${e.target.value === "demo-k" ? "K-Ruoka" : "S-kaupat"} · Helsinki (demo)`,
                },
              })
            }
          >
            <option value="demo-k">K-Ruoka (demo)</option>
            <option value="demo-s">S-kaupat (demo)</option>
            {isLive(state.context.providerId) && (
              <option value={state.context.providerId}>
                {state.context.storeName}
              </option>
            )}
          </select>,
        )}
        {field(
          t("pickup") + " / " + t("delivery"),
          <select
            value={state.context.fulfillment}
            disabled={isLive(state.context.providerId)}
            onChange={(e) =>
              void save({
                ...state,
                context: {
                  ...state.context,
                  fulfillment: e.target.value as "pickup" | "delivery",
                },
              })
            }
          >
            <option value="pickup">{t("pickup")}</option>
            <option value="delivery">{t("delivery")}</option>
          </select>,
        )}
      </details>
      <h3>{t("storeConnection")}</h3>
      {isLive(state.context.providerId) && (
        <p>
          <strong>{state.context.storeName}</strong>
        </p>
      )}
      <h3>{t("chainsTitle")}</h3>
      <p className="muted">{t("chainsHelp")}</p>
      <Chains snapshot={snapshot} t={t} busy={busy} call={call} />
      <p>K-Ruoka: {t("realStatus")}</p>
      <p>S-kaupat: {t("sKaupatStatus")}</p>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          void call(
            "searchStores",
            String(new FormData(e.currentTarget).get("query")),
          );
        }}
      >
        <label>
          {t("searchStores")}
          <input name="query" minLength={2} required placeholder="Helsinki" />
        </label>
        <button disabled={busy}>{t("search")}</button>
      </form>
      {snapshot.storeResults.map((store) => (
        <button
          className="secondary"
          disabled={busy}
          key={store.storeId}
          onClick={() => void save({ ...state, context: store })}
        >
          {store.storeName}
        </button>
      ))}
    </section>
  );
}

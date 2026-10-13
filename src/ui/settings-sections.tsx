import React, { useRef, useState } from "react";
import type { SettingsSectionProps } from "./settings-contract";
import { ModelSelector } from "./model";
import { Chains } from "./chains";
import { en, type Key } from "./i18n";
import { isLive } from "../stores/provider";
import { aiScenarios } from "../ai/scenarios";
import { useSettingsDraft } from "./settings";
import { CategoryPreferences } from "./category-preferences";
import { ReceiptsPanel } from "./receipts";
import { PurchaseMemory } from "./purchase-memory";
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
      <h3>{t("aiBehavior")}</h3>
      <label>
        <input
          type="checkbox"
          checked={snapshot.state.resolverEnabled}
          disabled={busy}
          onChange={(e) =>
            void save({ ...snapshot.state, resolverEnabled: e.target.checked })
          }
        />
        {t("resolverEnabled")}
      </label>
      <p className="muted">{t("resolverInfo")}</p>
      <label>
        <input
          type="checkbox"
          checked={snapshot.state.reviewBeforeTransfer}
          disabled={busy}
          onChange={(e) =>
            void call("setReviewBeforeTransfer", { enabled: e.target.checked })
          }
        />
        {snapshot.state.language === "fi"
          ? "Tarkista ennen siirtoa"
          : "Review before transfer"}
      </label>
      <p className="muted">
        {snapshot.state.language === "fi"
          ? "Päällä siirto pysähtyy tarkistukseen ennen kuin mitään lisätään kauppaan. Pois päältä lista siirretään yhdellä painalluksella; tarkistus kysytään silti, jos jokin ei täsmää. Asetus ei muuta listaa eikä tee pyyntöjä."
          : "When on, the transfer stops for a review before anything is added to the store. When off, the list is sent with one click; a review is still asked for when something does not match. The setting changes no list and makes no request."}
      </p>
      <CategoryPreferences snapshot={snapshot} busy={busy} call={call} />
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
  // The saved text this edit started from. Saving against it lets the app refuse a stale edit.
  const editBase = useRef(state.receiptText);
  const [saved, setSaved] = useState(false);
  if (draft.receipts === state.receiptText)
    editBase.current = state.receiptText;
  return (
    <>
      <section className="card form">
        <h3>{fi ? "Aiemmat kuitit" : "Previous receipts"}</h3>
        <ReceiptsPanel
          snapshot={snapshot}
          busy={busy}
          call={call}
          language={state.language}
        />
        <PurchaseMemory snapshot={snapshot} busy={busy} call={call} />
        <p>
          {fi
            ? "Tai liitä ostosrivit tekstinä alle. Teksti säilyy sellaisenaan, kunnes tuot sen kuiteiksi. Skannattu PDF tarvitsee tekstintunnistuksen (OCR)."
            : "Or paste purchase lines as text below. The text is kept unchanged until you import it as receipts. Scanned PDFs need OCR."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSaved(false);
            const text = draft.receipts;
            // Success is shown only after the text is stored; a failure keeps the edit as typed.
            const ok = await call("setReceiptText", {
              text,
              base: editBase.current,
            });
            if (ok) setSaved(true);
            else {
              // After a refusal the shopper has been told; the next Save replaces knowingly,
              // against the text that is saved now.
              const current = await window.korikone.load();
              if (current.ok)
                editBase.current = current.value.state.receiptText;
            }
          }}
        >
          <label>
            {fi ? "Kuittien ostosrivit" : "Receipt purchase lines"}
            <textarea
              name="receipts"
              value={draft.receipts}
              onChange={(e) => {
                setSaved(false);
                setDraft({ receipts: e.target.value });
              }}
              maxLength={50000}
            />
          </label>
          {draft.receipts !== state.receiptText ? (
            <p role="status" className="muted">
              {t("receiptsUnapplied")}
            </p>
          ) : (
            saved && <p role="status">{t("receiptsSaved")}</p>
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
          className={
            snapshot.ai.state === "connected" ? "chatgpt-connected" : undefined
          }
          disabled={
            busy ||
            snapshot.ai.state === "waiting" ||
            snapshot.ai.state === "connected"
          }
          onClick={() => void call("signInAI")}
        >
          {snapshot.ai.state === "connected"
            ? t("signedInChatGPT")
            : "Continue with ChatGPT"}
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
  storeOpen,
  returnToStore,
}: SettingsSectionProps) {
  const state = snapshot.state;
  const fi = state.language === "fi";
  return (
    <section className="card form">
      {storeOpen && returnToStore && (
        <p>
          <button className="secondary" onClick={returnToStore}>
            {fi ? "Palaa kauppaan" : "Return to store"}
          </button>
        </p>
      )}
      <fieldset className="price-basis">
        <legend>{fi ? "Hintavertailu" : "Price comparison"}</legend>
        {field(
          fi ? "Edullisin vaihtoehto" : "Best price",
          <select
            aria-label={fi ? "Hintaperuste" : "Price basis"}
            value={state.priceBasis}
            disabled={busy}
            onChange={(e) =>
              void call("setPriceBasis", {
                priceBasis: e.target.value as "unit" | "total",
              })
            }
          >
            <option value="unit">
              {fi ? "Pienin yksikköhinta" : "Lowest unit price"}
            </option>
            <option value="total">
              {fi ? "Pienin kokonaishinta" : "Lowest total cost"}
            </option>
          </select>,
        )}
        <p className="muted">
          {fi
            ? "Sama valinta koskee molempia kauppaketjuja. Parempi yksikköhinta voi maksaa kerralla enemmän. Asetus ei muuta nykyistä listaa; se vaikuttaa seuraavaan hinnoitteluun ja vaihtoehtojen järjestykseen."
            : "The same choice applies to both chains. A better unit price can cost more at the checkout. The setting does not change the current list; it affects the next pricing and the order of alternatives."}
        </p>
      </fieldset>
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
    </section>
  );
}

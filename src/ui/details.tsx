import React from "react";
import type { Snapshot } from "../application/service";
import type { BasketLine, Product, Unit } from "../domain/model";
import { en, fi, packCount, unitLabel, type Key } from "./i18n";
import { selectableCandidate, matchingPolicy } from "../domain/matching";
import {
  categoryPreferenceSchema,
  type CategoryPreference,
} from "../domain/preferences";
import { exclusionTerms } from "../domain/planner";
import { matchingReasonLabel } from "./matching-reasons";
import { preferenceAttributeLabel } from "./category-preferences";
import { approximateCost, pieceQuote } from "../domain/planner";

/**
 * The decision details of one list row: what is needed and bought, why this product,
 * unit prices and the other products the store offered. Opened from the row's product name.
 */
export function RowDetails({
  snapshot,
  line,
  busy,
  money,
  choose,
  remember,
  confirmPack,
  cheaper,
}: {
  snapshot: Snapshot;
  line: BasketLine;
  busy: boolean;
  money: (cents: number) => string;
  choose: (product: Product) => void;
  remember: (input: {
    revision: number;
    requirementKey: string;
    productId: string;
    preference: CategoryPreference;
  }) => Promise<boolean>;
  confirmPack: (product: Product, amount: number, unit: Unit) => void;
  /** A cheaper product for the same ingredient, with its cost for the needed amount. */
  cheaper: { product: Product; total: number } | null;
}) {
  const { state } = snapshot;
  const language = state.language;
  const t = (key: Key) => (language === "fi" ? fi : en)[key];
  const u = (unit: string) => unitLabel(unit, language);
  const unitPrice = (p: Product) =>
    approximateCost(line.requirement, p) !== null
      ? `${money(p.cataloguePricing!.amount!)} / ${p.cataloguePricing!.unit!.toLowerCase()}`
      : p.price === null || !p.packAmount
        ? ""
        : p.unit === "pcs"
          ? `${money(p.price / p.packAmount)} / ${t("perPiece")}`
          : `${money(Math.round((p.price * 1000) / p.packAmount))} / ${p.unit === "g" ? "kg" : "l"}`;
  const { requirement, product } = line;
  const [memoryDraft, setMemoryDraft] = React.useState<{
    product: Product;
    preference: CategoryPreference;
    revision: number;
  } | null>(null);
  const rememberButton = React.useRef<HTMLButtonElement | null>(null);
  const strengthInput = React.useRef<HTMLSelectElement | null>(null);
  React.useEffect(() => {
    if (memoryDraft) strengthInput.current?.focus();
  }, [memoryDraft?.product.id]);
  const closeMemory = () => {
    setMemoryDraft(null);
    rememberButton.current?.focus();
  };
  const options = {
    preferences: state.categoryPreferences,
    context: state.context,
    exclusions: exclusionTerms(state.household.exclusions),
  };
  const policy = matchingPolicy(requirement, options);
  const savedRule = state.categoryPreferences.find(
    (rule) => rule.category === policy.category,
  );
  const overridesMemory = policy.required.some(
    (qualifier) =>
      qualifier.source === "explicit-note" &&
      savedRule?.qualifiers.some(
        (saved) =>
          saved.kind === qualifier.kind && saved.value !== qualifier.value,
      ),
  );
  const piece = product ? pieceQuote(requirement, product) : null;
  const context = state.context;
  const accepted =
    state.accepted[
      `${context.providerId}:${context.storeId}:${requirement.id}`
    ] ?? [];
  const bought = product ? line.packs * product.packAmount : 0;
  return (
    <div
      className="row-details"
      role="region"
      aria-label={`${language === "fi" ? "Tiedot" : "Details"}: ${requirement.name}`}
    >
      <p>
        {t("required")}: {requirement.amount} {u(requirement.unit)}
        {product && !line.approximate && (
          <>
            {" · "}
            {t("bought")}: {packCount(line.packs, language)}, {bought}{" "}
            {u(product.unit)}
            {bought > requirement.amount &&
              ` · ${t("surplus")}: ${bought - requirement.amount} ${u(product.unit)}`}
          </>
        )}
      </p>
      {line.matching && (
        <p
          className={line.matching.status === "resolved" ? "muted" : "warning"}
        >
          {matchingReasonLabel(line.matching.reason, language)}
        </p>
      )}
      {overridesMemory && (
        <p className="muted">
          {language === "fi"
            ? "Nykyisen listan tarkka pyyntö ohittaa muistetun tyypin tällä kertaa. Muistettu sääntö säilyy."
            : "The specific request in this list overrides the remembered type this time. The saved rule stays unchanged."}
        </p>
      )}
      {piece && (
        <p>
          {language === "fi" ? "Tilataan" : "Order"}: {piece.pieces} {u("pcs")}{" "}
          · {language === "fi" ? "paino noin" : "weight about"}{" "}
          {Math.round(piece.weightGrams)} g
        </p>
      )}
      {line.approximate && (
        <p className="muted">
          {language === "fi"
            ? "Hinta on arvio tarvittavalle määrälle. Lopullinen paino ja hinta voivat muuttua."
            : "Price is estimated for the required amount. Final weight and price may change."}
        </p>
      )}
      {product ? (
        <p className="muted">
          {!line.matching &&
            t(
              accepted.includes(product.id)
                ? "reasonAccepted"
                : "reasonCheapest",
            )}
          {unitPrice(product) && ` ${unitPrice(product)}`}
          {product.deposit > 0 &&
            ` · ${t("deposit")} ${money(product.deposit)}`}
        </p>
      ) : (
        <p className="warning">
          {t(line.candidates.length ? "unresolved" : "noCandidates")}
        </p>
      )}
      {cheaper && (
        <p className="row-alternative">
          {language === "fi" ? "Edullisempi vastaava" : "Cheaper alternative"}:{" "}
          {cheaper.product.name} · {money(cheaper.total)}{" "}
          <button
            className="text"
            disabled={busy}
            onClick={() => choose(cheaper.product)}
          >
            {language === "fi" ? "Vaihda" : "Swap"}
          </button>
        </p>
      )}
      {!!line.excluded && (
        <p className="muted">
          {t("excludedProducts")}: {line.excluded}
        </p>
      )}
      {line.candidates.length > 0 && (
        <ul className="candidates">
          {line.candidates.map((p) => (
            <li className="candidate" key={p.id}>
              <span className="candidate-name">{p.name}</span>
              <small>
                {p.packAmount
                  ? `${p.packAmount} ${u(p.unit)}`
                  : t("packSizeUnknown")}
                {unitPrice(p) && ` · ${unitPrice(p)}`}
                {p.deposit > 0 && ` · ${t("deposit")} ${money(p.deposit)}`}
              </small>
              <strong>
                {approximateCost(requirement, p) !== null
                  ? `${language === "fi" ? "noin " : "about "}${money(approximateCost(requirement, p)!)}`
                  : p.price === null
                    ? t("unknown")
                    : money(p.price)}
              </strong>
              <button
                className="secondary"
                aria-label={`${language === "fi" ? "Käytä kerran" : "Use once"}: ${p.name}`}
                disabled={
                  busy ||
                  !selectableCandidate(requirement, p, {
                    ...options,
                    accepted: [p.id],
                  }) ||
                  p.id === product?.id
                }
                onClick={() => choose(p)}
              >
                {p.id === product?.id
                  ? t("chosen")
                  : p.available
                    ? language === "fi"
                      ? "Käytä kerran"
                      : "Use once"
                    : p.available === false
                      ? t("unavailable")
                      : t("stockUnknown")}
              </button>
              {p.id !== product?.id &&
                line.matching?.decisions.find(
                  (decision) => decision.id === p.id,
                ) && (
                  <small className="candidate-reason">
                    {matchingReasonLabel(
                      line.matching.decisions.find(
                        (decision) => decision.id === p.id,
                      )!.reason,
                      language,
                    )}
                  </small>
                )}
              {(() => {
                const rule = categoryPreferenceSchema.safeParse({
                  category: matchingPolicy(requirement).category,
                  qualifiers: p.evidence?.qualifiers ?? [],
                  strength: "preferred",
                });
                if (
                  !rule.success ||
                  !selectableCandidate(requirement, p, {
                    ...options,
                    preferences: [],
                    preference: rule.data,
                    accepted: [p.id],
                  })
                )
                  return null;
                return (
                  <button
                    className="text"
                    disabled={busy}
                    aria-label={`${language === "fi" ? "Muista tyyppi" : "Remember type"}: ${p.name}`}
                    onClick={(event) => {
                      rememberButton.current = event.currentTarget;
                      setMemoryDraft({
                        product: p,
                        preference: rule.data,
                        revision: state.revision,
                      });
                    }}
                  >
                    {language === "fi" ? "Muista tyyppi…" : "Remember type…"}
                  </button>
                );
              })()}
              {approximateCost(requirement, p) === null &&
                (!p.packAmount || p.id in state.packSizes) && (
                  <PackSizeForm
                    key={`${p.id}:${p.packAmount}`}
                    product={p}
                    language={language}
                    busy={busy}
                    confirm={confirmPack}
                  />
                )}
            </li>
          ))}
        </ul>
      )}
      {memoryDraft && (
        <form
          className="form row-memory"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !busy) {
              event.stopPropagation();
              closeMemory();
            }
          }}
          onSubmit={async (event) => {
            event.preventDefault();
            const applied = await remember({
              revision: memoryDraft.revision,
              requirementKey: `${requirement.id}:${requirement.unit}`,
              productId: memoryDraft.product.id,
              preference: memoryDraft.preference,
            });
            if (applied) closeMemory();
          }}
        >
          <strong>
            {language === "fi"
              ? "Muistetaanko tuotetyyppi?"
              : "Remember this product type?"}
          </strong>
          <p>
            {memoryDraft.preference.qualifiers
              .map(
                (qualifier) =>
                  `${preferenceAttributeLabel(qualifier.kind, language)}: ${preferenceAttributeLabel(qualifier.value, language)}`,
              )
              .join(" · ")}
          </p>
          <label>
            {language === "fi" ? "Valinnan merkitys" : "Meaning of the choice"}
            <select
              ref={strengthInput}
              disabled={busy}
              value={memoryDraft.preference.strength}
              onChange={(event) =>
                setMemoryDraft({
                  ...memoryDraft,
                  preference: {
                    ...memoryDraft.preference,
                    strength: event.target.value as "required" | "preferred",
                  },
                })
              }
            >
              <option value="preferred">
                {language === "fi" ? "Suosittu" : "Preferred"}
              </option>
              <option value="required">
                {language === "fi" ? "Vaadittu" : "Required"}
              </option>
            </select>
          </label>
          <p>
            {language === "fi"
              ? "Vaadittu tyyppi pitää löytyä. Suosittu tyyppi on ensisijainen; muun tyypin käyttö vaatii hyväksyntäsi. Sääntö koskee myös tulevia listoja molemmissa kauppaketjuissa."
              : "Required types must be available. Preferred types are tried first; another type needs your approval. This rule also applies to future lists on both chains."}
          </p>
          <button
            disabled={busy || memoryDraft.revision !== state.revision}
            type="submit"
          >
            {language === "fi" ? "Muista tyyppi" : "Remember type"}
          </button>
          <button
            disabled={busy}
            className="secondary"
            type="button"
            onClick={closeMemory}
          >
            {language === "fi" ? "Peruuta" : "Cancel"}
          </button>
          {memoryDraft.revision !== state.revision && (
            <p className="warning">
              {language === "fi"
                ? "Lista muuttui. Peruuta ja avaa valinta uudelleen."
                : "The list changed. Cancel and reopen this choice."}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/** Lets the shopper state the pack size of a product whose label the store leaves out. */
function PackSizeForm({
  product,
  language,
  busy,
  confirm,
}: {
  product: Product;
  language: string;
  busy: boolean;
  confirm: (product: Product, amount: number, unit: Unit) => void;
}) {
  const t = (key: Key) => (language === "fi" ? fi : en)[key];
  const [amount, setAmount] = React.useState(
    product.packAmount ? String(product.packAmount) : "",
  );
  const [unit, setUnit] = React.useState<Unit>(
    product.packAmount ? product.unit : "g",
  );
  const value = Number(amount);
  return (
    <form
      className="pack-size"
      onSubmit={(event) => {
        event.preventDefault();
        confirm(product, value, unit);
      }}
    >
      <input
        type="number"
        min={1}
        step={1}
        value={amount}
        aria-label={`${t("packSizeAmount")}: ${product.name}`}
        onChange={(event) => setAmount(event.target.value)}
      />
      <select
        value={unit}
        aria-label={`${t("packSizeUnit")}: ${product.name}`}
        onChange={(event) => setUnit(event.target.value as Unit)}
      >
        {(["g", "ml", "pcs"] as const).map((x) => (
          <option key={x} value={x}>
            {unitLabel(x, language)}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="secondary"
        disabled={busy || !Number.isInteger(value) || value < 1}
      >
        {t("confirmPackSize")}
      </button>
    </form>
  );
}

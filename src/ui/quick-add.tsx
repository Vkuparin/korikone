import { useRef, useState, type FormEvent } from "react";
import { addGrocery, lastGroceryAmount } from "../domain/groceries";
import type { AppState, Unit } from "../domain/model";

export function QuickAdd({
  state,
  busy,
  save,
  showTransfer,
}: {
  state: AppState;
  busy: boolean;
  save: (next: AppState) => Promise<boolean>;
  showTransfer?: () => void;
}) {
  const fi = state.language === "fi";
  const tr = (a: string, b: string) => (fi ? a : b);
  const item = useRef<HTMLInputElement>(null);
  const amount = useRef<HTMLInputElement>(null);
  const unitField = useRef<HTMLSelectElement>(null);
  // Set once the shopper edits the amount or unit; a typed name then never overrides them.
  const amountTouched = useRef(false);
  const draftVersion = useRef(0);
  const [error, setError] = useState<
    "missingName" | "longName" | "wholeAmount" | "decimalAmount" | null
  >(null);
  const [added, setAdded] = useState("");
  const nameError = error === "missingName" || error === "longName";
  const amountError = error === "wholeAmount" || error === "decimalAmount";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("item")).trim();
    const unit = String(data.get("unit")) as Unit | "kg" | "l";
    let next: AppState;
    try {
      next = addGrocery(state, name, String(data.get("amount")), unit);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "invalidGroceryName") {
        setError(name ? "longName" : "missingName");
        item.current?.focus();
      } else {
        setError(
          unit === "kg" || unit === "l" ? "decimalAmount" : "wholeAmount",
        );
        amount.current?.focus();
      }
      return;
    }
    setError(null);
    item.current?.focus();
    item.current?.select();
    const submitted = draftVersion.current;
    if (
      (await save(next)) &&
      form.isConnected &&
      submitted === draftVersion.current
    ) {
      form.reset();
      amountTouched.current = false;
      setAdded(name);
    }
  }

  return (
    <form
      className="quick-add"
      noValidate
      onSubmit={submit}
      onChange={(event) => {
        draftVersion.current++;
        const editingName = item.current?.isSameNode(event.target);
        if (!editingName) amountTouched.current = true;
        else if (
          !amountTouched.current &&
          amount.current &&
          unitField.current
        ) {
          // B7.3: the amount last used for this name, or the plain default.
          const last = lastGroceryAmount(state, item.current!.value);
          amount.current.value = last?.amount ?? "1";
          unitField.current.value = last?.unit ?? "pcs";
        }
        if (nameError === editingName) setError(null);
        setAdded("");
      }}
    >
      <label>
        {tr("Lisää tuote", "Add grocery")}
        <input
          ref={item}
          id="quick-add-item"
          name="item"
          placeholder={tr("Esim. kahvi", "e.g. coffee")}
          required
          maxLength={200}
          aria-invalid={nameError || undefined}
          aria-describedby={nameError ? "quick-add-error" : undefined}
        />
      </label>
      <div className="quick-add-options">
        <label>
          {tr("Määrä", "Amount")}
          <input
            ref={amount}
            name="amount"
            aria-label={tr("Tuotteen määrä", "Grocery amount")}
            inputMode="decimal"
            defaultValue="1"
            required
            aria-invalid={amountError || undefined}
            aria-describedby={amountError ? "quick-add-error" : undefined}
          />
        </label>
        <label>
          {tr("Yksikkö", "Unit")}
          <select
            ref={unitField}
            name="unit"
            aria-label={tr("Tuotteen yksikkö", "Grocery unit")}
          >
            <option value="pcs">{tr("kpl", "pcs")}</option>
            <option value="g">g</option>
            <option value="kg">kg</option>
            <option value="ml">ml</option>
            <option value="l">l</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          aria-label={tr("Lisää tuote listaan", "Add grocery to list")}
        >
          {tr("Lisää", "Add")}
        </button>
      </div>
      {error && (
        <p className="quick-add-error" id="quick-add-error" role="alert">
          {error === "missingName"
            ? tr("Kirjoita tuotteen nimi.", "Enter a grocery name.")
            : error === "longName"
              ? tr("Lyhennä tuotteen nimeä.", "Use a shorter grocery name.")
              : error === "wholeAmount"
                ? tr(
                    "Anna positiivinen määrä kokonaislukuna.",
                    "Enter a positive whole number.",
                  )
                : tr(
                    "Anna positiivinen määrä enintään kolmella desimaalilla.",
                    "Enter a positive amount with up to three decimal places.",
                  )}
        </p>
      )}
      <span className="quick-add-status" role="status">
        {added && (fi ? `Lisätty: ${added}` : `Added: ${added}`)}
      </span>
      {added && showTransfer && (
        <button type="button" className="text" onClick={showTransfer}>
          {tr("Näytä siirrettävät tuotteet", "View items to send")}
        </button>
      )}
    </form>
  );
}

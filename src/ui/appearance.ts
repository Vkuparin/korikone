import type { AppearanceBootstrap } from "../domain/appearance";

let applied = -1;
/** Applies a published value unless a newer one is already shown. Returns whether it applied. */
export function applyAppearance(value: AppearanceBootstrap): boolean {
  if (value.sequence < applied) return false;
  applied = value.sequence;
  document.documentElement.dataset.appearance = value.preference;
  document.documentElement.dataset.theme = value.resolved;
  document.documentElement.dataset.chain = value.chain;
  return true;
}

export function subscribeAppearance(
  changed?: (value: AppearanceBootstrap) => void,
): () => void {
  const apply = (value: AppearanceBootstrap) => {
    if (applyAppearance(value)) changed?.(value);
  };
  const unsubscribe = window.korikone.onAppearanceChange(apply);
  apply(window.korikone.getAppearanceBootstrap());
  return unsubscribe;
}

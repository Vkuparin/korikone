import type { AppearanceBootstrap } from "../domain/appearance";

export function applyAppearance(value: AppearanceBootstrap) {
  document.documentElement.dataset.appearance = value.preference;
  document.documentElement.dataset.theme = value.resolved;
}

export function subscribeAppearance(
  changed?: (value: AppearanceBootstrap) => void,
): () => void {
  const apply = (value: AppearanceBootstrap) => {
    applyAppearance(value);
    changed?.(value);
  };
  const unsubscribe = window.korikone.onAppearanceChange(apply);
  apply(window.korikone.getAppearanceBootstrap());
  return unsubscribe;
}

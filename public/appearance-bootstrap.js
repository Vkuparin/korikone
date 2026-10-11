// Blocking startup read: apply the saved preference and chain identity before styles and React paint.
const appearance = window.korikone.getAppearanceBootstrap();
document.documentElement.dataset.appearance = appearance.preference;
document.documentElement.dataset.theme = appearance.resolved;
document.documentElement.dataset.chain = appearance.chain;

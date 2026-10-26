/** Permissions store pages may use: sign-in and the cart need nothing else (B5.7). */
const STORE_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen"]);
export const storePermissionAllowed = (permission: string) =>
  STORE_PERMISSIONS.has(permission);
/** A page script that has not answered in this time is treated as a stalled page. */
export const STORE_SCRIPT_TIMEOUT_MS = 30_000;
/** Settles with the script's result, or rejects with `storeUnavailable` after `ms`. */
export function withTimeout<T>(
  run: Promise<T>,
  ms: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    run,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new Error("storeUnavailable"));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

import { z } from "zod";

export const UPDATE_KEY = "update-check";
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
// The release list, not `/releases/latest`: that endpoint skips pre-releases and answers 404
// while every published Korikone release is a pre-release.
const RELEASES_API =
  "https://api.github.com/repos/Vkuparin/korikone/releases?per_page=20";
const RELEASE_PAGE = "https://github.com/Vkuparin/korikone/releases/";

export type Update = { version: string; url: string };
const savedSchema = z.object({
  checkedAt: z.number(),
  update: z.object({ version: z.string(), url: z.string() }).nullable(),
});
const releaseSchema = z.object({
  tag_name: z.string().max(100),
  html_url: z.string().max(500),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});

const parts = (version: string) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim());
  return m ? { n: [+m[1], +m[2], +m[3]], pre: m[4] ?? null } : null;
};
/** True when `latest` is a newer version than `current`; a release beats its own prerelease. */
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest);
  const b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i] > b.n[i];
  if (a.pre === b.pre) return false;
  if (a.pre === null) return true;
  if (b.pre === null) return false;
  const x = a.pre.split(".");
  const y = b.pre.split(".");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return false;
    if (y[i] === undefined) return true;
    if (x[i] === y[i]) continue;
    const nx = /^\d+$/.test(x[i]);
    const ny = /^\d+$/.test(y[i]);
    return nx && ny ? +x[i] > +y[i] : nx ? false : ny ? true : x[i] > y[i];
  }
  return false;
}

export interface UpdateStorage {
  get(key: string): Promise<any>;
  set(key: string, value: unknown): Promise<any>;
}

/**
 * Whether an installation should hear about pre-releases. Before 1.0.0 every release is published
 * as a GitHub pre-release, so a 0.x installation, or one that is itself a pre-release, is offered
 * them. A stable 1.0.0 or later installation is offered stable releases only.
 */
export function acceptsPrereleases(current: string): boolean {
  const version = parts(current);
  return !!version && (version.n[0] === 0 || version.pre !== null);
}

/**
 * Asks GitHub Releases whether a newer version exists, at most once a day. Between checks the
 * saved answer is reused. A failed check is remembered as "no update" until the next day.
 * The newest eligible release in the list wins; drafts and pages outside the project never
 * count. Nothing is downloaded; the result is only a version and the release page to open.
 */
export async function checkForUpdate(
  current: string,
  db: UpdateStorage,
  fetchJson: (url: string) => Promise<unknown>,
  now = Date.now(),
): Promise<Update | null> {
  const saved = savedSchema.safeParse(await db.get(UPDATE_KEY));
  if (saved.success && now - saved.data.checkedAt < UPDATE_INTERVAL_MS)
    return saved.data.update && isNewer(saved.data.update.version, current)
      ? saved.data.update
      : null;
  let update: Update | null = null;
  try {
    const reply = await fetchJson(RELEASES_API);
    const prereleases = acceptsPrereleases(current);
    for (const entry of Array.isArray(reply) ? reply : [reply]) {
      const release = releaseSchema.safeParse(entry);
      if (
        !release.success ||
        release.data.draft ||
        (release.data.prerelease && !prereleases) ||
        !release.data.html_url.startsWith(RELEASE_PAGE) ||
        !isNewer(release.data.tag_name, current) ||
        (update && !isNewer(release.data.tag_name, update.version))
      )
        continue;
      update = {
        version: release.data.tag_name.replace(/^v/, ""),
        url: release.data.html_url,
      };
    }
  } catch {
    update = null;
  }
  await db.set(UPDATE_KEY, { checkedAt: now, update }).catch(() => {});
  return update;
}

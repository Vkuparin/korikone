import {
  BrowserWindow,
  WebContentsView,
  dialog,
  session,
  shell,
  type Rectangle,
} from "electron";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type Chain = "k-ruoka" | "s-kaupat";
export type StorePage = "home" | "cart" | "login";

const SITES: Record<Chain, { origin: string; domains: string[] }> = {
  "s-kaupat": {
    origin: "https://www.s-kaupat.fi",
    domains: ["s-kaupat.fi", "s-ryhma.fi", "voikukka.fi"],
  },
  "k-ruoka": {
    origin: "https://www.k-ruoka.fi",
    domains: ["k-ruoka.fi", "kesko.fi", "k-tunnus.fi"],
  },
};
// S-kaupat has no cart Korikone writes to; its transfer goes to a list under "Ostoslistat".
const PATHS: Record<Chain, Record<StorePage, string>> = {
  "s-kaupat": { home: "/", cart: "/ostoslistat", login: "/" },
  "k-ruoka": { home: "/", cart: "/kauppa/ostoskori", login: "/" },
};
/** The page the hidden background page loads: it must run the site's own start-up code. */
const BACKGROUND_PATH: Record<Chain, string> = {
  "s-kaupat": "/",
  "k-ruoka": "/kauppa",
};
/** Scrolls the add-all button into view; the data-test-id is the site's own hook, the text the fallback. */
const SCROLL_TO_ADD_ALL = `(async () => {
  for (let i = 0; i < 20; i++) {
    const button =
      document.querySelector("button[data-test-id=addAllToCart]") ||
      [...document.querySelectorAll("button")].find((b) =>
        (b.textContent || "").trim().startsWith("Lisää kaikki ostoskoriin"),
      );
    if (button) {
      button.scrollIntoView({ block: "center" });
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
})()`;
/** Payment providers and banks a checkout may redirect to; they open without asking. */
const PAYMENT_DOMAINS = [
  "paytrail.com",
  "checkout.fi",
  "nets.eu",
  "netaxept.com",
  "op.fi",
  "nordea.fi",
  "nordea.com",
  "danskebank.fi",
  "s-pankki.fi",
  "aktia.fi",
  "saastopankki.fi",
  "poppankki.fi",
  "omasp.fi",
  "handelsbanken.fi",
  "alandsbanken.fi",
  "mobilepay.fi",
  "klarna.com",
  "svea.com",
];
const within = (host: string, domains: string[]) =>
  domains.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * One store tab per chain, shown inside the Korikone window. Store pages run with no preload and
 * in a sandbox, each chain in its own persistent session. In development mode the tabs load the
 * local fixture site and any request to the real store hosts is cancelled.
 */
export class StoreViews {
  private views = new Map<Chain, WebContentsView>();
  private backgrounds = new Map<Chain, WebContentsView>();
  private shown: Chain | null = null;
  private fixture: Promise<string> | null = null;
  private server: Server | null = null;
  private allowOnce = new Set<string>();

  constructor(
    private window: BrowserWindow,
    private development: () => boolean,
    private language: () => string,
  ) {}

  private async origin(chain: Chain) {
    if (!this.development()) return SITES[chain].origin;
    this.fixture ??= fixtureSite().then(({ server, origin }) => {
      this.server = server;
      return origin;
    });
    return `${await this.fixture}/${chain}`;
  }

  private allowed(chain: Chain, url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (this.development())
      return parsed.hostname === "127.0.0.1" && parsed.protocol === "http:";
    return (
      parsed.protocol === "https:" &&
      (within(parsed.hostname, SITES[chain].domains) ||
        within(parsed.hostname, PAYMENT_DOMAINS))
    );
  }

  /** Leaving the chain's own and payment domains asks first; the answer holds for that one page. */
  private async navigate(chain: Chain, view: WebContentsView, url: string) {
    if (this.allowOnce.delete(url) || this.allowed(chain, url)) {
      await view.webContents.loadURL(url);
      return;
    }
    if (this.development()) throw new Error("hostRefused");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
    const fi = this.language() === "fi";
    const { response } = await dialog.showMessageBox(this.window, {
      type: "question",
      message: fi
        ? `Avataanko ${parsed.hostname}?`
        : `Open ${parsed.hostname}?`,
      detail: fi
        ? "Sivu on kaupan ja maksupalvelujen ulkopuolella."
        : "The page is outside the store and payment services.",
      buttons: fi ? ["Avaa", "Peruuta"] : ["Open", "Cancel"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return;
    this.allowOnce.add(url);
    await view.webContents.loadURL(url);
  }

  private view(chain: Chain) {
    const existing = this.views.get(chain);
    if (existing) return existing;
    const partition = this.development()
      ? `persist:development-${chain}`
      : `persist:${chain}`;
    const storeSession = session.fromPartition(partition);
    if (this.development())
      storeSession.webRequest.onBeforeRequest((details, callback) => {
        let host = "";
        try {
          host = new URL(details.url).hostname;
        } catch {}
        callback({
          cancel: host !== "127.0.0.1" && details.url !== "about:blank",
        });
      });
    const view = new WebContentsView({
      webPreferences: {
        session: storeSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    view.setBackgroundColor("#ffffff");
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      // Popups and payment redirects stay in this tab.
      void this.navigate(chain, view, url).catch(() => {});
      return { action: "deny" };
    });
    contents.on("will-navigate", (event) => {
      if (this.allowOnce.delete(event.url) || this.allowed(chain, event.url))
        return;
      event.preventDefault();
      void this.navigate(chain, view, event.url).catch(() => {});
    });
    contents.on("will-redirect", (event) => {
      if (this.allowed(chain, event.url)) return;
      event.preventDefault();
      void this.navigate(chain, view, event.url).catch(() => {});
    });
    this.views.set(chain, view);
    return view;
  }

  /** Shows a chain's tab in the given area of the window, loading its front page the first time. */
  async show(chain: Chain, bounds: Rectangle) {
    const view = this.view(chain);
    if (this.shown !== chain) {
      this.hide();
      this.window.contentView.addChildView(view);
      this.shown = chain;
    }
    view.setBounds(bounds);
    if (!view.webContents.getURL())
      await this.navigate(chain, view, await this.url(chain, "home"));
  }

  hide() {
    if (this.shown) {
      const view = this.views.get(this.shown);
      if (view) this.window.contentView.removeChildView(view);
    }
    this.shown = null;
  }

  async url(chain: Chain, page: StorePage) {
    return `${await this.origin(chain)}${PATHS[chain][page]}`;
  }

  /** Loads a page in the chain's tab; the renderer shows the tab. */
  async open(chain: Chain, page: StorePage) {
    const view = this.view(chain);
    const url =
      this.development() && page === "login"
        ? `${await this.origin(chain)}/kirjaudu`
        : await this.url(chain, page);
    await this.navigate(chain, view, url);
  }

  /** The fixture account is read through the same partition that the sign-in page uses. */
  async fixtureAccount(chain: Chain): Promise<boolean> {
    if (!this.development()) throw new Error("developmentRequired");
    this.view(chain);
    const response = await session
      .fromPartition(`persist:development-${chain}`)
      .fetch(`${await this.origin(chain)}/session`);
    if (!response.ok) throw new Error("storeUnavailable");
    const account = await response.json();
    return account.accountId === `fixture:${chain}`;
  }

  /**
   * Opens one S-kaupat shopping list in the tab and scrolls the site's own "Lisää kaikki
   * ostoskoriin" button into view. The button is never pressed: it ends in choosing a pickup time.
   */
  async openList(chain: Chain, listId: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(listId)) throw new Error("hostRefused");
    const view = this.view(chain);
    await this.navigate(
      chain,
      view,
      `${await this.origin(chain)}/ostoslistat/${listId}`,
    );
    // The page draws its list after loading, so look for the button for a few seconds.
    await view.webContents
      .executeJavaScript(SCROLL_TO_ADD_ALL, true)
      .catch(() => false);
  }

  async action(chain: Chain, action: "back" | "reload" | "browser") {
    const view = this.views.get(chain);
    if (!view) return;
    const contents = view.webContents;
    if (action === "back" && contents.navigationHistory.canGoBack())
      contents.navigationHistory.goBack();
    if (action === "reload") contents.reload();
    if (action === "browser" && !this.development()) {
      const url = contents.getURL();
      if (this.allowed(chain, url)) await shell.openExternal(url);
    }
  }

  /**
   * Runs a script in a hidden page of the chain's site, in the same session as its tab, so
   * Korikone's own calls carry the sign-in the shopper made there. Live mode only.
   */
  async evaluate(chain: Chain, script: string): Promise<unknown> {
    if (this.development()) throw new Error("developmentRequired");
    const contents = await this.background(chain);
    return contents.executeJavaScript(script, true);
  }

  /** The hidden page of a chain's site, loaded on first use. It shares the tab's session and storage. */
  private async background(chain: Chain) {
    if (this.development()) throw new Error("developmentRequired");
    const home = `${SITES[chain].origin}${BACKGROUND_PATH[chain]}`;
    let view = this.backgrounds.get(chain);
    if (!view) {
      view = new WebContentsView({
        webPreferences: {
          session: session.fromPartition(`persist:${chain}`),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      this.backgrounds.set(chain, view);
    }
    const contents = view.webContents;
    if (
      new URL(contents.getURL() || "about:blank").origin !== SITES[chain].origin
    )
      await contents.loadURL(home);
    return contents;
  }

  /** Reloads the hidden page and waits for it, so the site's own start-up code runs again (it renews its login). */
  async reloadBackground(chain: Chain) {
    const contents = await this.background(chain);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        contents.removeListener("did-stop-loading", done);
        resolve();
      };
      const timer = setTimeout(done, 15_000);
      contents.once("did-stop-loading", done);
      contents.reload();
    });
  }

  /** Shows a page of the chain's own site in its tab; anything else is refused. */
  async openUrl(chain: Chain, url: string) {
    if (
      !this.allowed(chain, url) ||
      !within(new URL(url).hostname, SITES[chain].domains)
    )
      throw new Error("hostRefused");
    await this.navigate(chain, this.view(chain), url);
  }

  /** Signs the chain out of this session: its storage and cookies go, and open pages start over. */
  async forget(chain: Chain) {
    const storeSession = session.fromPartition(
      this.development() ? `persist:development-${chain}` : `persist:${chain}`,
    );
    await storeSession.clearStorageData();
    await storeSession.clearCache();
    const view = this.views.get(chain);
    if (view) await view.webContents.loadURL(await this.url(chain, "home"));
    this.backgrounds.get(chain)?.webContents.close();
    this.backgrounds.delete(chain);
  }

  reset() {
    this.hide();
    for (const view of this.views.values()) view.webContents.close();
    this.views.clear();
    for (const view of this.backgrounds.values()) view.webContents.close();
    this.backgrounds.clear();
  }

  close() {
    this.reset();
    this.server?.close();
  }

  async flush() {
    await Promise.all(
      [...this.views.keys()].map((chain) =>
        session
          .fromPartition(
            this.development()
              ? `persist:development-${chain}`
              : `persist:${chain}`,
          )
          .cookies.flushStore(),
      ),
    );
  }
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="fi"><head><meta charset="utf-8"><title>${title}</title></head><body><nav><a href="./">Etusivu</a> · <a href="kirjaudu">Kirjaudu</a> · <a href="tuote">Tuote</a> · <a href="ostoskori">Ostoskori</a> · <a href="ostoslistat">Ostoslistat</a> · <a href="ikkuna" target="_blank">Avaa ikkuna</a></nav><h1>${title}</h1>${body}</body></html>`;

/** The development fixture site: a stand-in for both chains, served on 127.0.0.1 only. */
export function fixtureSite(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const [, chain, ...rest] = url.pathname.split("/");
    const path = rest.join("/");
    const name =
      chain === "s-kaupat"
        ? "S-kaupat (fixture)"
        : chain === "k-ruoka"
          ? "K-Ruoka (fixture)"
          : "";
    const signedIn = /(^|;\s*)fixture-login=1/.test(
      request.headers.cookie ?? "",
    );
    if (name && path === "session") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({ accountId: signedIn ? `fixture:${chain}` : null }),
        );
      return;
    }
    const pages: Record<string, () => string> = {
      "": () =>
        page(
          name,
          `<p>${signedIn ? "Kirjautunut" : "Ei kirjautunut"}</p>${signedIn ? '<form method="post" action="vanhenna"><button>Vanhennna kirjautuminen</button></form>' : ""}`,
        ),
      kirjaudu: () =>
        page(
          `${name}: Kirjaudu`,
          `<form method="post" action="kirjaudu"><button>Kirjaudu sisään</button></form><form method="post" action="hylkaa"><button>Hylkää kirjautuminen</button></form>`,
        ),
      hylkaa: () => page(`${name}: Hylätty`, "<p>Kirjautuminen hylättiin</p>"),
      vanhenna: () =>
        page(`${name}: Vanhentunut`, "<p>Kirjautuminen vanhentui</p>"),
      tuote: () => page(`${name}: Tuote`, "<p>Jauheliha 400 g · 4,99 €</p>"),
      ostoskori: () => page(`${name}: Ostoskori`, "<p>Ostoskori</p>"),
      "kauppa/ostoskori": () => page(`${name}: Ostoskori`, "<p>Ostoskori</p>"),
      ostoslistat: () =>
        page(`${name}: Ostoslistat`, "<ul><li>Korikone</li></ul>"),
      ikkuna: () => page(`${name}: Ikkuna`, "<p>Ponnahdusikkuna</p>"),
      "ostoslistat/lista-1": () =>
        page(
          `${name}: Lista`,
          `<div style="height:3000px">Pitkä lista</div><button data-test-id="addAllToCart">Lisää kaikki ostoskoriin 3,00 €</button>`,
        ),
    };
    if (!name || !(path in pages)) {
      response.writeHead(404, { "content-type": "text/plain" }).end();
      return;
    }
    if (
      request.method === "POST" &&
      ["kirjaudu", "hylkaa", "vanhenna"].includes(path)
    ) {
      response
        .writeHead(303, {
          location: `/${chain}/${path === "kirjaudu" ? "" : path}`,
          "set-cookie": `fixture-login=${path === "kirjaudu" ? "1" : ""}; Path=/${chain}/; HttpOnly; SameSite=Lax; Max-Age=${path === "kirjaudu" ? "31536000" : "0"}`,
        })
        .end();
      return;
    }
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(pages[path]().replace("<head>", `<head><base href="/${chain}/">`));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve({
        server,
        origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      }),
    );
  });
}

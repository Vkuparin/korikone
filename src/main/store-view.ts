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
    domains: ["s-kaupat.fi", "s-ryhma.fi"],
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
const REAL_HOSTS = ["s-kaupat.fi", "s-ryhma.fi", "k-ruoka.fi", "kesko.fi"];
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
      await view.webContents.loadURL(url).catch(() => {});
      return;
    }
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
    await view.webContents.loadURL(url).catch(() => {});
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
        callback({ cancel: within(host, REAL_HOSTS) });
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
      void this.navigate(chain, view, url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event) => {
      if (this.allowOnce.delete(event.url) || this.allowed(chain, event.url))
        return;
      event.preventDefault();
      void this.navigate(chain, view, event.url);
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
    await this.navigate(chain, view, await this.url(chain, page));
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

  /** Development mode switched: the tabs belong to the other set of sessions now. */
  /**
   * Runs a script in a hidden page of the chain's site, in the same session as its tab, so
   * Korikone's own calls carry the sign-in the shopper made there. Live mode only.
   */
  async evaluate(chain: Chain, script: string): Promise<unknown> {
    if (this.development()) throw new Error("developmentRequired");
    const home = `${SITES[chain].origin}/kauppa`;
    this.backgrounds.get(chain) ??
      this.backgrounds.set(
        chain,
        new WebContentsView({
          webPreferences: {
            session: session.fromPartition(`persist:${chain}`),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        }),
      );
    const contents = this.backgrounds.get(chain)!.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    if (
      new URL(contents.getURL() || "about:blank").origin !== SITES[chain].origin
    )
      await contents.loadURL(home);
    return contents.executeJavaScript(script, true);
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
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="fi"><head><meta charset="utf-8"><title>${title}</title></head><body><nav><a href="./">Etusivu</a> · <a href="kirjaudu">Kirjaudu</a> · <a href="tuote">Tuote</a> · <a href="ostoskori">Ostoskori</a> · <a href="ostoslistat">Ostoslistat</a> · <a href="ikkuna" target="_blank">Avaa ikkuna</a></nav><h1>${title}</h1>${body}</body></html>`;

/** The development fixture site: a stand-in for both chains, served on 127.0.0.1 only. */
export function fixtureSite(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const [, chain, path = ""] = url.pathname.split("/");
    const name =
      chain === "s-kaupat"
        ? "S-kaupat (fixture)"
        : chain === "k-ruoka"
          ? "K-Ruoka (fixture)"
          : "";
    const signedIn = /(^|;\s*)fixture-login=1/.test(
      request.headers.cookie ?? "",
    );
    const pages: Record<string, () => string> = {
      "": () =>
        page(name, `<p>${signedIn ? "Kirjautunut" : "Ei kirjautunut"}</p>`),
      kirjaudu: () =>
        page(
          `${name}: Kirjaudu`,
          `<form method="post" action="kirjaudu"><button>Kirjaudu sisään</button></form>`,
        ),
      tuote: () => page(`${name}: Tuote`, "<p>Jauheliha 400 g · 4,99 €</p>"),
      ostoskori: () => page(`${name}: Ostoskori`, "<p>Ostoskori</p>"),
      ostoslistat: () =>
        page(`${name}: Ostoslistat`, "<ul><li>Korikone</li></ul>"),
      ikkuna: () => page(`${name}: Ikkuna`, "<p>Ponnahdusikkuna</p>"),
    };
    if (!name || !(path in pages)) {
      response.writeHead(404, { "content-type": "text/plain" }).end();
      return;
    }
    if (request.method === "POST" && path === "kirjaudu") {
      response
        .writeHead(303, {
          location: `/${chain}/`,
          "set-cookie": "fixture-login=1; Path=/; HttpOnly",
        })
        .end();
      return;
    }
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(pages[path]());
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

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { browserArgs, browserCandidates, browserMcpConfig, findBrowser } from "../src/browser/launch.js";
import { ClaudeBrowser, type BrowserFrame } from "../src/browser/session.js";
import { parseClientMessage } from "../src/protocol.js";

describe("lancement du navigateur", () => {
  it("cherche Chrome puis Edge dans les dossiers de programmes", () => {
    const found = browserCandidates({ PROGRAMFILES: "C:\PF", LOCALAPPDATA: "C:\L" });
    expect(found).toEqual([
      join("C:\PF", "Google", "Chrome", "Application", "chrome.exe"),
      join("C:\L", "Google", "Chrome", "Application", "chrome.exe"),
      join("C:\PF", "Microsoft", "Edge", "Application", "msedge.exe"),
      join("C:\L", "Microsoft", "Edge", "Application", "msedge.exe"),
    ]);
  });

  it("lance sans fenêtre, sur la boucle locale, avec son propre profil", () => {
    const args = browserArgs(9333, "C:\data\browser\profile");
    expect(args).toContain("--headless=new");
    expect(args).toContain("--remote-debugging-address=127.0.0.1");
    expect(args).toContain("--user-data-dir=C:\data\browser\profile");
  });

  it("branche le MCP choisi sur le port du navigateur, par cmd /c npx", () => {
    expect(browserMcpConfig("chrome-devtools", 9333)).toEqual({
      type: "stdio",
      command: "cmd",
      args: ["/c", "npx", "-y", "chrome-devtools-mcp@latest", "--browserUrl", "http://127.0.0.1:9333"],
    });
    expect(browserMcpConfig("playwright", 9333).args).toEqual(["/c", "npx", "-y", "@playwright/mcp@latest", "--cdp-endpoint", "http://127.0.0.1:9333"]);
  });

  it("accepte l'abonnement au flux du navigateur, et rien d'autre", () => {
    expect(parseClientMessage(JSON.stringify({ t: "watch", topic: "browser", on: true }))).toEqual({ t: "watch", topic: "browser", on: true });
    expect(parseClientMessage(JSON.stringify({ t: "watch", topic: "écran", on: true }))).toBeUndefined();
  });
});

// Un vrai navigateur sans fenêtre, sur un port à part et un profil jetable : sauté sans Chrome ni Edge.
const executable = await findBrowser();

describe.skipIf(!executable)("navigateur de Claude, en vrai", () => {
  let dataDir: string;
  let browser: ClaudeBrowser;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "clide-browser-"));
    browser = new ClaudeBrowser(dataDir, 9391);
  });

  afterAll(async () => {
    await browser.stop();
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("suit la page ouverte, diffuse son image regardée, et relaie la frappe", async () => {
    await browser.start();
    expect(browser.state.status).toBe("running");
    const frames: BrowserFrame[] = [];
    browser.onFrame((frame) => frames.push(frame));
    browser.watch(true);
    const page = "data:text/html,<input id=f autofocus><p id=o></p><script>f.oninput=()=>document.title=f.value</script>";
    await browser.navigate(page);
    const until = async (check: () => boolean) => {
      for (let tries = 0; tries < 60 && !check(); tries++) await new Promise((done) => setTimeout(done, 100));
      return check();
    };
    expect(await until(() => frames.length > 0)).toBe(true);
    expect(frames[0]?.width).toBeGreaterThan(0);
    await browser.input({ kind: "click", x: 20, y: 15 });
    await browser.input({ kind: "text", text: "salut" });
    // Le titre changé par la page ne s'annonce pas : on le lit à la source.
    const titles = async () => ((await (await fetch("http://127.0.0.1:9391/json/list")).json()) as { title: string }[]).map((item) => item.title);
    let typed = false;
    for (let tries = 0; tries < 30 && !typed; tries++) {
      typed = (await titles()).includes("salut");
      if (!typed) await new Promise((done) => setTimeout(done, 100));
    }
    expect(typed).toBe(true);
  }, 30_000);
});

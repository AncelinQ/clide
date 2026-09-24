import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { framableFrom, probeFrame } from "../src/platform/frame-probe.js";

describe("framableFrom", () => {
  it("accepte une page sans restriction", () => {
    expect(framableFrom(new Headers({ "content-type": "text/html" }))).toBe(true);
  });

  it("refuse X-Frame-Options, même SAMEORIGIN : l'aperçu est une autre origine", () => {
    expect(framableFrom(new Headers({ "x-frame-options": "SAMEORIGIN" }))).toBe(false);
  });

  it("lit frame-ancestors dans la politique de sécurité", () => {
    expect(framableFrom(new Headers({ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" }))).toBe(false);
    expect(framableFrom(new Headers({ "content-security-policy": "frame-ancestors *" }))).toBe(true);
    expect(framableFrom(new Headers({ "content-security-policy": "default-src 'self'" }))).toBe(true);
  });
});

describe("probeFrame", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === "/refuse") response.setHeader("X-Frame-Options", "DENY");
      response.end("ok");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it("dit si un serveur local accepte le cadre", async () => {
    expect(await probeFrame(`${base}/`)).toEqual({ reachable: true, framable: true });
    expect(await probeFrame(`${base}/refuse`)).toEqual({ reachable: true, framable: false });
  });

  it("signale un serveur qui ne répond pas", async () => {
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((done) => closed.close(() => done()));
    expect(await probeFrame(`http://127.0.0.1:${port}/`)).toEqual({ reachable: false, framable: true });
  });

  it("ne sonde rien hors de la machine", async () => {
    await expect(probeFrame("http://192.168.1.10:5173/")).rejects.toThrow("cette machine");
    await expect(probeFrame("file:///C:/Windows/win.ini")).rejects.toThrow("cette machine");
  });
});

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { servesHtml } from "../src/platform/html-probe.js";

describe("servesHtml", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === "/json") {
        response.setHeader("Content-Type", "application/json");
        response.end("{}");
        return;
      }
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end("<p>ok</p>");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it("distingue une page d'une API", async () => {
    expect(await servesHtml(`${base}/`)).toBe(true);
    expect(await servesHtml(`${base}/json`)).toBe(false);
  });

  it("écarte un serveur qui ne répond pas", async () => {
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((done) => closed.close(() => done()));
    expect(await servesHtml(`http://127.0.0.1:${port}/`)).toBe(false);
  });

  it("ne sonde rien hors de la machine", async () => {
    await expect(servesHtml("http://192.168.1.10:5173/")).rejects.toThrow("cette machine");
    await expect(servesHtml("file:///C:/Windows/win.ini")).rejects.toThrow("cette machine");
  });
});

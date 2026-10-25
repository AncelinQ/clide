import { createServer, type Server } from "node:http";
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pageServers, servesHtml } from "../src/platform/html-probe.js";

function listen(server: TcpServer, port = 0): Promise<number> {
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done((server.address() as AddressInfo).port)));
}

function close(server: TcpServer): Promise<void> {
  return new Promise((done) => server.close(() => done()));
}

/** Un port libre à l'instant : ouvert puis refermé. */
async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await close(probe);
  return port;
}

const at = (pid: number, port: number) => ({ pid, port, url: `http://127.0.0.1:${port}/` });
const socket = (pid: number, port: number) => ({ address: "127.0.0.1", pid, port });

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
    base = `http://127.0.0.1:${await listen(server)}`;
  });

  afterAll(() => close(server));

  it("distingue une page d'une API", async () => {
    expect(await servesHtml(`${base}/`)).toBe(true);
    expect(await servesHtml(`${base}/json`)).toBe(false);
  });

  it("ne tranche pas pour un port où rien ne répond", async () => {
    expect(await servesHtml(`http://127.0.0.1:${await freePort()}/`)).toBeUndefined();
  });

  it("ne sonde rien hors de la machine", async () => {
    await expect(servesHtml("http://192.168.1.10:5173/")).rejects.toThrow("cette machine");
    await expect(servesHtml("file:///C:/Windows/win.ini")).rejects.toThrow("cette machine");
  });
});

describe("pageServers", () => {
  it("ne sonde un serveur qu'une fois tant qu'il écoute, de nouveau une fois arrêté", async () => {
    let requests = 0;
    const page = createServer((_request, response) => {
      requests += 1;
      response.setHeader("Content-Type", "text/html");
      response.end("<p>ok</p>");
    });
    const port = await listen(page);
    try {
      const server = at(101, port);
      expect(await pageServers([server], [socket(101, port)])).toEqual([server]);
      expect(await pageServers([server], [socket(101, port)])).toEqual([server]);
      expect(requests).toBe(1);

      await pageServers([], []);
      expect(await pageServers([server], [socket(101, port)])).toEqual([server]);
      expect(requests).toBe(2);
    } finally {
      await close(page);
    }
  });

  it("sonde de nouveau un serveur qui n'avait pas encore répondu", async () => {
    const port = await freePort();
    const server = at(102, port);
    expect(await pageServers([server], [socket(102, port)])).toEqual([]);

    const page = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end("<p>ok</p>");
    });
    await listen(page, port);
    try {
      expect(await pageServers([server], [socket(102, port)])).toEqual([server]);
    } finally {
      await close(page);
    }
  });

  it("ne sonde plus un serveur qui a répondu autre chose que HTTP", async () => {
    const connections: Socket[] = [];
    const raw = createTcpServer((connection) => {
      connections.push(connection);
      connection.end("-ERR pas du HTTP\r\n");
    });
    const port = await listen(raw);
    try {
      const server = at(103, port);
      expect(await pageServers([server], [socket(103, port)])).toEqual([]);
      expect(await pageServers([server], [socket(103, port)])).toEqual([]);
      expect(connections).toHaveLength(1);
    } finally {
      // fetch laisse la connexion à demi ouverte après une réponse illisible.
      for (const connection of connections) connection.destroy();
      await close(raw);
    }
  });
});

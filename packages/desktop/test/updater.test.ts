import type { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: true, getVersion: () => "0.1.20" } }));
vi.mock("electron-updater", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return { autoUpdater: Object.assign(new Emitter(), { checkForUpdates: vi.fn(() => Promise.resolve()) }) };
});

const autoUpdater = (await import("electron-updater")).autoUpdater as unknown as EventEmitter & { checkForUpdates: Mock };
const { Updater } = await import("../src/updater");

describe("Updater", () => {
  let updater: InstanceType<typeof Updater>;

  beforeEach(() => {
    vi.useFakeTimers();
    autoUpdater.removeAllListeners();
    autoUpdater.checkForUpdates.mockClear();
    updater = new Updater(() => undefined);
    updater.start();
  });

  afterEach(() => {
    updater.stop();
    vi.useRealTimers();
  });

  /** Une version téléchargée jusqu'au bout, comme electron-updater l'annonce. */
  const downloaded = (version: string) => {
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-available", { version });
    autoUpdater.emit("update-downloaded", { version });
  };

  it("cherche encore quand une version est prête", () => {
    downloaded("0.1.21");
    updater.check();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it("ne cherche pas pendant un téléchargement", () => {
    autoUpdater.emit("update-available", { version: "0.1.21" });
    updater.check();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("passe à la version plus récente parue depuis", () => {
    downloaded("0.1.21");
    downloaded("0.1.22");
    expect(updater.get()).toMatchObject({ status: "ready", version: "0.1.22" });
  });

  it("garde la version prête quand rien de plus récent n'a paru", () => {
    downloaded("0.1.21");
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-not-available", {});
    expect(updater.get()).toMatchObject({ status: "ready", version: "0.1.21" });
  });

  it("garde la version prête quand la nouvelle recherche échoue, et dit l'échec", () => {
    downloaded("0.1.21");
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("error", new Error("hors ligne"));
    expect(updater.get()).toMatchObject({ status: "ready", version: "0.1.21", error: "hors ligne" });
  });

  it("ne promet plus rien quand le téléchargement d'une version plus récente échoue", () => {
    downloaded("0.1.21");
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-available", { version: "0.1.22" });
    autoUpdater.emit("error", new Error("coupé"));
    expect(updater.get()).toMatchObject({ status: "error", error: "coupé" });
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-not-available", {});
    expect(updater.get().status).toBe("none");
  });
});

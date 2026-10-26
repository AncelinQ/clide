import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

import { defaultLinkName, normalizeUrl, noteFileName, noteName } from "./links.js";

/** Un lien du mémo : un nom, et une adresse http, https ou mailto. */
export interface MemoLink {
  name: string;
  url: string;
}

/** Une note personnelle : un fichier Markdown du dossier de données. */
export interface MemoNote {
  name: string;
  path: string;
}

/** Un fichier épinglé ; `exists` faux une fois déplacé ou supprimé. */
export interface MemoPin {
  path: string;
  exists: boolean;
}

export interface ProjectMemo {
  root: string;
  links: MemoLink[];
  notes: MemoNote[];
  pins: MemoPin[];
}

interface Entry {
  links: MemoLink[];
  pins: string[];
}

interface MemoFile {
  version: 1;
  projects: Record<string, Entry>;
}

/** Dossier des notes de tous les projets, dans le dossier de données : l'éditeur doit pouvoir y lire et écrire. */
export function memoNotesRoot(dataDir: string): string {
  return join(dataDir, "memo");
}

function validLink(value: unknown): value is MemoLink {
  if (typeof value !== "object" || value === null) return false;
  const link = value as Record<string, unknown>;
  return typeof link["name"] === "string" && typeof link["url"] === "string" && normalizeUrl(link["url"]) === link["url"];
}

function entryOf(value: unknown): Entry {
  const entry = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    links: Array.isArray(entry["links"]) ? entry["links"].filter(validLink) : [],
    pins: Array.isArray(entry["pins"]) ? entry["pins"].filter((pin): pin is string => typeof pin === "string" && isAbsolute(pin)) : [],
  };
}

/** Range `items` dans l'ordre des clés données ; ce que l'ordre ne nomme pas garde sa place relative, à la fin. */
function ordered<T>(items: readonly T[], keys: readonly string[], key: (item: T) => string): T[] {
  const rank = new Map(keys.map((value, index) => [value, index]));
  const placed = items.filter((item) => rank.has(key(item))).sort((a, b) => (rank.get(key(a)) ?? 0) - (rank.get(key(b)) ?? 0));
  return [...placed, ...items.filter((item) => !rank.has(key(item)))];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Le Mémo de chaque projet, gardé dans le dossier de données de l'application et
 * jamais dans le projet : il est propre à la machine.
 *
 * `memo.json` tient les liens et les fichiers épinglés par dossier de projet ;
 * `memo/<clé>/` les notes du projet, en fichiers Markdown que l'éditeur ouvre.
 * Les écritures sont mises bout à bout : deux gestes rapprochés ne se perdent pas
 * l'un l'autre.
 */
export class MemoStore {
  readonly #file: string;
  #writing: Promise<unknown> = Promise.resolve();

  /** `trash` : met des fichiers à la corbeille, celle du système. */
  constructor(
    private readonly dataDir: string,
    private readonly trash: (paths: string[]) => Promise<void>,
  ) {
    this.#file = join(dataDir, "memo.json");
  }

  /** Dossier des notes d'un projet : une clé tirée de son dossier, sans égard à la casse. */
  notesDir(root: string): string {
    const key = createHash("sha1").update(root.toLowerCase()).digest("hex").slice(0, 16);
    return join(memoNotesRoot(this.dataDir), key);
  }

  /**
   * Lit le fichier. Absent, il est vide ; une entrée illisible est écartée. Un
   * fichier qui n'est pas du JSON refuse la lecture : l'écrire ensuite effacerait
   * ce qu'on y a mis à la main.
   */
  async #read(): Promise<Record<string, Entry>> {
    let raw: string;
    try {
      raw = await readFile(this.#file, "utf8");
    } catch {
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<MemoFile>;
    const projects = typeof parsed.projects === "object" && parsed.projects !== null ? parsed.projects : {};
    return Object.fromEntries(Object.entries(projects).map(([root, entry]) => [root, entryOf(entry)]));
  }

  async #write(projects: Record<string, Entry>): Promise<void> {
    await mkdir(dirname(this.#file), { recursive: true });
    const body: MemoFile = { version: 1, projects };
    const temporary = `${this.#file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    await rename(temporary, this.#file);
  }

  /** Change l'entrée d'un projet, à la suite des écritures en cours. */
  #update<T>(root: string, change: (entry: Entry) => T): Promise<T> {
    const run = this.#writing.then(async () => {
      const projects = await this.#read();
      const entry = projects[root] ?? { links: [], pins: [] };
      const result = change(entry);
      projects[root] = entry;
      await this.#write(projects);
      return result;
    });
    this.#writing = run.catch(() => undefined);
    return run;
  }

  async load(root: string): Promise<ProjectMemo> {
    const entry = (await this.#read())[root] ?? { links: [], pins: [] };
    const dir = this.notesDir(root);
    let files: string[] = [];
    try {
      files = (await readdir(dir))
        .filter((file) => file.toLowerCase().endsWith(".md"))
        .sort((a, b) => noteName(a).localeCompare(noteName(b), undefined, { numeric: true }));
    } catch {
      // Pas encore de note.
    }
    return {
      root,
      links: entry.links,
      notes: files.map((file) => ({ name: noteName(file), path: join(dir, file) })),
      pins: await Promise.all(entry.pins.map(async (path) => ({ path, exists: await exists(path) }))),
    };
  }

  /** Les projets dont le mémo n'est pas vide, par nom de dossier. */
  async list(): Promise<ProjectMemo[]> {
    const memos = await Promise.all(Object.keys(await this.#read()).map((root) => this.load(root)));
    return memos
      .filter((memo) => memo.links.length + memo.notes.length + memo.pins.length > 0)
      .sort((a, b) => basename(a.root).localeCompare(basename(b.root)));
  }

  /**
   * Ajoute un lien, ou remplace celui dont l'adresse est `replacing`. L'adresse est
   * normalisée ; sans nom, le lien prend celui de son hôte.
   */
  putLink(root: string, link: { name: string; url: string }, replacing?: string): Promise<MemoLink> {
    const url = normalizeUrl(link.url);
    if (!url) return Promise.reject(new Error("Adresse invalide : un lien web (http, https) ou une adresse mail"));
    const saved = { name: link.name.trim().slice(0, 200) || defaultLinkName(url), url };
    return this.#update(root, (entry) => {
      if (entry.links.some((item) => item.url === url && item.url !== replacing)) throw new Error("Ce lien est déjà dans le mémo");
      const index = replacing === undefined ? -1 : entry.links.findIndex((item) => item.url === replacing);
      if (replacing !== undefined && index === -1) throw new Error("Ce lien n'est plus dans le mémo");
      if (index === -1) entry.links.push(saved);
      else entry.links[index] = saved;
      return saved;
    });
  }

  removeLink(root: string, url: string): Promise<void> {
    return this.#update(root, (entry) => {
      entry.links = entry.links.filter((item) => item.url !== url);
    });
  }

  orderLinks(root: string, urls: readonly string[]): Promise<void> {
    return this.#update(root, (entry) => {
      entry.links = ordered(entry.links, urls, (item) => item.url);
    });
  }

  /** Épingle des fichiers par leur chemin absolu ; rend le nombre de ceux qui ne l'étaient pas déjà. */
  addPins(root: string, paths: readonly string[]): Promise<number> {
    return this.#update(root, (entry) => {
      const added = [...new Set(paths.filter((path) => isAbsolute(path) && !entry.pins.includes(path)))];
      entry.pins.push(...added);
      return added.length;
    });
  }

  removePin(root: string, path: string): Promise<void> {
    return this.#update(root, (entry) => {
      entry.pins = entry.pins.filter((item) => item !== path);
    });
  }

  orderPins(root: string, paths: readonly string[]): Promise<void> {
    return this.#update(root, (entry) => {
      entry.pins = ordered(entry.pins, paths, (item) => item);
    });
  }

  /**
   * Une nouvelle note `<nom>.md`, sous un nom libre quand celui-ci est pris
   * (« nom 2 »). Rend son chemin, pour l'ouvrir dans l'éditeur.
   */
  async newNote(root: string, name: string): Promise<string> {
    const file = noteFileName(name);
    if (!file) throw new Error("Nom de note invalide");
    const dir = this.notesDir(root);
    await mkdir(dir, { recursive: true });
    for (let index = 1; ; index++) {
      const path = join(dir, index === 1 ? file : file.replace(/\.md$/, ` ${index}.md`));
      try {
        // `wx` : ne jamais écraser une note qu'on vient de créer à côté.
        await writeFile(path, `# ${noteName(path)}\n\n`, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
      // Le projet entre dans le mémo même sans lien : la vue de tous les projets le trouve.
      await this.#update(root, () => undefined);
      return path;
    }
  }

  async renameNote(root: string, path: string, name: string): Promise<string> {
    await this.#own(root, path);
    const file = noteFileName(name);
    if (!file) throw new Error("Nom de note invalide");
    const to = join(this.notesDir(root), file);
    if (to === path) return path;
    // Changer la casse seule reste permis : sous Windows, c'est le même fichier.
    if ((await exists(to)) && to.toLowerCase() !== path.toLowerCase()) throw new Error("Une note porte déjà ce nom");
    await rename(path, to);
    return to;
  }

  async trashNote(root: string, path: string): Promise<void> {
    await this.#own(root, path);
    await this.trash([path]);
  }

  /** Un chemin de note venu du client doit être une note de ce projet : un fichier `.md` de son dossier, qui existe. */
  async #own(root: string, path: string): Promise<void> {
    const rel = relative(this.notesDir(root), path);
    if (!rel || rel.startsWith("..") || isAbsolute(rel) || /[\\/]/.test(rel) || !rel.toLowerCase().endsWith(".md") || !(await exists(path))) {
      throw new Error("Note introuvable");
    }
  }
}

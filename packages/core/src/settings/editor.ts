import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser";

import { settingsFile } from "../paths.js";

export interface SettingsDocument {
  path: string;
  /** Texte exact du fichier, seule source pour une réécriture. */
  raw: string;
  value: Record<string, unknown>;
}

export interface SettingsEdit {
  path: (string | number)[];
  /** `undefined` supprime la clé. */
  value: unknown;
}

/** Levée quand le fichier n'est pas du JSON exploitable. Aucune écriture ne doit suivre. */
export class SettingsParseError extends Error {
  constructor(
    readonly file: string,
    readonly details: string[],
  ) {
    super(`${file} : JSON illisible (${details.join(", ")})`);
    this.name = "SettingsParseError";
  }
}

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

function describe(errors: ParseError[], raw: string): string[] {
  return errors.map((error) => {
    const line = raw.slice(0, error.offset).split("\n").length;
    return `${printParseErrorCode(error.error)} ligne ${line}`;
  });
}

/**
 * Lecture et modification de `settings.json` sans réécrire ce qu'on n'a pas touché.
 *
 * Le fichier contient des réglages posés à la main — hooks, variables
 * d'environnement, permissions — dont une partie n'a aucune représentation dans
 * l'interface. Un aller-retour `JSON.parse` / `JSON.stringify` les conserverait
 * sémantiquement mais réécrirait tout : ordre des clés, indentation, regroupements.
 * Les éditions passent donc par l'arbre `jsonc`, qui ne remplace que l'étendue
 * de texte concernée.
 *
 * Trois garde-fous, dans cet ordre : pas d'écriture si la lecture a échoué,
 * sauvegarde avant la première modification, écriture atomique.
 */
export class SettingsEditor {
  /** Applique une édition à du texte JSON. Fonction pure, testable sans disque. */
  static apply(raw: string, edit: SettingsEdit): string {
    const edits = modify(raw, edit.path, edit.value, { formattingOptions: FORMATTING });
    return applyEdits(raw, edits);
  }

  static applyAll(raw: string, edits: readonly SettingsEdit[]): string {
    // Chaque édition est appliquée sur le texte issu de la précédente : les
    // décalages calculés par `modify` ne valent que pour le texte qu'il a reçu.
    return edits.reduce((text, edit) => SettingsEditor.apply(text, edit), raw);
  }

  static parse(raw: string, file = "<mémoire>"): Record<string, unknown> {
    const errors: ParseError[] = [];
    const value: unknown = parse(raw, errors, { allowTrailingComma: true });
    if (errors.length > 0) throw new SettingsParseError(file, describe(errors, raw));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  async read(file: string = settingsFile()): Promise<SettingsDocument> {
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      // Un fichier absent est un document vide, pas une erreur : la première
      // écriture le créera.
      return { path: file, raw: "{}\n", value: {} };
    }
    return { path: file, raw, value: SettingsEditor.parse(raw, file) };
  }

  /** Chemin de la sauvegarde posée avant la première modification d'un fichier. */
  static backupPath(file: string): string {
    return join(dirname(file), `${file.split(/[\\/]/).pop() ?? "settings.json"}.claude-ide.bak`);
  }

  /**
   * Applique des éditions et réécrit le fichier.
   *
   * Relit le fichier juste avant d'écrire : une modification faite ailleurs
   * entre-temps ne doit pas être écrasée par un texte devenu périmé.
   */
  async update(file: string, edits: readonly SettingsEdit[]): Promise<SettingsDocument> {
    const current = await this.read(file);
    const next = SettingsEditor.applyAll(current.raw, edits);

    // Relecture du résultat : une édition qui produirait du JSON invalide est
    // refusée avant d'atteindre le disque.
    const value = SettingsEditor.parse(next, file);

    await this.#backupOnce(file);
    await this.#writeAtomic(file, next);
    return { path: file, raw: next, value };
  }

  /**
   * Remplace le fichier entier.
   *
   * Réservé à une édition écrite par un humain : le texte est le sien, et le
   * préserver tel quel a plus de valeur qu'une mise en forme reconstruite. Le
   * contenu est validé avant d'atteindre le disque, et la sauvegarde d'origine
   * est posée comme pour une édition ciblée.
   */
  async replace(file: string, raw: string): Promise<SettingsDocument> {
    const value = SettingsEditor.parse(raw, file);
    await this.#backupOnce(file);
    await this.#writeAtomic(file, raw);
    return { path: file, raw, value };
  }

  async #backupOnce(file: string): Promise<void> {
    const backup = SettingsEditor.backupPath(file);
    try {
      await copyFile(file, backup, 1 /* COPYFILE_EXCL : ne remplace pas une sauvegarde existante */);
    } catch {
      // Fichier source absent, ou sauvegarde déjà en place : les deux sont normaux.
    }
  }

  async #writeAtomic(file: string, content: string): Promise<void> {
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, content, "utf8");
    await rename(temp, file);
  }
}

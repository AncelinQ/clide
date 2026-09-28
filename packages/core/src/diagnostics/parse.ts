import { isAbsolute, resolve } from "node:path";

export type Severity = "error" | "warning" | "info";

/** Une erreur, un avertissement ou un TODO, à une place d'un fichier. */
export interface Diagnostic {
  /** Chemin absolu du fichier. */
  path: string;
  /** Lignes et colonnes comptées à partir de 1. */
  line: number;
  column: number;
  severity: Severity;
  message: string;
  source: "tsc" | "eslint" | "todo";
  /** `TS2322`, `no-unused-vars`, `FIXME`. */
  code?: string;
}

export interface ToolReport {
  tool: Diagnostic["source"];
  ranAt: string;
  durationMs: number;
  diagnostics: Diagnostic[];
  /** L'outil n'a pas pu tourner (configuration invalide, binaire cassé) : rien n'est à tenir pour propre. */
  error?: string;
}

export interface DiagnosticsReport {
  root: string;
  tools: ToolReport[];
}

/**
 * Lit `tsc --noEmit --pretty false` : `chemin(ligne,colonne): error TS2322: message`,
 * le chemin relatif au dossier d'où `tsc` a tourné. Les lignes de suite d'un
 * message sur plusieurs lignes (indentées) rejoignent leur erreur.
 */
export function parseTsc(stdout: string, cwd: string): Diagnostic[] {
  const found: Diagnostic[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(.+?)\((\d+),(\d+)\): (error|warning|message) (TS\d+): (.*)$/.exec(line);
    if (match) {
      const [, file = "", row = "1", column = "1", level = "error", code, message = ""] = match;
      found.push({
        path: isAbsolute(file) ? file : resolve(cwd, file),
        line: Number(row),
        column: Number(column),
        severity: level === "warning" ? "warning" : level === "message" ? "info" : "error",
        message,
        source: "tsc",
        ...(code ? { code } : {}),
      });
    } else if (/^\s+\S/.test(line) && found.length > 0) {
      const last = found[found.length - 1] as Diagnostic;
      last.message = `${last.message}\n${line.trim()}`;
    }
  }
  return found;
}

/** Lit `eslint -f json` ; une sortie qui n'est pas du JSON est une erreur de l'outil, pas un projet propre. */
export function parseEslint(stdout: string): Diagnostic[] {
  const files = JSON.parse(stdout) as {
    filePath: string;
    messages: { line?: number; column?: number; severity: number; message: string; ruleId?: string | null }[];
  }[];
  return files.flatMap((file) =>
    file.messages.map((message) => ({
      path: file.filePath,
      line: message.line ?? 1,
      column: message.column ?? 1,
      severity: message.severity === 2 ? ("error" as const) : ("warning" as const),
      message: message.message,
      source: "eslint" as const,
      ...(message.ruleId ? { code: message.ruleId } : {}),
    })),
  );
}

const MARKERS = /\b(TODO|FIXME|HACK|XXX)\b[:\s]\s*(.*)$/;
/** Début d'un commentaire, pour les langages qu'on rencontre dans un projet web ou Python. */
const COMMENT = /(\/\/|\/\*|^\s*\*|#|<!--|--\s)/;

/**
 * Les `TODO`, `FIXME`, `HACK` et `XXX` d'un fichier. Dans du code, seulement dans un
 * commentaire : un `TODO` dans une chaîne n'en est pas un. Dans du Markdown,
 * partout.
 */
export function findTodos(path: string, text: string): Diagnostic[] {
  const markdown = /\.(md|mdx|markdown)$/i.test(path);
  const found: Diagnostic[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = MARKERS.exec(line);
    if (!match) return;
    if (!markdown) {
      const comment = COMMENT.exec(line);
      if (!comment || comment.index > match.index) return;
    }
    const message = (match[2] ?? "").replace(/\s*(\*\/|-->)\s*$/, "").trim();
    found.push({
      path,
      line: index + 1,
      column: match.index + 1,
      severity: match[1] === "FIXME" ? "warning" : "info",
      message: message || (match[1] as string),
      source: "todo",
      code: match[1] as string,
    });
  });
  return found;
}

/**
 * Adresses et noms du Mémo d'un projet : ce que l'utilisateur tape devient une
 * adresse qui s'ouvre sans surprise, et un nom de note devient un nom de fichier.
 */

/**
 * L'adresse tapée pour un lien : sans espaces autour, `https://` ajouté quand
 * elle n'a pas de schéma, une adresse mail en `mailto:`. Rien pour ce qui ne
 * s'ouvrirait pas dans le navigateur ou la messagerie : `file:`, `javascript:`,
 * un schéma inventé.
 */
export function normalizeUrl(input: string): string | undefined {
  const text = input.trim();
  if (!text || /\s/.test(text)) return undefined;
  if (/^[^@/:\s]+@[^@/:\s]+\.[^@/:\s]+$/.test(text)) return `mailto:${text}`;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1]?.toLowerCase();
  // `localhost:3000` se lit comme un schéma : seuls http, https et mailto en sont un ici.
  const url =
    scheme === "http" || scheme === "https" || scheme === "mailto"
      ? text
      : scheme && !/^\d/.test(text.slice(scheme.length + 1))
        ? undefined
        : `https://${text}`;
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "mailto:") return parsed.pathname ? url : undefined;
    return parsed.hostname ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Nom d'un lien qu'on n'a pas nommé : l'hôte sans `www.`, ou l'adresse mail. */
export function defaultLinkName(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "mailto:") return decodeURIComponent(parsed.pathname);
    return parsed.hostname.replace(/^www\./, "") + (parsed.port ? `:${parsed.port}` : "");
  } catch {
    return url;
  }
}

/** Noms que Windows réserve à des périphériques, quelle que soit leur extension. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * Le nom d'une note en nom de fichier : sans les caractères qu'un système de
 * fichiers refuse ni les points et espaces de bord, `.md` ajouté. Rien quand il
 * ne reste rien, ou un nom que Windows réserve.
 */
export function noteFileName(name: string): string | undefined {
  const base = name
    .trim()
    .replace(/\.md$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120)
    .trim();
  return base && !RESERVED.test(base) ? `${base}.md` : undefined;
}

/** Le nom affiché d'une note, d'après son fichier. */
export function noteName(file: string): string {
  return (file.split(/[\\/]/).pop() ?? file).replace(/\.md$/i, "");
}

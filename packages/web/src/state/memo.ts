import { useSyncExternalStore } from "react";

import { api, post } from "@/lib/api";
import type { MemoLink, ProjectMemo } from "@/lib/types";

/**
 * Le Mémo des projets côté client : ses lectures, ses écritures, et un compteur
 * que chaque écriture fait avancer. Le mode du projet et l'onglet global relisent
 * à chaque pas : une note créée ici apparaît là-bas, un fichier épinglé depuis
 * l'explorateur aussi.
 */
let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Le compteur des écritures : à mettre dans les dépendances d'une lecture. */
export function useMemoVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** Écrit, puis prévient les lecteurs ; un refus du serveur remonte tel quel, avec son message. */
async function write<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const result = await post<T>(path, body);
  changed();
  return result;
}

export async function loadMemo(root: string): Promise<ProjectMemo> {
  return (await api<{ memo: ProjectMemo }>("/api/memo", { root })).memo;
}

/** Les mémos de tous les projets qui en ont un, ouverts ou non. */
export async function loadAllMemos(): Promise<ProjectMemo[]> {
  return (await api<{ memos: ProjectMemo[] }>("/api/memo/all")).memos;
}

/** Ajoute un lien, ou remplace celui dont l'adresse est `replacing` ; le serveur normalise l'adresse. */
export async function putLink(root: string, link: MemoLink, replacing?: string): Promise<MemoLink> {
  return (await write<{ link: MemoLink }>("/api/memo/links/put", { root, link, ...(replacing ? { replacing } : {}) })).link;
}

export async function removeLink(root: string, url: string): Promise<void> {
  await write("/api/memo/links/remove", { root, url });
}

export async function orderLinks(root: string, urls: readonly string[]): Promise<void> {
  await write("/api/memo/links/order", { root, urls });
}

/** Épingle des fichiers d'un projet ouvert ; rend le nombre de ceux qui ne l'étaient pas déjà. */
export async function pinFiles(root: string, paths: readonly string[]): Promise<number> {
  return (await write<{ added: number }>("/api/memo/pins/add", { root, paths })).added;
}

export async function unpinFile(root: string, path: string): Promise<void> {
  await write("/api/memo/pins/remove", { root, path });
}

export async function orderPins(root: string, paths: readonly string[]): Promise<void> {
  await write("/api/memo/pins/order", { root, paths });
}

/** Crée une note et rend son chemin, pour l'ouvrir dans l'éditeur. */
export async function createNote(root: string, name: string): Promise<string> {
  return (await write<{ path: string }>("/api/memo/notes/create", { root, name })).path;
}

export async function renameNote(root: string, path: string, name: string): Promise<string> {
  return (await write<{ path: string }>("/api/memo/notes/rename", { root, path, name })).path;
}

export async function trashNote(root: string, path: string): Promise<void> {
  await write("/api/memo/notes/trash", { root, path });
}

/**
 * Ouvre un lien dans le navigateur, ou la messagerie ; l'application de bureau
 * les passe au système. Le serveur ne garde que ces adresses : le contrôle refait
 * ici protège d'un `memo.json` modifié à la main.
 */
export function openLink(url: string): void {
  if (!/^(https?|mailto):/i.test(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

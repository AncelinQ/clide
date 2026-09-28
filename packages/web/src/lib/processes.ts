import type { ProcessNode } from "@/lib/types";

/** L'onglet d'où descend un processus : le sien s'il en est la racine, sinon celui de ses parents. */
export function tabOf(node: ProcessNode, inherited: string | undefined): string | undefined {
  return node.link.kind === "owned" ? node.link.terminalId : inherited;
}

/** Un processus Claude Code : l'exécutable natif, ou Node qui fait tourner la CLI. */
export function isClaudeProcess(node: ProcessNode): boolean {
  if (/^claude(\.exe)?$/i.test(node.name)) return true;
  return /^node(\.exe)?$/i.test(node.name) && /[\\/]@anthropic-ai[\\/]claude-code[\\/]|[\\/]claude(\.c?m?js)?(?=["'\s]|$)/i.test(node.commandLine ?? "");
}

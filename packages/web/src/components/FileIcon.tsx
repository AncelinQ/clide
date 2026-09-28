import { iconFor } from "@/lib/file-icons";
import { cn } from "cn";

/** Adresse du sprite, servi avec le client ; ses couleurs viennent des variables `--vscode-ctp-*` de la page. */
const SPRITE = "catppuccin/icons.svg";

/** Icône de fichier ou de dossier de Catppuccin, comme dans VS Code avec ce thème. */
export function FileIcon({
  name,
  directory,
  open = false,
  className,
}: {
  name: string;
  directory: boolean;
  open?: boolean;
  className?: string;
}) {
  return (
    <svg aria-hidden className={cn("size-4 shrink-0", className)}>
      <use href={`${SPRITE}#${iconFor(name, directory, open)}`} />
    </svg>
  );
}

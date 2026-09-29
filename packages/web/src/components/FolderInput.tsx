import { FolderOpen } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { pickPath } from "@/lib/api";
import { getState } from "@/state/store";

/**
 * Chemin de dossier : à taper, à coller, ou à choisir dans la fenêtre du système.
 *
 * La fenêtre s'ouvre sur le dossier déjà saisi, s'il y en a un. Un choix remplace
 * la saisie ; une annulation la laisse telle quelle.
 */
export function FolderInput({
  value,
  onChange,
  onPicked,
  title,
  placeholder,
  autoFocus,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Appelé après un choix dans la fenêtre, avec le dossier retenu. */
  onPicked?: (path: string) => void;
  /** Titre de la fenêtre de sélection. */
  title?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const browse = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // Champ vide : le dossier des projets des Réglages, plutôt que celui que Windows retient.
      const start = value.trim() || getState().projectsFolder.trim();
      const path = await pickPath({ kind: "folder", ...(title ? { title } : {}), ...(start ? { start } : {}) });
      if (path) {
        onChange(path);
        onPicked?.(path);
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Input
          autoFocus={autoFocus}
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button type="button" variant="outline" disabled={busy} onClick={() => void browse()}>
          <FolderOpen /> {busy ? t("Choix en cours…") : t("Parcourir…")}
        </Button>
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

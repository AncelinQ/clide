import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "cn";

/**
 * Charge une donnée et suit son cycle.
 *
 * `reload` est rendu plutôt que déduit : après une écriture, un panneau doit
 * pouvoir se rafraîchir sans que l'appelant reconstruise ses dépendances.
 *
 * `refresh` relance le chargement **sans effacer** ce qui est affiché : un
 * panneau qui suit une session vivante se relit à chaque ajout, et repasser par
 * « chargement… » le ferait clignoter. Un changement de `deps`, lui, repart de
 * zéro — les données précédentes décrivent autre chose.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[], refresh?: unknown) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);
  const lastDeps = useRef<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const signature = JSON.stringify(deps);
    const same = lastDeps.current === signature;
    lastDeps.current = signature;
    setState((previous) => (same && previous.data !== undefined ? { ...previous, loading: true } : { loading: true }));
    load()
      .then((data) => alive && setState({ data, loading: false }))
      .catch((error: Error) => alive && setState({ error: error.message, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, refresh]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { ...state, reload };
}

export function Async<T>({
  state,
  children,
}: {
  state: { data?: T; error?: string; loading: boolean };
  children: (data: T) => ReactNode;
}) {
  if (state.loading && state.data === undefined) return <p className="py-3 text-muted-foreground">chargement…</p>;
  if (state.error) return <p className="py-3 text-destructive">{state.error}</p>;
  if (state.data === undefined) return null;
  return <>{children(state.data)}</>;
}

/** État vide : une icône en pastille, une phrase, et rien d'autre. */
export function Empty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
      <div className="grid size-11 place-items-center rounded-full bg-accent">
        <Icon className="size-5" />
      </div>
      <p className="text-xs leading-relaxed">{children}</p>
    </div>
  );
}

/** Bande de section pleine largeur, sans carte ni ombre. */
export function Section({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-3 mt-3 border-y bg-accent/40 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
      {children}
    </div>
  );
}

export function Row({
  title,
  sub,
  badges,
  actions,
  children,
  onClick,
  selected,
}: {
  title: ReactNode;
  sub?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <li
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 border-b py-2 last:border-0",
        onClick && "-mx-3 cursor-pointer px-3 hover:bg-accent/50",
        selected && "bg-accent/60",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-1.5">
        {badges}
        <span className="break-words">{title}</span>
      </div>
      {sub && <span className="text-[11px] break-words text-muted-foreground">{sub}</span>}
      {children}
      {actions && <div className="mt-0.5 flex flex-wrap items-center gap-1.5">{actions}</div>}
    </li>
  );
}

export const Rows = ({ children }: { children: ReactNode }) => <ul className="m-0 list-none p-0">{children}</ul>;

/**
 * Bouton de suppression en deux temps.
 *
 * Une confirmation modale interromprait pour un geste courant ; un second clic
 * écarte l'accident sans bloquer.
 */
export function DangerButton({ label, onConfirm }: { label: string; onConfirm: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
      // Signale au conteneur que le bouton attend une confirmation ou montre une
      // erreur : un bouton révélé au survol doit rester visible dans ces deux cas.
      data-armed={armed || error ? "" : undefined}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        try {
          await onConfirm();
        } catch (caught) {
          setError((caught as Error).message);
        }
      }}
    >
      {error ?? (armed ? "confirmer ?" : label)}
    </Button>
  );
}

/** Bouton d'action : désactivé pendant l'appel, erreur rendue en place. */
export function ActionButton({
  children,
  onAction,
  variant = "outline",
}: {
  children: ReactNode;
  onAction: () => Promise<void> | void;
  variant?: "outline" | "default" | "ghost";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <Button
      variant={variant}
      size="sm"
      className="h-6 px-2 text-[11px]"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setError(undefined);
        try {
          await onAction();
        } catch (caught) {
          setError((caught as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error ?? children}
    </Button>
  );
}

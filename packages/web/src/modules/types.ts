import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Une vue du panneau global, à droite : ce qui ne dépend d'aucun projet. */
export interface GlobalView {
  id: string;
  icon: LucideIcon;
  /** Chaîne source française, traduite à l'affichage. */
  label: string;
  /** La vue se filtre par le champ au-dessus du panneau. */
  searchable?: boolean;
  render: (context: { filter: string }) => ReactNode;
}

/** Une vue de la colonne du projet, à gauche. */
export interface ProjectView {
  id: string;
  icon: LucideIcon;
  label: string;
  about: string;
  /** Section du guide qui la détaille : `projet#lancer-un-script`. */
  doc?: string;
  render: (root: string) => ReactNode;
}

/** Un mode du bloc sous le terminal, à côté de ceux de la session. */
export interface BottomView {
  id: string;
  icon: LucideIcon;
  title: string;
  about: string;
  doc?: string;
  render: (root: string) => ReactNode;
}

/**
 * Un module de l'interface : une fonction de Clide qu'on peut couper dans les
 * Réglages. Il déclare ses vues ; l'application les range dans ses barres et ne
 * le connaît pas autrement. Désactivé, il n'apparaît plus nulle part.
 */
export interface WebModule {
  id: string;
  title: string;
  description: string;
  globalViews?: GlobalView[];
  projectViews?: ProjectView[];
  bottomViews?: BottomView[];
}

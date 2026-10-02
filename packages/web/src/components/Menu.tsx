import { Check } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { tidy, type MenuItem } from "@/lib/menu";

export type { MenuItem };

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Les primitives d'un type de menu : déroulant ou contextuel. */
interface Parts {
  Item: typeof DropdownMenuItem | typeof ContextMenuItem;
  Label: typeof DropdownMenuLabel | typeof ContextMenuLabel;
  Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
  Shortcut: typeof DropdownMenuShortcut | typeof ContextMenuShortcut;
  Sub: typeof DropdownMenuSub | typeof ContextMenuSub;
  SubTrigger: typeof DropdownMenuSubTrigger | typeof ContextMenuSubTrigger;
  SubContent: typeof DropdownMenuSubContent | typeof ContextMenuSubContent;
}

const DROPDOWN: Parts = {
  Item: DropdownMenuItem,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

const CONTEXT: Parts = {
  Item: ContextMenuItem,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
  Shortcut: ContextMenuShortcut,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

/** Survol d'un menu ouvert au survol : ses sous-menus, dans leur propre calque, en font partie. */
const HoverContext = createContext<{ enter: () => void; leave: () => void } | null>(null);

function Items({ items, parts }: { items: MenuItem[]; parts: Parts }) {
  const { Item, Label, Separator, Shortcut, Sub, SubTrigger, SubContent } = parts;
  const hover = useContext(HoverContext);
  return tidy(items).map((item, index) => {
    switch (item.kind) {
      case "separator":
        return <Separator key={`sep-${index}`} />;
      case "label":
        return (
          <Label key={`label-${index}`} className="text-[11px] font-normal text-muted-foreground">
            {item.label}
          </Label>
        );
      case "submenu": {
        const Icon = item.icon;
        return (
          <Sub key={`sub-${item.label}`}>
            <SubTrigger disabled={item.disabled ?? item.items.length === 0}>
              {Icon && <Icon />}
              {item.label}
            </SubTrigger>
            <SubContent className="min-w-48" onPointerEnter={hover?.enter} onPointerLeave={hover?.leave}>
              <Items items={item.items} parts={parts} />
            </SubContent>
          </Sub>
        );
      }
      case "item": {
        const Icon = item.icon;
        return (
          <Item
            key={`item-${item.label}-${index}`}
            disabled={item.disabled}
            variant={item.danger ? "destructive" : "default"}
            onSelect={item.run}
            className={item.hint ? "items-start" : undefined}
          >
            {item.checked !== undefined ? (
              <Check className={item.checked ? undefined : "invisible"} />
            ) : (
              Icon && <Icon />
            )}
            <span className="min-w-0 flex-1">
              <span className="block">{item.label}</span>
              {item.hint && <span className="block text-[11px] text-muted-foreground">{item.hint}</span>}
            </span>
            {item.shortcut && <Shortcut>{item.shortcut}</Shortcut>}
          </Item>
        );
      }
    }
  });
}

/** Délais du survol : assez pour traverser l'espace entre le bouton et le menu sans le fermer. */
const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 250;

/**
 * Menu déroulant sous un déclencheur (un bouton, en général). `hover` l'ouvre au
 * survol et le ferme quand le pointeur quitte le bouton, le menu et ses
 * sous-menus ; le clic l'ouvre et le ferme toujours.
 */
export function MenuButton({
  trigger,
  items,
  align = "end",
  className = "min-w-56",
  hover = false,
}: {
  trigger: ReactNode;
  items: MenuItem[] | (() => MenuItem[]);
  align?: "start" | "center" | "end";
  className?: string;
  hover?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const later = (value: boolean, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(value), delay);
  };
  const handlers = hover ? { enter: () => later(true, open ? 0 : HOVER_OPEN_MS), leave: () => later(false, HOVER_CLOSE_MS) } : null;
  return (
    // Au survol, le menu n'est pas modal : il ne doit pas bloquer le pointeur qui le quitte.
    <DropdownMenu open={open} onOpenChange={(value) => { clearTimeout(timer.current); setOpen(value); }} modal={!hover}>
      <DropdownMenuTrigger asChild onPointerEnter={handlers?.enter} onPointerLeave={handlers?.leave}>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={className} onPointerEnter={handlers?.enter} onPointerLeave={handlers?.leave}>
        <HoverContext.Provider value={handlers}>
          <Items items={typeof items === "function" ? items() : items} parts={DROPDOWN} />
        </HoverContext.Provider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * À la fermeture d'un menu : une entrée qui ouvre un champ en place (Renommer)
 * le veut sous le clavier, et le menu rendrait le focus ailleurs.
 */
export function keepFieldFocus(event: Event): void {
  const field = document.querySelector<HTMLElement>("[data-takes-focus]");
  if (!field) return;
  event.preventDefault();
  field.focus();
}

/** Menu contextuel, au clic droit sur ce qu'il enveloppe. */
export function ContextArea({
  children,
  items,
  className = "min-w-52",
}: {
  children: ReactNode;
  items: MenuItem[] | (() => MenuItem[]);
  className?: string;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className={className} onCloseAutoFocus={keepFieldFocus}>
        <Items items={typeof items === "function" ? items() : items} parts={CONTEXT} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

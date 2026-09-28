import { Check } from "lucide-react";
import type { ReactNode } from "react";

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

function Items({ items, parts }: { items: MenuItem[]; parts: Parts }) {
  const { Item, Label, Separator, Shortcut, Sub, SubTrigger, SubContent } = parts;
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
            <SubContent className="min-w-48">
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

/** Menu déroulant sous un déclencheur (un bouton, en général). */
export function MenuButton({
  trigger,
  items,
  align = "end",
  className = "min-w-56",
}: {
  trigger: ReactNode;
  items: MenuItem[] | (() => MenuItem[]);
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={className}>
        <Items items={typeof items === "function" ? items() : items} parts={DROPDOWN} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
      <ContextMenuContent className={className}>
        <Items items={typeof items === "function" ? items() : items} parts={CONTEXT} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

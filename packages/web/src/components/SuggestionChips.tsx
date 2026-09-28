import { cn } from "cn";

/** Des suggestions en pastilles sous un champ : un clic les prend, le champ garde le focus. */
export function SuggestionChips({ items, onPick, mono }: { items: readonly string[]; onPick: (value: string) => void; mono?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" data-suggestions>
      {items.map((item) => (
        <button
          key={item}
          type="button"
          // Le focus reste dans le champ : on continue à taper après la pastille.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(item)}
          className={cn(
            "max-w-full truncate rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground",
            mono && "font-mono",
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

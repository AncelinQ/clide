import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "cn";

/**
 * Styles des éléments rendus.
 *
 * Donnés élément par élément plutôt que par une feuille « prose » : le bloc est
 * étroit et dense, et chaque niveau de titre y garde une taille de corps.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="mt-3 mb-1.5 text-[13px] font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-3 mb-1.5 text-[12.5px] font-semibold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-2.5 mb-1 text-[12px] font-semibold first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mt-2 mb-1 text-[12px] font-medium first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
  ul: ({ children, className }) => (
    <ul className={cn("my-1.5 pl-5", className?.includes("contains-task-list") ? "list-none pl-1" : "list-disc")}>
      {children}
    </ul>
  ),
  ol: ({ children }) => <ol className="my-1.5 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5 leading-relaxed">{children}</li>,
  input: ({ checked }) => (
    <input type="checkbox" checked={checked ?? false} readOnly className="mr-1.5 align-middle accent-primary" />
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-auto rounded-md border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-auto">
      <table className="w-full border-collapse text-[11.5px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border px-2 py-1 align-top">{children}</td>,
  hr: () => <hr className="my-3 border-border" />,
};

/**
 * Markdown rédigé par Claude, rendu sans HTML brut.
 *
 * `react-markdown` n'interprète pas le HTML embarqué : un texte produit par un
 * modèle ne doit pas pouvoir injecter de balise dans la page.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("text-[12px] break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

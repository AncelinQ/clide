"use client"

import * as React from "react"
import { cn } from "cn"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { t } from "@/i18n"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Le dernier élément focalisé hors d'un menu ou d'une fenêtre : celui d'où l'on a
 * ouvert le menu, ou la fenêtre partie depuis.
 */
let lastOutside: Element | null = null
document.addEventListener("focusin", (event) => {
  if (event.target instanceof Element && !event.target.closest('[role="menu"], [role="dialog"]')) lastOutside = event.target
})

/**
 * Retient, au premier rendu d'une fenêtre ouverte, à qui rendre le focus. C'est
 * l'élément qui l'a ; ouverte depuis un menu, dont l'entrée va disparaître, c'est
 * l'élément d'où l'on a ouvert le menu. Le dernier élément hors des menus et des
 * fenêtres sert de repli : une fenêtre ouverte depuis la palette n'a plus son
 * élément d'origine en se fermant. `onOpenAutoFocus` viendrait trop tard : un
 * champ `autoFocus` de la fenêtre a déjà pris le focus.
 */
function RememberOpener({ into }: { into: React.RefObject<Element[]> }) {
  const done = React.useRef(false)
  if (!done.current) {
    done.current = true
    const active = document.activeElement
    const candidates = !active || active === document.body ? [] : active.closest('[role="menu"]') ? [lastOutside] : [active, lastOutside]
    into.current = candidates.filter((element) => element !== null)
  }
  return null
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  fallbackFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** À la fermeture, quand rien n'avait le focus à l'ouverture ou que c'est parti. */
  fallbackFocus?: () => void
}) {
  // Les fenêtres s'ouvrent par l'état, sans `DialogTrigger` : Radix ne saurait à
  // qui rendre le focus en se fermant, et le laisserait sur `body`. Il revient à ce
  // qui l'avait à l'ouverture, sauf si quelque chose l'a pris entre-temps (une
  // commande qui montre un terminal, une autre fenêtre). Une fenêtre qui le rend
  // elle-même appelle `preventDefault` dans son `onCloseAutoFocus`.
  const opener = React.useRef<Element[]>([])
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (event.defaultPrevented) return
          event.preventDefault()
          const back = opener.current.find((element) => element instanceof HTMLElement && element.isConnected)
          opener.current = []
          if (document.activeElement && document.activeElement !== document.body) return
          if (back instanceof HTMLElement) back.focus()
          else fallbackFocus?.()
        }}
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full grid-cols-1 max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          className
        )}
        {...props}
      >
        <RememberOpener into={opener} />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">{t("Fermer")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">{t("Fermer")}</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}

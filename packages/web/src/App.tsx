import { useEffect } from "react";

import { CommandPalette } from "@/components/CommandPalette";
import { GlobalColumn, ProjectColumn } from "@/components/columns";
import { TerminalArea } from "@/components/TerminalArea";
import { TitleBar } from "@/components/TitleBar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "cn";
import { useLanguage } from "@/i18n";
import { useStore } from "@/state/store";
import { badgeImage } from "@/state/notify";
import { listenShortcuts } from "@/state/commands";
import { resizeActive } from "@/state/terminals";

export function App() {
  const { showLeft, showRight, attention } = useStore((state) => state);
  // Changer de langue redessine tout ce qui affiche du texte.
  const language = useLanguage();

  // Les raccourcis valent pour toute l'application, terminal compris.
  useEffect(() => listenShortcuts(), []);


  // Le titre de l'onglet est le seul endroit visible quand la fenêtre est en
  // arrière-plan ; sous Electron, le bouton de la barre des tâches clignote aussi
  // et porte le compteur.
  useEffect(() => {
    const waiting = Object.keys(attention).length;
    document.title = waiting > 0 ? `(${waiting}) claude-ide` : "claude-ide";
    window.claudeIde?.setAttention(waiting, waiting > 0 ? badgeImage(waiting) : undefined);
  }, [attention]);

  useEffect(() => {
    const onResize = () => resizeActive();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    requestAnimationFrame(resizeActive);
  }, [showLeft, showRight]);

  return (
    <TooltipProvider delayDuration={400}>
      <CommandPalette />
      {/* Remonté à chaque changement de langue : chaque texte se relit. Les
          terminaux n'y perdent rien, ils vivent hors de React. */}
      <div key={language} className="flex h-full flex-col">
        <TitleBar />
        <main
          className={cn(
            "grid min-h-0 flex-1 gap-1 px-1 pb-1",
            showLeft && showRight && "grid-cols-[290px_1fr_340px]",
            showLeft && !showRight && "grid-cols-[290px_1fr]",
            !showLeft && showRight && "grid-cols-[1fr_340px]",
            !showLeft && !showRight && "grid-cols-1",
          )}
        >
          {showLeft && <ProjectColumn />}
          <TerminalArea />
          {showRight && <GlobalColumn />}
        </main>
      </div>
    </TooltipProvider>
  );
}

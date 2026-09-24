import { useEffect, useRef } from "react";

import { CommandPalette } from "@/components/CommandPalette";
import { Splitter, clamp } from "@/components/Splitter";
import { GlobalColumn, ProjectColumn } from "@/components/columns";
import { TerminalArea } from "@/components/TerminalArea";
import { TitleBar } from "@/components/TitleBar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLanguage } from "@/i18n";
import { DEFAULT_WIDTHS, getState, setState, useStore } from "@/state/store";
import { badgeImage } from "@/state/notify";
import { listenShortcuts } from "@/state/commands";
import { resizeActive } from "@/state/terminals";

/** Le terminal garde de quoi afficher une ligne de commande lisible. */
const MIDDLE_MIN = 420;
/** Marges de la page et poignées, qui prennent leur part de la largeur. */
const CHROME = 16;

export function App() {
  const { showLeft, showRight, attention, widths } = useStore((state) => state);
  // Changer de langue redessine tout ce qui affiche du texte.
  const language = useLanguage();

  // Les raccourcis valent pour toute l'application, terminal compris.
  useEffect(() => listenShortcuts(), []);


  // Le titre de l'onglet est le seul endroit visible quand la fenêtre est en
  // arrière-plan ; sous Electron, le bouton de la barre des tâches clignote aussi
  // et porte le compteur.
  useEffect(() => {
    const waiting = Object.keys(attention).length;
    document.title = waiting > 0 ? `(${waiting}) Clide` : "Clide";
    window.clide?.setAttention(waiting, waiting > 0 ? badgeImage(waiting) : undefined);
  }, [attention]);

  useEffect(() => {
    // Une fenêtre qui rétrécit prend sur les colonnes latérales, pas sur le terminal.
    const onResize = () => {
      const { widths: current, showLeft: left, showRight: right } = getState();
      const spare = window.innerWidth - CHROME - MIDDLE_MIN;
      const shownLeft = left ? current.left : 0;
      const shownRight = right ? current.right : 0;
      if (shownLeft + shownRight > spare) {
        const scale = Math.max(spare, 0) / (shownLeft + shownRight);
        setState({
          widths: {
            ...current,
            left: Math.max(200, Math.round(current.left * scale)),
            right: Math.max(260, Math.round(current.right * scale)),
          },
        });
      }
      resizeActive();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    requestAnimationFrame(resizeActive);
  }, [showLeft, showRight, widths.left, widths.right]);

  // Largeur au début du geste : le déplacement s'y ajoute, sans dériver.
  const start = useRef(0);
  const room = (other: number) => window.innerWidth - CHROME - other - MIDDLE_MIN;

  return (
    <TooltipProvider delayDuration={400}>
      <CommandPalette />
      {/* Remonté à chaque changement de langue : chaque texte se relit. Les
          terminaux n'y perdent rien, ils vivent hors de React. */}
      <div key={language} className="flex h-full flex-col">
        <TitleBar />
        <main
          className="flex min-h-0 flex-1 px-1 pb-1"
        >
          {showLeft && (
            <>
              <div className="flex min-h-0 shrink-0 [&>*]:flex-1" style={{ width: widths.left }}>
                <ProjectColumn />
              </div>
              <Splitter
                onStart={() => (start.current = getState().widths.left)}
                onDrag={(dx) =>
                  setState((current) => ({
                    widths: {
                      ...current.widths,
                      left: clamp(start.current + dx, 200, room(showRight ? current.widths.right : 0)),
                    },
                  }))
                }
                onReset={() => setState((current) => ({ widths: { ...current.widths, left: DEFAULT_WIDTHS.left } }))}
              />
            </>
          )}
          <div className="flex min-h-0 min-w-0 flex-1 [&>*]:flex-1">
            <TerminalArea />
          </div>
          {showRight && (
            <>
              <Splitter
                onStart={() => (start.current = getState().widths.right)}
                onDrag={(dx) =>
                  setState((current) => ({
                    widths: {
                      ...current.widths,
                      right: clamp(start.current - dx, 260, room(showLeft ? current.widths.left : 0)),
                    },
                  }))
                }
                onReset={() => setState((current) => ({ widths: { ...current.widths, right: DEFAULT_WIDTHS.right } }))}
              />
              <div className="flex min-h-0 shrink-0 [&>*]:flex-1" style={{ width: widths.right }}>
                <GlobalColumn />
              </div>
            </>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

import { useEffect, useState } from "react";

import { getState, subscribe } from "@/state/store";

/**
 * État de la mise à jour de l'application de bureau, suivi en direct. Toujours
 * `undefined` dans un navigateur, qui n'a rien à mettre à jour.
 */
export function useAppUpdate(): UpdateState | undefined {
  const [state, setUpdate] = useState<UpdateState>();
  useEffect(() => {
    const update = window.clide?.update;
    if (!update) return;
    let live = true;
    void update.get().then((initial) => {
      if (live) setUpdate(initial);
    });
    const unsubscribe = update.onChange(setUpdate);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return state;
}

/**
 * Transmet le réglage « mises à jour automatiques » à l'application de bureau,
 * au démarrage puis à chaque changement : c'est elle qui planifie les
 * vérifications, mais le réglage est mémorisé avec les autres, côté page.
 */
export function syncAutoUpdate(): void {
  const update = window.clide?.update;
  if (!update) return;
  let sent: boolean | undefined;
  const send = () => {
    const { autoUpdate } = getState();
    if (autoUpdate === sent) return;
    sent = autoUpdate;
    update.setAuto(autoUpdate);
  };
  send();
  subscribe(send);
}

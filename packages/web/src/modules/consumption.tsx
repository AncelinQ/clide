import { Gauge } from "lucide-react";

import { CostsPanel } from "@/components/panels/costs";
import { UsagePanel } from "@/components/panels/usage";
import { t } from "@/i18n";
import type { WebModule } from "@/modules/types";

/** Les limites de l'abonnement puis ce qu'ont coûté les sessions : deux faces d'une même question. */
function ConsumptionView() {
  return (
    <div className="grid gap-4">
      <UsagePanel />
      <div>
        <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t("Coûts")}</h3>
        <CostsPanel />
      </div>
    </div>
  );
}

export const consumption: WebModule = {
  id: "consumption",
  title: "Consommation",
  description: "Les limites de l'abonnement et ce que coûtent les sessions.",
  globalViews: [{ id: "consumption", icon: Gauge, label: "Consommation", render: () => <ConsumptionView /> }],
};

import { Gauge } from "lucide-react";

import { FoldSection } from "@/components/common";
import { CostsPanel } from "@/components/panels/costs";
import { UsagePanel } from "@/components/panels/usage";
import { t } from "@/i18n";
import type { WebModule } from "@/modules/types";

/**
 * L'usage de l'abonnement puis ce qu'ont coûté les sessions : deux faces d'une
 * même question, chacune repliable avec ses sous-sections.
 */
function ConsumptionView() {
  return (
    <div className="-mt-3">
      <FoldSection id="consumption.usage" title={t("Usage")}>
        <UsagePanel />
      </FoldSection>
      <FoldSection id="consumption.costs" title={t("Coûts")}>
        <CostsPanel />
      </FoldSection>
    </div>
  );
}

export const consumption: WebModule = {
  id: "consumption",
  title: "Consommation",
  description: "Les limites de l'abonnement et ce que coûtent les sessions.",
  globalViews: [{ id: "consumption", icon: Gauge, label: "Consommation", render: () => <ConsumptionView /> }],
};

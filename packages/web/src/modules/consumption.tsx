import { Gauge } from "lucide-react";

import { FoldSection } from "@/components/common";
import { ClaudeInfoSections } from "@/components/panels/claude-info";
import { CostsPanel } from "@/components/panels/costs";
import { UsagePanel } from "@/components/panels/usage";
import { t } from "@/i18n";
import type { WebModule } from "@/modules/types";

/**
 * L'usage de l'abonnement et ce qu'ont coûté les sessions, puis la version de
 * Claude Code et l'état des services : chaque section repliable avec ses
 * sous-sections.
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
      <ClaudeInfoSections />
    </div>
  );
}

export const consumption: WebModule = {
  id: "consumption",
  title: "Consommation",
  description: "Les limites de l'abonnement, ce que coûtent les sessions, la version de Claude Code et l'état des services.",
  globalViews: [{ id: "consumption", icon: Gauge, label: "Consommation", render: () => <ConsumptionView /> }],
};

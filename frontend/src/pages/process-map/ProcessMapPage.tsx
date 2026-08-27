import { useState } from "react";
import { ProcessMapSurface } from "../../modules/process-map/ProcessMapSurface.js";

export type ProcessMapPageProps = {
  apiBase: string;
  companyID: string;
  onOpenLogicGate: (logicGateID: string, label: string) => void;
};

export function ProcessMapPage({ apiBase, companyID, onOpenLogicGate }: ProcessMapPageProps) {
  const [hoverModeEnabled, setHoverModeEnabled] = useState(false);

  return (
    <main className="process-map-page" aria-label="Process Map">
      <div className="process-map-page__canvas">
        <ProcessMapSurface
          apiBase={apiBase}
          companyID={companyID}
          hoverModeEnabled={hoverModeEnabled}
          onOpenLogicGate={onOpenLogicGate}
        />
        <label className="process-map-page__hover-mode">
          <input type="checkbox" checked={hoverModeEnabled} onChange={(event) => setHoverModeEnabled(event.currentTarget.checked)} />
          <span>Hover mode</span>
        </label>
      </div>
    </main>
  );
}

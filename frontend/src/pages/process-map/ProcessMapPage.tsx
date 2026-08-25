import { useCallback, useState } from "react";
import { buildProcessMapRoute } from "../../app/deepLinkRoutes.js";
import { ProcessMapSurface } from "../../modules/process-map/ProcessMapSurface.js";
import type { ProcessMapLayerResponse } from "../../modules/process-map/processMapApi.js";

export type ProcessMapPageProps = {
  apiBase: string;
  companyID: string;
  folderID?: string;
  onNavigate?: (path: string) => void;
};

export function ProcessMapPage({ apiBase, companyID, folderID, onNavigate }: ProcessMapPageProps) {
  const [layer, setLayer] = useState<ProcessMapLayerResponse["layer"] | null>(null);
  const openFolder = useCallback((nextFolderID: string) => {
    onNavigate?.(buildProcessMapRoute(nextFolderID));
  }, [onNavigate]);

  return (
    <main className="process-map-page" aria-label="Process Map">
      <header className="process-map-page__header">
        <button
          type="button"
          className="process-map-page__root"
          aria-current={!folderID ? "page" : undefined}
          onClick={() => onNavigate?.(buildProcessMapRoute())}
        >
          Process Map
        </button>
        {folderID && (
          <>
            <span className="process-map-page__separator" aria-hidden="true">/</span>
            <span className="process-map-page__layer-name">{layer?.kind === "folder" ? layer.name : "Folder"}</span>
          </>
        )}
      </header>
      <div className="process-map-page__canvas">
        <ProcessMapSurface
          apiBase={apiBase}
          companyID={companyID}
          folderID={folderID}
          onOpenFolder={openFolder}
          onLayerChange={setLayer}
        />
      </div>
    </main>
  );
}

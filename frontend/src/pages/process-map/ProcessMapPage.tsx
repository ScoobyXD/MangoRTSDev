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
        {layer?.kind === "folder" && (
          <nav className="process-map-page__breadcrumbs" aria-label="Process Map folder path">
            {layer.ancestors.map((ancestor) => (
              <span className="process-map-page__breadcrumb" key={ancestor.folder_id}>
                <span className="process-map-page__separator" aria-hidden="true">/</span>
                <button
                  type="button"
                  className="process-map-page__ancestor"
                  onClick={() => onNavigate?.(buildProcessMapRoute(ancestor.folder_id))}
                >
                  {ancestor.name}
                </button>
              </span>
            ))}
            <span className="process-map-page__breadcrumb">
            <span className="process-map-page__separator" aria-hidden="true">/</span>
              <span className="process-map-page__layer-name" aria-current="page">{layer.name}</span>
            </span>
          </nav>
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

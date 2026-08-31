import React, { useEffect, useMemo, useState } from "react";
import {
  emitDashboardEvent,
  EVENT_COMPANY_EXPLORER_FIND_REQUESTED,
  EVENT_EXPLORER_CONTEXT_UPDATED,
  EVENT_HUDDLE_EXPLORER_FIND_REQUESTED,
  type ExplorerContextUpdatedDetail,
} from "../dashboardEvents.js";
import { openEditorEntityLink } from "../editor/editorEntityLinks.js";
import { createCoalescedCanonicalRefresh } from "../realtime/coalescedCanonicalRefresh.js";
import type { CompanyExplorerFindRequestDetail } from "../company-explorer/companyExplorerTypes.js";
import {
  fetchHierarchyPath,
  type HierarchyPathKind,
  type HierarchyPathResponse,
  type HierarchyPathSegment,
  type HierarchyResourceType,
} from "./hierarchyPathApi.js";

type HierarchyBreadcrumbProps = {
  apiBase: string;
  companyID: string;
  kind: HierarchyPathKind;
  resourceType: HierarchyResourceType;
  resourceID: string;
  onBeforeNavigate?: () => void;
};

type HuddleExplorerFindRequest = {
  companyID: string;
  selectRoot?: boolean;
  folderPathIDs?: string[];
};

function rootLabel(kind: HierarchyPathKind): string {
  return kind === "huddle_explorer" ? "Huddle Boards" : "Workspace";
}

function segmentResourceID(segment: HierarchyPathSegment): string {
  return (segment.resource_id || segment.entity_id).trim();
}

function revealCompanyExplorerRoot(companyID: string): void {
  emitDashboardEvent<CompanyExplorerFindRequestDetail>(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, {
    companyID,
    sourceFrameID: "hierarchy-breadcrumb",
    selectRoot: true,
    changedAt: Date.now(),
  });
}

function revealCompanyExplorerFolder(companyID: string, segments: HierarchyPathSegment[], selectedIndex: number): void {
  const folderPathIDs = segments
    .slice(0, selectedIndex + 1)
    .filter((segment) => segment.entity_type === "folder")
    .map((segment) => segment.entity_id.trim())
    .filter(Boolean);
  const folderID = folderPathIDs[folderPathIDs.length - 1] ?? "";
  if (!folderID) return;
  emitDashboardEvent<CompanyExplorerFindRequestDetail>(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, {
    companyID,
    sourceFrameID: "hierarchy-breadcrumb",
    folderPathIDs,
    entities: [{ kind: "folder", id: folderID }],
    changedAt: Date.now(),
  });
}

function revealHuddleExplorerRoot(companyID: string): void {
  emitDashboardEvent<HuddleExplorerFindRequest>(EVENT_HUDDLE_EXPLORER_FIND_REQUESTED, {
    companyID,
    selectRoot: true,
  });
}

function revealHuddleExplorerFolder(companyID: string, segments: HierarchyPathSegment[], selectedIndex: number): void {
  const folderPathIDs = segments
    .slice(0, selectedIndex + 1)
    .filter((segment) => segment.entity_type === "huddle_explorer_folder")
    .map((segment) => segment.entity_id.trim())
    .filter(Boolean);
  if (folderPathIDs.length === 0) return;
  emitDashboardEvent<HuddleExplorerFindRequest>(EVENT_HUDDLE_EXPLORER_FIND_REQUESTED, {
    companyID,
    folderPathIDs,
  });
}

function openHierarchySegment(companyID: string, segments: HierarchyPathSegment[], index: number): void {
  const segment = segments[index];
  if (!segment) return;
  if (segment.entity_type === "folder") {
    revealCompanyExplorerFolder(companyID, segments, index);
    return;
  }
  if (segment.entity_type === "huddle_explorer_folder") {
    revealHuddleExplorerFolder(companyID, segments, index);
    return;
  }
  if (segment.entity_type === "huddle_logic_gate") {
    const resourceID = segmentResourceID(segment);
    if (!resourceID) return;
    window.dispatchEvent(new CustomEvent("mangorts:huddle-open", {
      detail: { resourceType: "huddle_logic_gate", resourceID, name: segment.name },
    }));
    return;
  }
  const resourceID = segmentResourceID(segment);
  if (!resourceID || (segment.entity_type !== "logic_gate" && segment.entity_type !== "project")) return;
  openEditorEntityLink({ entityType: segment.entity_type, entityID: resourceID, label: segment.name });
}

export const HierarchyBreadcrumb: React.FC<HierarchyBreadcrumbProps> = ({
  apiBase,
  companyID,
  kind,
  resourceType,
  resourceID,
  onBeforeNavigate,
}) => {
  const [path, setPath] = useState<HierarchyPathResponse | null>(null);

  useEffect(() => {
    const cleanCompanyID = companyID.trim();
    const cleanResourceID = resourceID.trim();
    if (!cleanCompanyID || !cleanResourceID) {
      setPath(null);
      return undefined;
    }
    let disposed = false;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const result = await fetchHierarchyPath(apiBase, {
          companyID: cleanCompanyID,
          kind,
          resourceType,
          resourceID: cleanResourceID,
        }, requestController.signal);
        if (!disposed && !requestController.signal.aborted) setPath(result);
      } catch {
        if (!disposed && !requestController.signal.aborted) setPath(null);
      }
    };
    const canonicalRefresh = createCoalescedCanonicalRefresh(load);
    const handleContextUpdate = (event: Event) => {
      const detail = (event as CustomEvent<ExplorerContextUpdatedDetail>).detail;
      if (detail?.companyID.trim() === cleanCompanyID && detail.kind === kind) canonicalRefresh.request();
    };
    setPath(null);
    canonicalRefresh.request();
    window.addEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, handleContextUpdate);
    return () => {
      disposed = true;
      canonicalRefresh.dispose();
      controller?.abort();
      window.removeEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, handleContextUpdate);
    };
  }, [apiBase, companyID, kind, resourceID, resourceType]);

  const fullPathLabel = useMemo(() => {
    if (path?.status !== "resolved") return "";
    return [rootLabel(kind), ...(path.segments ?? []).map((segment) => segment.name.trim()).filter(Boolean)].join(" / ");
  }, [kind, path]);

  if (path?.status !== "resolved") return null;
  const segments = path.segments ?? [];
  const openRoot = kind === "huddle_explorer"
    ? () => revealHuddleExplorerRoot(companyID)
    : () => revealCompanyExplorerRoot(companyID);
  const navigate = (action: () => void) => {
    if (!onBeforeNavigate) {
      action();
      return;
    }
    onBeforeNavigate();
    window.requestAnimationFrame(action);
  };

  return (
    <nav aria-label={`Hierarchy path: ${fullPathLabel}`} title={fullPathLabel} data-hierarchy-path={kind} style={breadcrumbStyle}>
      <button type="button" onClick={() => navigate(openRoot)} title={`Open ${rootLabel(kind)}`} style={segmentButtonStyle}>
        <span style={segmentTextStyle}>{rootLabel(kind)}</span>
      </button>
      {segments.map((segment, index) => (
        <React.Fragment key={`${segment.entity_type}:${segment.entity_id}`}>
          <span aria-hidden="true" style={separatorStyle}>/</span>
          <button
            type="button"
            onClick={() => navigate(() => openHierarchySegment(companyID, segments, index))}
            title={`Open ${segment.name}`}
            aria-label={`Open ${segment.name}`}
            data-hierarchy-segment-type={segment.entity_type}
            data-hierarchy-segment-id={segment.entity_id}
            style={segmentButtonStyle}
          >
            <span style={segmentTextStyle}>{segment.name}</span>
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
};

const breadcrumbStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "100%",
  display: "flex",
  alignItems: "center",
  gap: 4,
  overflowX: "auto",
  overflowY: "hidden",
  color: "#64748b",
  fontSize: 11,
  lineHeight: 1.3,
  whiteSpace: "nowrap",
};

const segmentButtonStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: 180,
  flex: "0 1 auto",
  border: 0,
  borderRadius: 5,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  padding: "2px 3px",
  font: "inherit",
  fontWeight: 750,
  textAlign: "left",
};

const segmentTextStyle: React.CSSProperties = {
  display: "block",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const separatorStyle: React.CSSProperties = {
  flex: "0 0 auto",
  color: "rgba(100,116,139,.55)",
  fontWeight: 700,
};

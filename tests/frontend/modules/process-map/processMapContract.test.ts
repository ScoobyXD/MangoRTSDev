import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("Process Map surface keeps interaction, geometry, privacy, and lazy-load rules local", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const styles = source("frontend/src/modules/process-map/processMap.css");
  const geometry = source("frontend/src/modules/process-map/processMapGeometry.ts");
  const api = source("frontend/src/modules/process-map/processMapApi.ts");
  const icons = source("frontend/src/icons/EntityIcons.tsx");
  const page = source("frontend/src/pages/process-map/ProcessMapPage.tsx");
  const picker = source("frontend/src/modules/editor/UniversalEntityPicker.tsx");
  assert.match(surface, /readExplorerDragPayload/);
  assert.match(surface, /decideProcessMapExplorerDrop/);
  assert.match(surface, /fetchCompanyExplorerRoots/);
  assert.match(surface, /fetchCompanyExplorerChildren/);
  assert.match(surface, /folderID\?\.trim\(\)[\s\S]*fetchCompanyExplorerChildren[\s\S]*fetchCompanyExplorerRoots/);
  assert.doesNotMatch(surface, /fetchCompanyExplorerSearchResults|company-explorer\/search/);
  assert.match(surface, /trayCollapsed[\s\S]*setTrayRows\(\[\]\)[\s\S]*return undefined/);
  assert.match(surface, /trayBranchReadRef[\s\S]*if \(previousRead\) await previousRead;[\s\S]*if \(!active\) return undefined;[\s\S]*folderID, refreshVersion, trayCollapsed/);
  assert.match(surface, /mangorts\.process-map\.placement-tray-collapsed\.v1/);
  assert.match(surface, /aria-expanded=\{!trayCollapsed\}/);
  assert.match(surface, /aria-label=\{trayCollapsed \? "Expand placement tray" : "Collapse placement tray"\}/);
  assert.match(surface, /process-map-placement-tray__heading[\s\S]*process-map-placement-tray__disclosure/);
  assert.doesNotMatch(surface, /process-map-placement-tray__collapse-action/);
  assert.doesNotMatch(surface, /Drag to place/);
  assert.match(surface, /<ReactFlow[\s\S]*onDragOver=\{acceptsExplorerDrop\}[\s\S]*onDrop=\{handleDrop\}/);
  assert.match(surface, /setData\(EXPLORER_DRAG_MIME, JSON\.stringify\(candidate\.dragPayload\)\)/);
  assert.ok(surface.indexOf("<aside") < surface.indexOf("<ReactFlow"), "the tray stays outside the transformed React Flow viewport");
  assert.doesNotMatch(surface.slice(surface.indexOf("<section"), surface.indexOf("<ReactFlow")), /onDragOver=|onDrop=/);
  assert.match(surface, /zoomOnDoubleClick=\{false\}/);
  assert.match(surface, /deleteKeyCode=\{null\}/);
  assert.doesNotMatch(surface, /MiniMap|fitView|setViewport|setInterval|company-explorer\/tree|company-explorer\/graph/);
  assert.match(surface, /const openPlacement[\s\S]*processMapFolderDrillTarget[\s\S]*onOpenFolder[\s\S]*resourceType !== "logic_gate"[\s\S]*onOpenLogicGate/);
  assert.match(surface, /onNodeDoubleClick[\s\S]*openPlacement\(node\)/);
  assert.match(surface, /onEdgeDoubleClick[\s\S]*replaceTraceRoute/);
  assert.match(surface, /onMoveWaypoint/);
  assert.match(surface, /clearLayer[\s\S]*setNodes\(\[\]\)[\s\S]*setEdges\(\[\]\)[\s\S]*setSelection\(null\)[\s\S]*onLayerChange\?\.\(null\)/);
  assert.match(surface, /createCoalescedCanonicalRefresh\(\(\)\s*=>\s*\{[\s\S]*clearLayer\(\)[\s\S]*return requestRefresh\(\)/);
  assert.match(surface, /onProcessMapChanged:\s*\(message\)[\s\S]*message\.origin_connection_id[\s\S]*clearLayerAndRefresh\(\)[\s\S]*onRejected:\s*clearLayerAndRefresh/);
  assert.equal(surface.match(/<Background\b/g)?.length, 1);
  assert.doesNotMatch(surface, /process-map-large-grid|PROCESS_MAP_LARGE_GRID_DIVISOR/);
  assert.match(surface, /lineWidth=\{0\.5\}[\s\S]*color="rgba\(148, 163, 184, 0\.12\)"/);
  assert.doesNotMatch(surface, /<Background[\s\S]{0,180}\bsize=/);
  assert.match(surface, /strokeWidth:\s*PROCESS_MAP_GRID_PX/);
  assert.match(surface, /strokeLinecap:\s*"butt"/);
  assert.match(surface, /strokeLinejoin:\s*"miter"/);
  assert.match(surface, /NODE_ICON_GRADIENT_START[\s\S]*NODE_ICON_GRADIENT_END/);
  assert.match(surface, /<path d=\{path\} className="process-map-trace__flow" aria-hidden="true" pointerEvents="none" \/>/);
  assert.match(icons, /NODE_ICON_GRADIENT_START\s*=\s*"#33ddd5"/);
  assert.match(icons, /NODE_ICON_GRADIENT_END\s*=\s*"#19a8ff"/);
  assert.match(geometry, /PROCESS_MAP_GRID_PX\s*=\s*28/);
  assert.match(geometry, /processMapFlowToRoutePoint/);
  assert.match(geometry, /processMapRoutePointToSurfaceCenter/);
  assert.match(geometry, /appendSimplifiedRenderedPoint/);
  assert.doesNotMatch(geometry, /export function processMapOrthogonalPolyline/);
  assert.doesNotMatch(styles, /vector-effect:\s*non-scaling-stroke|stroke-width:\s*2(?:\.6)?/);
  const traceStyles = styles.slice(styles.indexOf(".process-map-trace {"), styles.indexOf(".process-map-waypoint {"));
  assert.doesNotMatch(traceStyles, /filter|drop-shadow/);
  assert.match(styles, /process-map-card[\s\S]*drop-shadow/);
  assert.match(styles, /process-map-card--folder[\s\S]*border-color:\s*#ff8a00/);
  assert.match(styles, /process-map-card--process[\s\S]*border-color:\s*#19f07a/);
  assert.doesNotMatch(styles, /clip-path|process-map-card--folder[^\{]*::before/);
  assert.match(styles, /process-map-placement-tray__disclosure\s*\{[\s\S]*margin-left:\s*auto/);
  assert.match(styles, /process-map-placement-tray:not\(\.is-collapsed\)[\s\S]*transform:\s*rotate\(180deg\)/);
  assert.match(surface, /ExplorerDisclosureIcon open=\{false\}/);
  assert.match(styles, /process-map-trace__flow[\s\S]*stroke-dasharray:\s*8 20[\s\S]*animation:\s*process-map-trace-flow 1\.1s linear infinite/);
  assert.match(styles, /@keyframes process-map-trace-flow[\s\S]*stroke-dashoffset:\s*-28px/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*process-map-trace__flow[\s\S]*animation:\s*none/);
  assert.match(surface, /ReactFlowProvider key=\{layerIdentity\}/);
  assert.match(surface, /const mutationGeneration = localMutationGenerationRef\.current[\s\S]*activeLayerReadRef\.current = requestGeneration/);
  assert.match(surface, /localMutationGenerationRef\.current !== mutationGeneration/);
  assert.match(surface, /markLocalMutationCommitted[\s\S]*localMutationGenerationRef\.current \+= 1[\s\S]*layerRequestGenerationRef\.current \+= 1[\s\S]*requestRefresh\(\)/);
  assert.match(surface, /const nodeID = processMapResourceNodeID\(decision\.resource\)[\s\S]*operationGeneration[\s\S]*shouldApplyProcessMapCommit\(existing\.data\.revision, addedData\.revision\)/);
  assert.match(surface, /putProcessMapPlacement\(apiBase, companyID, decision\.resource[\s\S]*responseWasSuperseded[\s\S]*if \(responseWasSuperseded\)[\s\S]*requestRefresh\(\)/);
  assert.match(surface, /replaceTraceRoute[\s\S]*responseGeneration[\s\S]*shouldApplyProcessMapMutationAck[\s\S]*requestRefresh\(\)/);
  assert.match(surface, /handleNodeDragStop[\s\S]*operationGeneration[\s\S]*shouldApplyProcessMapMutationAck[\s\S]*requestRefresh\(\)/);
  assert.match(surface, /deleteProcessMapPlacement[\s\S]*operationGeneration[\s\S]*shouldApplyProcessMapMutationAck[\s\S]*requestRefresh\(\)/);
  assert.match(surface, /startingPoint[\s\S]*gridPoint\.x !== startingPoint\.x[\s\S]*replaceTraceRoute/);
  assert.match(surface, /const clearLayerAndRefresh = \(\) => \{[\s\S]*invalidateProcessMapLayers[\s\S]*clearLayer\(\)[\s\S]*refresh\.request\(\)/);
  assert.match(surface, /onAccepted:\s*\(\)\s*=>\s*\{[\s\S]*clearLayerAndRefresh/);
  assert.match(surface, /setPointerCapture[\s\S]*onPointerMove[\s\S]*onPointerUp[\s\S]*onPointerCancel/);
  assert.doesNotMatch(surface, /window\.addEventListener\("pointer(?:move|up|cancel)"/);
  assert.match(surface, /canonicalRefreshGenerationRef\.current !== canonicalGeneration[\s\S]*return/);
  const invalidation = api.slice(api.indexOf("export function invalidateProcessMapLayers"), api.indexOf("export async function putProcessMapPlacement"));
  assert.doesNotMatch(invalidation, /controller\.abort/);
  assert.match(surface, /shouldApplyProcessMapCommit\(existing\.data\.revision, trace\.revision\)/);
  assert.match(surface, /responseWasSuperseded[\s\S]*requestRefresh\(\)/);
  assert.match(surface, /deletedRelationshipIDsRef\.current\.has\(trace\.resource_operational_relationship_id\)[\s\S]*requestRefresh\(\)/);
  assert.match(surface, /deletedRelationshipIDsRef\.current\.add\(removed\.id\)/);
  assert.match(surface, /restricted:\$\{index\}/);
  assert.doesNotMatch(styles, /data-resource|resource-id/);
  assert.match(surface, /PROCESS_MAP_HANDLE_RADIUS_PX\s*=\s*6/);
  assert.match(surface, /physicalSourceX\s*=\s*sourceX\s*-\s*PROCESS_MAP_HANDLE_RADIUS_PX/);
  assert.match(surface, /physicalTargetX\s*=\s*targetX\s*\+\s*PROCESS_MAP_HANDLE_RADIUS_PX/);
  assert.match(styles, /process-map-handle--input[\s\S]*left:\s*0\s*!important/);
  assert.match(styles, /process-map-handle--output[\s\S]*right:\s*0\s*!important/);
  assert.match(surface, /useConnection\(\(connection\) => connection\.inProgress\)/);
  assert.match(surface, /connectionInProgress \? " is-connecting" : ""/);
  assert.match(surface, /onConnectEnd=\{\(\) => \{[\s\S]*current\?\.kind === "placement" \? null : current[\s\S]*node\.selected \? \{ \.\.\.node, selected: false \} : node/);
  assert.match(surface, /connectOnClick=\{false\}/);
  assert.match(styles, /react-flow__handle\.process-map-handle\s*\{[\s\S]*opacity:\s*0[\s\S]*pointer-events:\s*none[\s\S]*visibility:\s*hidden/);
  assert.match(styles, /process-map-card\.is-selected \.process-map-handle,[\s\S]*process-map-card\.is-connecting \.process-map-handle[\s\S]*opacity:\s*1[\s\S]*pointer-events:\s*auto[\s\S]*visibility:\s*visible/);
  assert.match(page, /layer\.ancestors\.map\(\(ancestor\)/);
  assert.match(page, /buildProcessMapRoute\(ancestor\.folder_id\)/);
  assert.match(page, /aria-label="Process Map folder path"/);
  assert.match(page, /aria-current="page"/);
  assert.match(page, /PROCESS_MAP_LINK_TARGET_TYPES\s*=\s*\["logic_gate"\] as const/);
  assert.match(page, /activeFolderLayer[\s\S]*layer\?\.kind === "folder"[\s\S]*layer\.folder_id === folderID/);
  assert.match(page, /useEffect\(\(\) => setPickerAnchor\(null\), \[folderID\]\)/);
  assert.match(page, /<UniversalLinkerControls[\s\S]*showCreateFloatingNode=\{false\}[\s\S]*Search Processes to place on this map/);
  const pickerUseStart = page.indexOf("<UniversalEntityPicker", page.indexOf("return ("));
  assert.notEqual(pickerUseStart, -1);
  const pickerUse = page.slice(pickerUseStart, page.indexOf("/>", pickerUseStart) + 2);
  assert.match(pickerUse, /linkTargetTypes=\{PROCESS_MAP_LINK_TARGET_TYPES\}/);
  assert.match(pickerUse, /initialMode="link"/);
  assert.match(pickerUse, /initialCategory="logic_gate"/);
  assert.match(pickerUse, /lockMode/);
  assert.match(pickerUse, /onEntityDragStart=\{startProcessDrag\}/);
  assert.doesNotMatch(pickerUse, /onChoose/);
  assert.match(page, /setData\(EXPLORER_DRAG_MIME, JSON\.stringify\(\{[\s\S]*kind: "logic_gate"[\s\S]*itemID: entity\.entityID[\s\S]*itemType: "logic_gate"/);
  assert.doesNotMatch(page, /company-explorer\/search|putProcessMapPlacement|setInterval|requestAnimationFrame/);
  assert.match(picker, /onEntityDragStart\?:/);
  assert.match(picker, /if \(!props\.onChoose \|\| busy\) return/);
  assert.match(picker, /pointerEvents: dragActive \? "none" : "auto"/);
  assert.match(picker, /onDragEnd=\{\(\) => setDragActive\(false\)\}/);
  assert.doesNotMatch(styles, /process-map-page__layer-name[\s\S]{0,180}text-overflow:\s*ellipsis/);
});

test("failed Process Map writes perform one bounded canonical recovery read", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  for (const message of [
    "Failed to save trace route",
    "Failed to save placement",
    "Failed to create trace",
    "Failed to delete trace",
    "Failed to remove placement",
    "Failed to add placement",
  ]) {
    const start = surface.indexOf(message);
    assert.notEqual(start, -1, message);
    assert.match(surface.slice(start, start + 220), /requestRefresh\(\)/, message);
  }
});

test("Process Map QDC cards stay canonical, private, and separate from placement gestures", () => {
  const page = source("frontend/src/pages/process-map/ProcessMapPage.tsx");
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const card = source("frontend/src/modules/process-map/ProcessMapQDCard.tsx");
  const tracker = source("frontend/src/modules/logic-gates/LogicGateQDTracker.tsx");
  const api = source("frontend/src/modules/process-map/processMapApi.ts");
  const app = source("frontend/src/app/applayout.tsx");
  const styles = source("frontend/src/modules/process-map/processMap.css");

  assert.match(page, /useState\(false\)[\s\S]*Hover mode/);
  assert.match(page, /checked=\{hoverModeEnabled\}[\s\S]*hoverModeEnabled=\{hoverModeEnabled\}/);
  assert.match(page, /onOpenLogicGate[\s\S]*<ProcessMapSurface[\s\S]*onOpenLogicGate=\{onOpenLogicGate\}/);
  assert.doesNotMatch(page, /hover-mode[^\n]*(?:localStorage|sessionStorage)/i);

  assert.match(surface, /data\.restricted[\s\S]*return[\s\S]*resourceType === "company_explorer_folder"/);
  assert.match(surface, /NodeToolbar[\s\S]*position=\{Position\.Right\}[\s\S]*offset=\{24\}/);
  assert.match(surface, /qdCardPinned[\s\S]*pinned=\{qdCardPinned\}/);
  assert.match(surface, /onNodeDragStart=\{handleNodeDragStart\}[\s\S]*onNodeDragStop=\{handleNodeDragStop\}/);
  assert.match(surface, /handleNodeDragStart[\s\S]*suppressedNodeClickRef\.current = node\.id/);
  assert.match(surface, /onConnectStart[\s\S]*suppressedNodeClickRef\.current = params\.nodeId/);
  assert.match(surface, /onNodeClick[\s\S]*suppressedNodeClickRef\.current === node\.id[\s\S]*return;[\s\S]*setPinnedProcessID/);
  assert.match(surface, /const openPlacement[\s\S]*resourceType !== "logic_gate"[\s\S]*setPinnedProcessID\(null\)[\s\S]*onOpenLogicGate\(node\.data\.resourceID, node\.data\.label\)/);
  assert.match(surface, /onNodeDoubleClick[\s\S]*openPlacement\(node\)/);
  assert.match(surface, /onKeyDownCapture[\s\S]*event\.key !== "Enter"[\s\S]*event\.key !== " "[\s\S]*openPlacement\(node\)/);
  assert.match(surface, /onPaneClick[\s\S]*setPinnedProcessID\(null\)/);

  assert.match(card, /<LogicGateQDTracker[\s\S]*variant="card"/);
  assert.match(card, /Q, C and D/);
  assert.match(styles, /\.process-map-qd-card \{[\s\S]*width: min\(560px, calc\(100vw - 48px\)\)/);
  assert.match(styles, /\.process-map-qd-card__header button[\s\S]*linear-gradient\(135deg, #ff5a6b, #ef334e\)[\s\S]*color: #ffffff/);
  assert.match(card, /readOnly=\{!pinned\}/);
  assert.match(card, /\/v1\/resources\/logic_gate\/\$\{encodeURIComponent\(logicGateID\)\}\/gvic/);
  assert.match(card, /logicGateRACIRolePresentation/);
  assert.match(card, /rated_by_display_name|LogicGateQDTracker/);
  assert.doesNotMatch(card, /getLogicGateRecordSingleFlight|canEditResourceAccess/);
  assert.doesNotMatch(card, /method:\s*"(?:POST|PUT|DELETE)"[\s\S]*gvic/);

  assert.match(tracker, /Q_LAYOUT[\s\S]*columns: 6,[\s\S]*rows: 7,[\s\S]*position: \[6, 1\][\s\S]*position: \[6, 6\]/);
  assert.match(tracker, /C_LAYOUT[\s\S]*columns: 7,[\s\S]*rows: 8,[\s\S]*position: \[8, 6\]/);
  assert.match(tracker, /D_LAYOUT[\s\S]*columns: 6,[\s\S]*rows: 7,[\s\S]*position: \[2, 6\][\s\S]*position: \[6, 6\][\s\S]*position: \[7, 5\]/);
  assert.match(tracker, /gridTemplateColumns: `repeat\(\$\{props\.layout\.columns\}, minmax\(0, 1fr\)\)`[\s\S]*gap: 1/);
  assert.match(tracker, /width: "100%"[\s\S]*height: "100%"/);
  assert.match(tracker, /document\.addEventListener\("pointerdown", dismissChoices, true\)/);
  assert.doesNotMatch(tracker, /Close rating choices/);
  assert.doesNotMatch(tracker, /overflowX: "auto"/);

  assert.match(app, /onOpenLogicGate=\{openProcessMapLogicGateOverlay\}/);
  assert.match(app, /processMapLogicGateOverlay[\s\S]*<AppModalPortal[\s\S]*role="dialog"[\s\S]*Close \$\{processMapLogicGateOverlay\.label\} Logic Gate[\s\S]*UNIFIED_NODE_SHELL_CLOSE_BUTTON_TEMPLATE_STYLE[\s\S]*<LazyLogicGateArenaPage/);
  assert.match(app, /processMapLogicGateOverlayBackdropStyle[\s\S]*padding: 6/);
  assert.match(app, /processMapLogicGateOverlayStyle[\s\S]*width: "calc\(100vw - 12px\)"[\s\S]*height: "calc\(100vh - 12px\)"/);
  assert.doesNotMatch(app, /processMapLogicGateOverlayStyle[\s\S]{0,180}min\(1500px/);

  assert.doesNotMatch(api, /qd_rating|quality_rating|cost_rating|delivery_rating|rated_by_/);
});

test("Process Map deletes traces through canonical relationships and has no trace-only DELETE", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const api = source("frontend/src/modules/process-map/processMapApi.ts");
  assert.match(surface, /selection\.kind === "trace"[\s\S]*deleteProcessMapRelationship[\s\S]*return;[\s\S]*deleteProcessMapPlacement/);
  assert.doesNotMatch(api, /export async function deleteProcessMapTrace/);
  assert.doesNotMatch(api, /\/trace\?\$\{params\}[\s\S]{0,180}method: "DELETE"/);
});

test("retired full-company Logic Gate relationship graph is absent", () => {
  assert.equal(existsSync(resolve(process.cwd(), "frontend/src/modules/logic-gates/logicGateRelationshipGraph.ts")), false);
  const frontendFiles = [
    "frontend/src/modules/editor/EditorContent.tsx",
    "frontend/src/modules/company-explorer/CompanyExplorerContent.tsx",
    "frontend/src/pages/home/HomePage.tsx",
    "frontend/src/app/committedTitleCacheReconciliation.ts",
  ];
  for (const file of frontendFiles) {
    assert.doesNotMatch(source(file), /logicGateRelationshipGraph|\/v1\/logic-gate-relationships/);
  }
});

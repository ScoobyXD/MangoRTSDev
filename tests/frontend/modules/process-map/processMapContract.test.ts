import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n?/g, "\n");
}

test("V3 Process Map is one deck.gl canvas with no layer-reader or React Flow compatibility path", () => {
  const packageJSON = JSON.parse(source("frontend/package.json")) as {
    dependencies?: Record<string, string>;
  };
  const dependencies = packageJSON.dependencies ?? {};
  for (const dependency of ["@deck.gl/core", "@deck.gl/geo-layers", "@deck.gl/layers", "@deck.gl/react"]) {
    assert.equal(typeof dependencies[dependency], "string", `${dependency} must be a direct runtime dependency`);
  }
  assert.equal(dependencies["@xyflow/react"], undefined);

  const processMapSources = [
    "frontend/src/modules/process-map/ProcessMapSurface.tsx",
    "frontend/src/modules/process-map/processMapApi.ts",
    "frontend/src/modules/process-map/processMapGeometry.ts",
    "frontend/src/modules/process-map/processMapInteraction.ts",
    "frontend/src/pages/process-map/ProcessMapPage.tsx",
    "frontend/src/app/deepLinkRoutes.ts",
    "frontend/src/app/applayout.tsx",
    "frontend/src/auth/AuthGate.tsx",
  ].map(source).join("\n");

  for (const forbidden of [
    /@xyflow\/react/,
    /\bReactFlow(?:Provider)?\b/,
    /\/v1\/process-map\/layer\b/,
    /fetchProcessMapLayer/,
    /\bProcessMapLayer(?:Query|Response|Ancestor)\b/,
    /\/process-map\/folders(?:\/|\b)/,
    /Process Map folder path/,
    /processMapFolderID/,
    /MiniMap/,
    /mapbox|maplibre|openlayers|latitude|longitude|basemap|globe/i,
  ]) {
    assert.doesNotMatch(processMapSources, forbidden);
  }

  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  assert.match(surface, /OrthographicView/);
  assert.match(surface, /TileLayer/);
  assert.doesNotMatch(surface, /\b(?:PerspectiveView|MapView|GlobeView)\b/);
});

test("Process Map tile state carries only the bounded Process card summary, not broader authorities", () => {
  const api = source("frontend/src/modules/process-map/processMapApi.ts");

  for (const field of ["score_card", "quality_rating", "cost_rating", "delivery_rating", "responsible_names", "accountable_names"]) {
    assert.match(api, new RegExp(`\\b${field}\\b`));
  }
  assert.doesNotMatch(api, /qd_rating|rated_by_|raci_assignments|picker_candidates/);
  assert.doesNotMatch(api, /export async function deleteProcessMapTrace/);
  assert.doesNotMatch(api, /method:\s*["']DELETE["'][\s\S]{0,180}\/trace/);
  assert.doesNotMatch(api, /viewport|viewState|camera|selectedResource|tileMembership/);
});

test("retired map and full-company relationship graph files remain absent", () => {
  for (const path of [
    "frontend/src/modules/logic-gates/logicGateRelationshipGraph.ts",
    "frontend/src/modules/node-map",
    "frontend/src/modules/logic-gate-map",
  ]) {
    assert.equal(existsSync(resolve(process.cwd(), path)), false, `${path} must remain absent`);
  }

  const activeSources = [
    "frontend/src/modules/editor/EditorContent.tsx",
    "frontend/src/modules/company-explorer/CompanyExplorerContent.tsx",
    "frontend/src/pages/home/HomePage.tsx",
    "frontend/src/app/committedTitleCacheReconciliation.ts",
  ].map(source).join("\n");
  assert.doesNotMatch(activeSources, /logicGateRelationshipGraph|\/v1\/logic-gate-relationships/);
});

test("V3 Surface retains placement containment, Folder resize safety, owned traces, rollback, and permission-state disposal", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");

  assert.match(surface, /pending\.values\(\)\]\.some\(\(item\) => item\.grid_width < 1 \|\| item\.grid_height < 1\)/);
  assert.match(surface, /Folder resize was restored because its contents cannot be shrunk any further/);
  assert.match(surface, /const routePoints = defaultProcessMapRoutePoints\([\s\S]{0,220}postProcessMapRelationship\(apiBase, companyID, current\.source, target, routePoints\)/);
  assert.match(surface, /shouldApplyProcessMapMutationAck/);
  assert.match(surface, /Placement was restored because it could not be saved/);
  assert.match(surface, /Company Explorer deletion was rolled back/);

  const rejectedStart = surface.indexOf("onRejected: () => {");
  const rejectedEnd = surface.indexOf("\n      },\n    });", rejectedStart);
  assert.ok(rejectedStart >= 0 && rejectedEnd > rejectedStart, "permission rejection handler must remain explicit");
  const rejected = surface.slice(rejectedStart, rejectedEnd);
  assert.match(rejected, /purgeProtectedScene\(\)/);

  const purgeStart = surface.indexOf("const purgeProtectedScene = useCallback");
  const purgeEnd = surface.indexOf("\n\n  const loadScene = useCallback", purgeStart);
  assert.ok(purgeStart >= 0 && purgeEnd > purgeStart, "protected-state disposal must remain explicit");
  const purge = surface.slice(purgeStart, purgeEnd);
  for (const required of [
    "invalidateProcessMapReadCaches(apiBase, companyID)",
    "sceneAbortRef.current?.abort()",
    "setLoadedTiles(new Map())",
    "setCommittedOverlay(emptyPresentation())",
    "setPreviewPlacements(new Map())",
    "setPreviewTraces(new Map())",
    "setRemovedTraceIDs(new Set())",
    "gestureRef.current = null",
    "setGesture(null)",
    "setSelection(null)",
    "setHoveredResizePick(null)",
    "setHoveredProcessID(null)",
    "setPinnedProcessID(null)",
    "setScene(null)",
  ]) {
    assert.ok(purge.includes(required), `permission rejection must clear protected state with ${required}`);
  }
});

test("Folder move and resize frames update only a delta over one stable subtree plan", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const startGesture = surface.slice(
    surface.indexOf("const startPlacementGesture"),
    surface.indexOf("const handleDragStart"),
  );
  assert.match(startGesture, /const subtree = processMapPlacementSubtree/);
  assert.match(startGesture, /const basePlacements = subtree/);
  assert.match(startGesture, /processMapInternalTracesForTransform/);
  assert.match(startGesture, /basePlacementKeys/);
  assert.match(startGesture, /baseTraceIDs/);

  const dragFrame = surface.slice(
    surface.indexOf("const handleDrag ="),
    surface.indexOf("const finishConnection"),
  );
  const placementDragFrame = dragFrame.slice(dragFrame.indexOf("const dx = snapProcessMapGridCoordinate"));
  assert.match(placementDragFrame, /deltaX: dx/);
  assert.match(placementDragFrame, /deltaY: dy/);
  assert.doesNotMatch(placementDragFrame, /setPreviewPlacements|setPreviewTraces|transformedTraces|materializeProcessMapPlacementTransform/);

  const dragEnd = surface.slice(
    surface.indexOf("const handleDragEnd"),
    surface.indexOf("const fitFolder"),
  );
  assert.match(dragEnd, /materializeProcessMapPlacementTransform\(current\.basePlacements, transform\)/);
  assert.match(dragEnd, /transformedTraces\(current\.baseTraces, transform\)/);
});

test("company or auth scope changes synchronously suppress protected geometry before replacement reads", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  assert.match(surface, /const protectedScopeKey = `\$\{apiBase\.trim\(\)\}\\u0000\$\{companyID\.trim\(\)\}\\u0000\$\{authGeneration\}`/);
  assert.match(surface, /const protectedScopeCurrent = protectedScope === protectedScopeKey/);
  assert.match(surface, /const activeScene = protectedScopeCurrent \? scene : null/);
  assert.match(surface, /\(\) => protectedScopeCurrent \? mergeTilePresentation\(loadedTiles\) : emptyPresentation\(\)/);
  assert.match(surface, /const presentation = useMemo\(\(\) => protectedScopeCurrent[\s\S]{0,240}: emptyPresentation\(\)/);
  assert.match(surface, /const spatialLayers = useMemo\(\(\) => activeScene \? buildProcessMapSpatialLayers/);
  assert.match(surface, /const layers = useMemo\(\(\) => activeScene && spatialLayers \? composeProcessMapLayers/);

  const purgeStart = surface.indexOf("const purgeProtectedScene = useCallback");
  const purgeEnd = surface.indexOf("\n\n  const loadScene = useCallback", purgeStart);
  assert.ok(purgeStart >= 0 && purgeEnd > purgeStart);
  const purge = surface.slice(purgeStart, purgeEnd);
  assert.ok(purge.indexOf("setProtectedScope(protectedScopeKey)") < purge.indexOf("advanceProtectedGeneration()"));
  assert.match(purge, /setScene\(null\)/);
  assert.match(purge, /setLoadedTiles\(new Map\(\)\)/);
  assert.match(purge, /setCommittedOverlay\(emptyPresentation\(\)\)/);
  assert.match(purge, /setPreviewPlacements\(new Map\(\)\)/);
  assert.match(purge, /setPreviewTraces\(new Map\(\)\)/);
  assert.match(purge, /gestureRef\.current = null/);
  assert.match(purge, /setGesture\(null\)/);
  assert.match(purge, /setHoveredResizePick\(null\)/);
});

test("same-permission mutation reconciliation keeps loaded coverage and refreshes masked tile layers", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const refreshStart = surface.indexOf("const refreshAfterMutation = useCallback");
  const refreshEnd = surface.indexOf("\n\n  const applyEnvelope", refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
  const refresh = surface.slice(refreshStart, refreshEnd);
  assert.doesNotMatch(refresh, /setLoadedTiles\(new Map\(\)\)/);
  assert.match(surface, /committedOverlay\.removedPlacementKeys/);
  assert.match(surface, /tile\.process_map_read_version === readVersion/);
  assert.match(surface, /for \(const affectedKey of removalPlacementKeys\) \{/);
  assert.match(surface, /removedPlacementKeys\.add\(affectedKey\)/);
  assert.match(surface, /new Set\(\[\.\.\.current, \.\.\.affectedTraceIDs\]\)/);
  assert.match(surface, /affectedTraceIDs\.forEach\(\(id\) => next\.delete\(id\)\)/);
});

test("name-visible hover reveals anchors and resize grips while connection drag starts synchronously", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const hoverStart = surface.indexOf("const handleHover = useCallback");
  const hoverEnd = surface.indexOf("\n\n  const removeSelection", hoverStart);
  const dragStart = surface.indexOf("const handleDragStart = useCallback");
  const dragEnd = surface.indexOf("\n\n  const handleDrag = useCallback", dragStart);
  assert.ok(hoverStart >= 0 && hoverEnd > hoverStart && dragStart >= 0 && dragEnd > dragStart);
  const hover = surface.slice(hoverStart, hoverEnd);
  const drag = surface.slice(dragStart, dragEnd);
  const gestureStart = surface.slice(surface.indexOf("const startPlacementGesture"), dragStart);
  assert.match(hover, /pick\.kind === "placement" \|\| pick\.kind === "anchor" \|\| pick\.kind === "resize"/);
  assert.match(hover, /setHoveredPlacementKey\(placementKey\(anchorPlacement\)\)/);
  assert.match(hover, /setHoveredResizePick\(pick\?\.kind === "resize" \? pick : null\)/);
  assert.match(hover, /processMapPlacementDisplayLOD\(anchorPlacement, 2 \*\* settledViewState\.zoom\) !== "whole"/);
  assert.match(gestureStart, /processMapPlacementDisplayLOD\(pick\.placement, 2 \*\* settledViewState\.zoom\) === "whole"\) return/);
  assert.doesNotMatch(gestureStart, /PROCESS_MAP_(?:NORMAL|EDITING)_LOD_MIN_PX|\b(?:24|96)\b/);
  assert.match(surface, /options\.editOverlay\.selectedPlacementKey,[\s\S]{0,120}options\.editOverlay\.hoveredPlacementKey/);
  assert.match(surface, /!options\.editOverlay\.connectionSourceKey/);
  assert.match(surface, /processMapResizeCursor\(gesture\.horizontal!, gesture\.vertical!\)/);
  assert.match(surface, /"nwse-resize" \| "nesw-resize"/);
  assert.match(surface, /getCursor=\{\(\{ isDragging, isHovering \}\) => dragSelectionActive \? "crosshair" : resizeCursor \?\?/);
  assert.match(drag, /pick\.kind === "anchor" && pick\.anchor === "output"/);
  assert.ok(drag.indexOf("gestureRef.current = next") < drag.indexOf("setGesture(next)"));
});

test("V3 Surface keeps QDC hover and pin controls plus the full Process modal entry points", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const page = source("frontend/src/pages/process-map/ProcessMapPage.tsx");
  const card = source("frontend/src/modules/process-map/ProcessMapQDCard.tsx");
  const css = source("frontend/src/modules/process-map/processMap.css");
  const app = source("frontend/src/app/applayout.tsx");
  const shell = source("frontend/src/modules/editor/UnifiedNodeShell.tsx");

  assert.match(page, /hoverModeEnabled/);
  assert.match(surface, /hoveredProcessID/);
  assert.match(surface, /pinnedProcessID/);
  assert.match(surface, /onClose=\{\(\) => \{[\s\S]{0,180}setPinnedProcessID\(null\)[\s\S]{0,180}setHoveredProcessID\(null\)/);
  assert.match(card, /\{pinned && \(/);
  assert.match(card, /onClick=\{onClose\}/);
  assert.match(card, /LogicGateQDTracker/);
  const closeRule = css.match(/\.process-map-qd-card__header button\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(closeRule, /background:\s*linear-gradient\([^)]*#ff5a6b[^)]*#ef334e/);

  const clickStart = surface.indexOf("const handleClick = useCallback");
  const clickEnd = surface.indexOf("const handleHover = useCallback", clickStart);
  assert.ok(clickStart >= 0 && clickEnd > clickStart);
  const click = surface.slice(clickStart, clickEnd);
  assert.match(click, /if \(doubleClick\)/);
  assert.match(click, /else openProcess\(pick\.placement\)/);
  const openStart = surface.indexOf("const openProcess = useCallback");
  const openEnd = surface.indexOf("const handleClick = useCallback", openStart);
  const openProcess = surface.slice(openStart, openEnd);
  assert.match(openProcess, /placement\.resource_type !== "logic_gate"/);
  assert.doesNotMatch(openProcess, /processMapPlacementDisplayLOD/);
  assert.match(openProcess, /onOpenLogicGate\(placement\.resource_id, placement\.name\)/);
  assert.match(click, /processMapPlacementDisplayLOD\(pick\.placement, 2 \*\* settledViewState\.zoom\) !== "whole"[\s\S]*setPinnedProcessID/);
  assert.match(surface, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(surface, /openProcess\(selectedPlacement\)/);
  assert.match(app, /onOpenLogicGate=\{openProcessMapLogicGateOverlay\}/);
  assert.match(app, /<AppModalPortal[\s\S]{0,1800}<LazyLogicGateArenaPage/);
  assert.match(app, /aria-modal="true"/);
  assert.match(app, /width: "calc\(100vw - 12px\)"/);
  assert.match(app, /height: "calc\(100vh - 12px\)"/);
  assert.match(app, /UNIFIED_NODE_SHELL_CLOSE_BUTTON_TEMPLATE_STYLE/);
  assert.match(app, /aria-label=\{`\$\{processMapLogicGateOverlay\.label\} Process`\}/);
  assert.match(app, /title="Close Process"/);
  const processPopup = app.slice(app.indexOf("{isProcessMapView && processMapLogicGateOverlay && ("));
  assert.match(processPopup, /onNodeOpen=\{openProcessMapNodeOverlay\}/);
  assert.match(processPopup, /onNodeClose=\{closeProcessMapNodeOverlay\}/);
  const processNodeHandlers = app.slice(app.indexOf("const openProcessMapNodeOverlay ="), app.indexOf("const openLogicGateArenaNodeRoute ="));
  assert.match(processNodeHandlers, /setProcessMapLogicGateOverlay/);
  assert.doesNotMatch(processNodeHandlers, /onNavigate|buildLogicGateRoute/);
  assert.match(shell, /background: "linear-gradient\(135deg, #ff5a6b, #ef334e\)"/);
});

test("V3 Surface keeps valid tile data through camera settlement and accepts deck cursor-anchored zoom", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const markStart = surface.indexOf("const markUnsettled = useCallback");
  const markEnd = surface.indexOf("const purgeProtectedScene = useCallback", markStart);
  const tileReadStart = surface.indexOf("const guardedGetTileData = useCallback");
  const tileReadEnd = surface.indexOf("const handleTileLoad = useCallback", tileReadStart);
  const spatialStart = surface.indexOf("const editedPlacementMembership =");
  const spatialEnd = surface.indexOf("\n\n  const layers = useMemo", spatialStart);
  const layersEnd = surface.indexOf("\n\n  const handleViewStateChange", spatialEnd);
  const viewStart = surface.indexOf("const handleViewStateChange = useCallback");
  const viewEnd = surface.indexOf("const clearHoverTimer = useCallback", viewStart);
  assert.ok(markStart >= 0 && markEnd > markStart && tileReadStart >= 0 && tileReadEnd > tileReadStart);
  assert.ok(spatialStart >= 0 && spatialEnd > spatialStart && layersEnd > spatialEnd);
  assert.ok(viewStart >= 0 && viewEnd > viewStart);
  const markUnsettled = surface.slice(markStart, markEnd);
  const guardedGetTileData = surface.slice(tileReadStart, tileReadEnd);
  const spatialLayers = surface.slice(spatialStart, spatialEnd);
  const overlayLayers = surface.slice(spatialEnd, layersEnd);
  const handleViewStateChange = surface.slice(viewStart, viewEnd);
  assert.match(markUnsettled, /settlementGateRef\.current\?\.onViewStateChange\(\)/);
  assert.doesNotMatch(markUnsettled, /setSettled\(false\)/);
  assert.match(guardedGetTileData, /if \(!currentScene \|\| request\.z < currentScene\.min_tile_zoom/);
  assert.match(guardedGetTileData, /request\.signal/);
  assert.doesNotMatch(guardedGetTileData, /settled|combineProcessMapAbortSignals/);
  assert.match(spatialLayers, /const editedPlacementMembership = useMemo\([\s\S]*?\[editedPlacementKeys\]\)/);
  assert.match(spatialLayers, /const editedTraceMembership = useMemo\([\s\S]*?\[editedTraceIDs\]\)/);
  assert.match(spatialLayers, /const spatialEditedPlacementKeys = useMemo[\s\S]*?\[editedPlacementMembership\]/);
  assert.match(spatialLayers, /const spatialEditedTraceIDs = useMemo[\s\S]*?\[editedTraceMembership\]/);
  assert.match(spatialLayers, /const spatialLayers = useMemo\(\(\) => activeScene \? buildProcessMapSpatialLayers/);
  assert.match(spatialLayers, /editedPlacementKeys: spatialEditedPlacementKeys/);
  assert.match(spatialLayers, /editedTraceIDs: spatialEditedTraceIDs/);
  assert.doesNotMatch(spatialLayers, /\b(?:presentation|editOverlay|gesture|previewPlacements|previewTraces|viewState)\b/);
  assert.match(overlayLayers, /composeProcessMapLayers\([\s\S]*?, spatialLayers\)/);
  assert.doesNotMatch(overlayLayers, /buildProcessMap(?:Spatial)?Layers/);
  assert.match(handleViewStateChange, /target: \[params\.viewState\.target\?\.\[0\]/);
  assert.match(handleViewStateChange, /viewRef\.current = proposed/);
  assert.match(handleViewStateChange, /setViewState\(proposed\)/);
  assert.match(handleViewStateChange, /settlementGateRef\.current\?\.onViewStateChange\(\)/);
  assert.doesNotMatch(handleViewStateChange, /setSettled\(false\)|centerProcessMapZoom|zoomChanged|const next/);
  assert.doesNotMatch(surface, /settledGeneration|settledReadyRef|settledAbortRef|if \(!options\.settled\) return null/);
  assert.doesNotMatch(surface, /centerProcessMapZoom/);
  assert.match(surface, /onViewStateChange=\{handleViewStateChange\}/);
  assert.match(surface, /onInteractionStateChange=\{\(state: InteractionState\) => settlementGateRef\.current\?\.onInteractionStateChange\(state\)\}/);
});

test("static XY traces remain below placements with no moving marker path", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const compose = surface.slice(
    surface.indexOf("function composeProcessMapLayers"),
    surface.indexOf("export function buildProcessMapLayers"),
  );
  const orderedLayers = [
    "spatial.background",
    "...editPlacements.backdrops",
    "editTraces.path",
    "...(spatial.tile ? [spatial.tile] : [])",
    "editTraces.waypoints",
    "...editPlacements.foreground",
  ];
  let previous = -1;
  for (const layer of orderedLayers) {
    const index = compose.indexOf(layer);
    assert.ok(index > previous, `${layer} must retain its intended visual stacking order`);
    previous = index;
  }
  assert.equal((surface.match(/positionFormat:\s*"XY"/g) ?? []).length, 6, "all six Process Map PathLayers must opt into flat XY coordinates");
  for (const removed of [
    /buildProcessMapFlowLayer/,
    /flowPhase/,
    /process-map-trace-flow-markers/,
    /prefers-reduced-motion/,
    /setInterval/,
  ]) assert.doesNotMatch(surface, removed);
});

test("automatic placement leaves no manual picker, tray, or Explorer drop path", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const page = source("frontend/src/pages/process-map/ProcessMapPage.tsx");
  const css = source("frontend/src/modules/process-map/processMap.css");
  const interaction = source("frontend/src/modules/process-map/processMapInteraction.ts");
  const geometry = source("frontend/src/modules/process-map/processMapGeometry.ts");

  const retired = `${surface}\n${page}\n${css}\n${interaction}\n${geometry}`;
  for (const forbidden of [
    /process-map-placement-tray/,
    /EXPLORER_DRAG_MIME/,
    /fetchCompanyExplorer(?:Roots|Children)/,
    /handleExternalDrop/,
    /decideProcessMapExplorerDrop/,
    /processMapTrayCandidates/,
    /processMapInitialPlacementDimensions/,
    /UniversalEntityPicker/,
    /UniversalLinkerControls/,
    /Drag to place/,
  ]) assert.doesNotMatch(retired, forbidden);
});

test("connection gestures use visible near-drop targeting and clear on camera or permission changes", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const finishStart = surface.indexOf("const finishConnection = useCallback");
  const finishEnd = surface.indexOf("const handleDragEnd = useCallback", finishStart);
  const cameraStart = surface.indexOf("const handleViewStateChange = useCallback");
  const cameraEnd = surface.indexOf("const clearHoverTimer = useCallback", cameraStart);
  assert.ok(finishStart >= 0 && finishEnd > finishStart && cameraStart >= 0 && cameraEnd > cameraStart);
  const finish = surface.slice(finishStart, finishEnd);
  const camera = surface.slice(cameraStart, cameraEnd);
  assert.doesNotMatch(finish, /pickObject/);
  assert.match(finish, /const point = pointFromInfo\(info\)/);
  assert.match(finish, /presentationRef\.current\.placements\.values\(\)/);
  assert.match(finish, /key === sourceKey \|\| processMapPlacementDisplayLOD\(placement, settledPixelsPerGridUnit\) === "whole"/);
  assert.match(finish, /const input = processMapInputAnchor\(placement\)/);
  assert.match(finish, /Math\.hypot\(input\.x - point\.x, input\.y - point\.y\) \* settledPixelsPerGridUnit/);
  assert.match(finish, /if \(distancePixels > 14\) continue/);
  assert.match(finish, /distancePixels < nearestDistancePixels/);
  assert.match(finish, /gestureRef\.current = null/);
  assert.match(finish, /setGesture\(null\)/);
  assert.match(camera, /gestureRef\.current\?\.kind === "connection"/);
  assert.match(camera, /gestureRef\.current = null/);
  assert.match(camera, /setGesture\(null\)/);
  assert.match(camera, /setSelection\(null\)/);
});

test("relationship and delete outcomes cannot mutate state after a newer canonical generation", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const connectionStart = surface.indexOf("const finishConnection = useCallback");
  const connectionEnd = surface.indexOf("const handleDragEnd = useCallback", connectionStart);
  const removeStart = surface.indexOf("const removeSelection = useCallback");
  const removeEnd = surface.indexOf("const handleKeyDown = useCallback", removeStart);
  assert.ok(connectionStart >= 0 && connectionEnd > connectionStart);
  assert.ok(removeStart >= 0 && removeEnd > removeStart);
  const connection = surface.slice(connectionStart, connectionEnd);
  const removal = surface.slice(removeStart, removeEnd);

  assert.match(connection, /const canonicalGeneration = canonicalGenerationRef\.current/);
  assert.match(connection, /const operationGeneration = nextOperation\(operationKey\)/);
  assert.ok((connection.match(/shouldApplyProcessMapMutationAck/g) ?? []).length >= 2, "connection success and failure must both reject stale outcomes");
  assert.match(removal, /deleteProcessMapRelationship/);
  assert.match(removal, /deleteProcessMapPlacement/);
  assert.ok((removal.match(/shouldApplyProcessMapMutationAck/g) ?? []).length >= 4, "both delete success and rollback paths must reject stale outcomes");
});

test("keyboard Company Explorer deletion stays explicit without a selection toolbar", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const keyStart = surface.indexOf("const handleKeyDown = useCallback");
  const keyEnd = surface.indexOf("const qdPlacement = useMemo", keyStart);
  assert.ok(keyStart >= 0 && keyEnd > keyStart);
  const keyboard = surface.slice(keyStart, keyEnd);
  assert.match(surface, /window\.confirm\(placement\.resource_type === "logic_gate"/);
  assert.match(surface, /This removes only its Company Explorer placement\. The Process and its data will remain\./);
  assert.match(surface, /Delete Company Explorer Folder [\s\S]{0,120}and its subtree\?/);
  assert.match(keyboard, /event\.key === "Delete" \|\| event\.key === "Backspace"/);
  assert.match(keyboard, /void removeSelection\(\)/);
  assert.doesNotMatch(surface, /process-map-toolbar|Company Explorer item selected|Delete from Company Explorer|Operational trace selected/);
  assert.match(surface, /Company Explorer placement removed\. The Process and its data remain\./);
  assert.match(surface, /Company Explorer Folder and its subtree were removed\./);
});

test("QDC visibility starts with the server-capped name-visible presentation", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  assert.match(surface, /const qdGeometry = qdPlacement \? processMapPlacementGeometryForTransform\(qdPlacement, placementTransform\) : null/);
  assert.match(surface, /const qdVisible = qdPlacement && qdGeometry && processMapPlacementDisplayLOD\(\{[\s\S]*?presentation: qdPlacement\.presentation,[\s\S]*?\}, 2 \*\* settledViewState\.zoom\) !== "whole"/);
});

test("light mode is scoped to the Process Map canvas and map content", () => {
  const css = source("frontend/src/modules/process-map/processMap.css");
  const page = source("frontend/src/pages/process-map/ProcessMapPage.tsx");
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const pageRule = css.match(/\.process-map-page\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const hoverModeRule = css.match(/\.process-map-page__hover-mode\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const canvasRule = css.match(/\.process-map-page__canvas\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const surfaceRule = css.match(/\.process-map-surface\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(pageRule, /grid-template-rows:\s*minmax\(0, 1fr\)/);
  assert.match(pageRule, /background:\s*#fff/);
  assert.match(canvasRule, /background:\s*#fff/);
  assert.match(surfaceRule, /background:\s*#fff/);
  assert.match(hoverModeRule, /position:\s*absolute/);
  assert.match(hoverModeRule, /top:\s*20px/);
  assert.match(hoverModeRule, /right:\s*22px/);
  assert.match(hoverModeRule, /color:\s*#475569/);
  assert.match(hoverModeRule, /background:\s*rgba\(255, 255, 255, 0\.94\)/);
  assert.doesNotMatch(page, /<header|<h1>/);
  assert.match(page, /<div className="process-map-page__canvas">[\s\S]*<ProcessMapSurface[\s\S]*<label className="process-map-page__hover-mode">/);
  assert.doesNotMatch(css, /\.process-map-page__header|\.process-map-toolbar/);
  assert.match(surface, /const COLOR_MAP_BACKGROUND:[^=]*= \[255, 255, 255, 255\]/);
  assert.match(surface, /const COLOR_TEXT:[^=]*= \[30, 41, 59, 245\]/);
  assert.match(surface, /fill: COLOR_MAP_BACKGROUND, line: COLOR_MAP_BACKGROUND/);
});

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

test("Process Map tile state does not copy relationship, QDC, RACI, picker, or camera authorities", () => {
  const api = source("frontend/src/modules/process-map/processMapApi.ts");

  assert.doesNotMatch(api, /qd_rating|quality_rating|cost_rating|delivery_rating|rated_by_|raci_assignments|picker_candidates/);
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

test("V3 Surface retains containment, owned traces, rollback, and permission-state disposal", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");

  assert.match(surface, /processMapDeepestContainingFolder\(processMapPlacementBounds\(placement\)/);
  assert.match(surface, /processMapDeepestContainingFolder\(processMapPlacementBounds\(pending\), folders\)/);
  assert.match(surface, /folderContainsItsChildren\(saved, presentationRef\.current\.placements\)/);
  assert.match(surface, /postProcessMapRelationship\(apiBase, companyID, current\.source, target, \[\]\)/);
  assert.match(surface, /shouldApplyProcessMapMutationAck/);
  assert.match(surface, /Placement was restored because it could not be saved/);
  assert.match(surface, /Placement removal was rolled back/);

  const rejectedStart = surface.indexOf("onRejected: () => {");
  const rejectedEnd = surface.indexOf("\n      },\n    });", rejectedStart);
  assert.ok(rejectedStart >= 0 && rejectedEnd > rejectedStart, "permission rejection handler must remain explicit");
  const rejected = surface.slice(rejectedStart, rejectedEnd);
  for (const required of [
    "invalidateProcessMapReadCaches(apiBase, companyID)",
    "sceneAbortRef.current?.abort()",
    "settledAbortRef.current?.abort()",
    "setLoadedTiles(new Map())",
    "setCommittedOverlay(emptyPresentation())",
    "setPreviewPlacements(new Map())",
    "setPreviewTraces(new Map())",
    "setRemovedTraceIDs(new Set())",
    "gestureRef.current = null",
    "setGesture(null)",
    "setExternalDropPoint(null)",
    "setSelection(null)",
    "setHoveredProcessID(null)",
    "setPinnedProcessID(null)",
    "setScene(null)",
  ]) {
    assert.ok(rejected.includes(required), `permission rejection must clear protected state with ${required}`);
  }
});

test("company or auth scope changes synchronously suppress protected geometry before replacement reads", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  assert.match(surface, /const knownMappedScope = `\$\{apiBase\.trim\(\)\}\\u0000\$\{companyID\.trim\(\)\}\\u0000\$\{authGeneration\}`/);
  assert.match(surface, /const protectedScopeCurrent = protectedScope === knownMappedScope/);
  assert.match(surface, /const activeScene = protectedScopeCurrent \? scene : null/);
  assert.match(surface, /\(\) => protectedScopeCurrent \? mergeTilePresentation\(loadedTiles\) : emptyPresentation\(\)/);
  assert.match(surface, /const presentation = useMemo\(\(\) => protectedScopeCurrent[\s\S]{0,240}: emptyPresentation\(\)/);
  assert.match(surface, /const spatialLayers = useMemo\(\(\) => activeScene \? buildProcessMapSpatialLayers/);
  assert.match(surface, /const layers = useMemo\(\(\) => activeScene && spatialLayers \? composeProcessMapLayers/);

  const purgeStart = surface.indexOf("if (purgeProtectedGeometry) {");
  const purgeEnd = surface.indexOf("\n    }", purgeStart);
  assert.ok(purgeStart >= 0 && purgeEnd > purgeStart);
  const purge = surface.slice(purgeStart, purgeEnd);
  assert.ok(purge.indexOf("setProtectedScope(knownMappedScope)") < purge.indexOf("advanceProtectedGeneration()"));
  assert.match(purge, /setLoadedTiles\(new Map\(\)\)/);
  assert.match(purge, /setCommittedOverlay\(emptyPresentation\(\)\)/);
  assert.match(purge, /setPreviewPlacements\(new Map\(\)\)/);
  assert.match(purge, /setPreviewTraces\(new Map\(\)\)/);
  assert.match(purge, /gestureRef\.current = null/);
  assert.match(purge, /setGesture\(null\)/);
  assert.match(purge, /setExternalDropPoint\(null\)/);
});

test("V3 Surface keeps QDC hover and pin controls plus the full Process modal entry points", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const page = source("frontend/src/pages/process-map/ProcessMapPage.tsx");
  const card = source("frontend/src/modules/process-map/ProcessMapQDCard.tsx");
  const css = source("frontend/src/modules/process-map/processMap.css");
  const app = source("frontend/src/app/applayout.tsx");

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
  assert.match(click, /processMapPlacementDisplayLOD\(pick\.placement, 2 \*\* settledViewState\.zoom\) === "editing"\) openProcess\(pick\.placement\)/);
  assert.match(surface, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(surface, /openProcess\(selectedPlacement\)/);
  assert.match(app, /onOpenLogicGate=\{openProcessMapLogicGateOverlay\}/);
  assert.match(app, /<AppModalPortal[\s\S]{0,1800}<LazyLogicGateArenaPage/);
  assert.match(app, /aria-modal="true"/);
});

test("V3 Surface keeps loaded coverage visible and accepts deck cursor-anchored zoom", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const markStart = surface.indexOf("const markUnsettled = useCallback");
  const markEnd = surface.indexOf("const loadScene = useCallback", markStart);
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
  assert.match(markUnsettled, /settledReadyRef\.current = false/);
  assert.match(markUnsettled, /settlementGateRef\.current\?\.onViewStateChange\(\)/);
  assert.doesNotMatch(markUnsettled, /setSettled\(false\)/);
  assert.match(guardedGetTileData, /if \(!settledReadyRef\.current \|\| !currentScene/);
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
  assert.match(handleViewStateChange, /settledReadyRef\.current = false/);
  assert.doesNotMatch(handleViewStateChange, /setSettled\(false\)|centerProcessMapZoom|zoomChanged|const next/);
  assert.doesNotMatch(surface, /centerProcessMapZoom/);
  assert.match(surface, /onViewStateChange=\{handleViewStateChange\}/);
  assert.match(surface, /onInteractionStateChange=\{\(state: InteractionState\) => settlementGateRef\.current\?\.onInteractionStateChange\(state\)\}/);
});

test("static XY traces remain below placements with no moving marker path", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  assert.match(surface, /return \[spatial\.background, editTraces\.path, \.\.\.\(spatial\.tile \? \[spatial\.tile\] : \[\]\), editTraces\.waypoints, \.\.\.editPlacementLayers\(options\)\]/);
  assert.equal((surface.match(/positionFormat:\s*"XY"/g) ?? []).length, 6, "all six Process Map PathLayers must opt into flat XY coordinates");
  for (const removed of [
    /buildProcessMapFlowLayer/,
    /flowPhase/,
    /process-map-trace-flow-markers/,
    /prefers-reduced-motion/,
    /setInterval/,
  ]) assert.doesNotMatch(surface, removed);
});

test("placement tray reuses Explorer identity, one unified card, and suppresses collapsed reads", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const css = source("frontend/src/modules/process-map/processMap.css");

  for (const required of [
    "ExplorerRowIcon",
    "ExplorerDisclosureIcon",
    "Root Folders",
    "Drag to place",
    "company-explorer-scroll",
    "process-map-placement-tray__card is-",
    "EXPLORER_DRAG_MIME",
  ]) assert.ok(surface.includes(required), `placement tray must retain ${required}`);
  assert.doesNotMatch(surface, /process-map-placement-tray__browse/);

  const readStart = surface.indexOf("useEffect(() => {\n    if (trayCollapsed) {");
  const readEnd = surface.indexOf("\n  }, [apiBase, companyID, trayCollapsed, trayPath]);", readStart);
  assert.ok(readStart >= 0 && readEnd > readStart, "tray branch read effect must remain explicit");
  const readEffect = surface.slice(readStart, readEnd);
  const collapsedGuardEnd = readEffect.indexOf("return undefined;");
  const firstRead = readEffect.indexOf("fetchCompanyExplorer");
  assert.ok(collapsedGuardEnd >= 0 && firstRead > collapsedGuardEnd, "collapsed tray must return before any Explorer request");
  assert.ok((readEffect.match(/setTrayRows\(\[\]\)/g) ?? []).length >= 2, "collapse and every branch load clear stale rows");

  const collapsedRule = css.match(/\.process-map-placement-tray\.is-collapsed\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const expandedDisclosureRule = css.match(/\.process-map-placement-tray:not\(\.is-collapsed\) \.process-map-placement-tray__disclosure\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(collapsedRule, /width:\s*42px/);
  assert.match(expandedDisclosureRule, /transform:\s*rotate\(180deg\)/);
  assert.match(css, /\.process-map-placement-tray__card\.is-folder\s*\{[\s\S]*?linear-gradient/);
  assert.match(css, /\.process-map-placement-tray__card\.is-process\s*\{[\s\S]*?linear-gradient/);
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
  assert.match(finish, /key === sourceKey \|\| processMapPlacementDisplayLOD\(placement, settledPixelsPerGridUnit\) !== "editing"/);
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

test("every fixed overlay owns drop events and unavailable canvas states reject placement drops", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  const overlayTags = surface.split(/\r?\n/).filter((line) => line.includes('data-process-map-fixed-overlay="true"'));
  assert.equal(overlayTags.length, 6, "tray, toolbar, QDC, loading, error, and notice overlays must all be guarded");
  for (const tag of overlayTags) {
    assert.match(tag, /onDragOver=\{guardFixedOverlayDrop\}/);
    assert.match(tag, /onDrop=\{guardFixedOverlayDrop\}/);
  }
  for (const marker of [
    "process-map-placement-tray",
    "process-map-toolbar",
    "process-map-qd-overlay",
    "process-map-loading",
    "process-map-message is-error",
    'className="process-map-message" role="status"',
  ]) {
    assert.ok(overlayTags.some((tag) => tag.includes(marker)), `missing guarded overlay ${marker}`);
  }

  const guardStart = surface.indexOf("const guardFixedOverlayDrop = useCallback");
  const guardEnd = surface.indexOf("const unavailableTrayIDs", guardStart);
  const dropStart = surface.indexOf("const handleExternalDrop = useCallback");
  const dropEnd = surface.indexOf("const guardFixedOverlayDrop", dropStart);
  assert.ok(guardStart >= 0 && guardEnd > guardStart && dropStart >= 0 && dropEnd > dropStart);
  const guard = surface.slice(guardStart, guardEnd);
  const drop = surface.slice(dropStart, dropEnd);
  assert.match(guard, /event\.preventDefault\(\)/);
  assert.match(guard, /event\.stopPropagation\(\)/);
  assert.match(guard, /setExternalDropPoint\(null\)/);
  assert.match(drop, /loading \|\| error \|\| hit\?\.closest\("\[data-process-map-fixed-overlay='true'\]"\)/);
  assert.match(drop, /setExternalDropPoint\(null\);[\s\S]{0,40}return/);
});

test("QDC visibility is capped by the server-declared placement presentation", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  assert.match(surface, /const qdVisible = qdPlacement && processMapPlacementDisplayLOD\(qdPlacement, 2 \*\* settledViewState\.zoom\) === "editing"/);
});

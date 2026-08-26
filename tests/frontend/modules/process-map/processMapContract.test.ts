import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
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
  assert.match(surface, /postProcessMapRelationship\(apiBase, companyID, current\.source, target\.placement, \[\]\)/);
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
  assert.match(surface, /const baseLayers = useMemo\(\(\) => activeScene \? buildProcessMapLayers/);

  const purgeStart = surface.indexOf("if (purgeProtectedGeometry) {");
  const purgeEnd = surface.indexOf("\n    }", purgeStart);
  assert.ok(purgeStart >= 0 && purgeEnd > purgeStart);
  const purge = surface.slice(purgeStart, purgeEnd);
  assert.ok(purge.indexOf("setProtectedScope(knownMappedScope)") < purge.indexOf("advanceProtectedGeneration()"));
  assert.match(purge, /setLoadedTiles\(new Map\(\)\)/);
  assert.match(purge, /setCommittedOverlay\(emptyPresentation\(\)\)/);
  assert.match(purge, /setPreviewPlacements\(new Map\(\)\)/);
  assert.match(purge, /setPreviewTraces\(new Map\(\)\)/);
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

test("V3 Surface explicitly keeps wheel zoom centered on the camera target", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  assert.match(surface, /const zoomChanged = Math\.abs\(proposed\.zoom - viewRef\.current\.zoom\) > Number\.EPSILON/);
  assert.match(surface, /zoomChanged\s*\?\s*centerProcessMapZoom\(viewRef\.current, proposed\)\s*:\s*proposed/);
  assert.match(surface, /onViewStateChange=\{handleViewStateChange\}/);
  assert.match(surface, /onInteractionStateChange=\{\(state: InteractionState\) => settlementGateRef\.current\?\.onInteractionStateChange\(state\)\}/);
});

test("animated flow remains below tiled placements and above the plain background", () => {
  const surface = source("frontend/src/modules/process-map/ProcessMapSurface.tsx");
  assert.match(surface, /return \[\.\.\.baseLayers\.slice\(0, 1\), flowLayer, \.\.\.baseLayers\.slice\(1\)\]/);
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

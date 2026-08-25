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
  assert.match(surface, /readExplorerDragPayload/);
  assert.match(surface, /decideProcessMapExplorerDrop/);
  assert.match(surface, /zoomOnDoubleClick=\{false\}/);
  assert.match(surface, /deleteKeyCode=\{null\}/);
  assert.doesNotMatch(surface, /MiniMap|fitView|setViewport|setInterval|company-explorer\/tree|company-explorer\/graph/);
  assert.match(surface, /onNodeDoubleClick[\s\S]*processMapFolderDrillTarget/);
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
  assert.match(surface, /ReactFlowProvider key=\{layerIdentity\}/);
  assert.match(surface, /const mutationGeneration = localMutationGenerationRef\.current[\s\S]*activeLayerReadRef\.current = requestGeneration/);
  assert.match(surface, /localMutationGenerationRef\.current !== mutationGeneration/);
  assert.match(surface, /markLocalMutationCommitted[\s\S]*localMutationGenerationRef\.current \+= 1[\s\S]*layerRequestGenerationRef\.current \+= 1[\s\S]*requestRefresh\(\)/);
  assert.match(surface, /const nodeID = resourceNodeID\(decision\.resource\)[\s\S]*operationGeneration[\s\S]*shouldApplyProcessMapCommit\(existing\.data\.revision, addedData\.revision\)/);
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
  assert.match(styles, /polygon\(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%\)/);
  assert.match(surface, /PROCESS_MAP_HANDLE_RADIUS_PX\s*=\s*6/);
  assert.match(surface, /physicalSourceX\s*=\s*sourceX\s*-\s*PROCESS_MAP_HANDLE_RADIUS_PX/);
  assert.match(surface, /physicalTargetX\s*=\s*targetX\s*\+\s*PROCESS_MAP_HANDLE_RADIUS_PX/);
  assert.match(styles, /process-map-handle--input[\s\S]*left:\s*0\s*!important/);
  assert.match(styles, /process-map-handle--output[\s\S]*right:\s*0\s*!important/);
  assert.match(page, /layer\.ancestors\.map\(\(ancestor\)/);
  assert.match(page, /buildProcessMapRoute\(ancestor\.folder_id\)/);
  assert.match(page, /aria-label="Process Map folder path"/);
  assert.match(page, /aria-current="page"/);
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

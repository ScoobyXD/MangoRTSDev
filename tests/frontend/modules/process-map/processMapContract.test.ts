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
  assert.match(surface, /onProcessMapChanged:\s*clearLayerAndRefresh[\s\S]*onRejected:\s*clearLayerAndRefresh/);
  assert.match(surface, /ReactFlowProvider key=\{layerIdentity\}/);
  assert.match(surface, /shouldApplyProcessMapCommit\(existing\.data\.revision, trace\.revision\)/);
  assert.match(surface, /canonicalRefreshGenerationRef\.current\s*!==\s*responseGeneration[\s\S]*requestRefresh\(\)/);
  assert.match(surface, /deletedRelationshipIDsRef\.current\.has\(trace\.resource_operational_relationship_id\)[\s\S]*requestRefresh\(\)/);
  assert.match(surface, /deletedRelationshipIDsRef\.current\.add\(removed\.id\)/);
  assert.match(surface, /restricted:\$\{index\}/);
  assert.doesNotMatch(styles, /data-resource|resource-id/);
  assert.match(styles, /polygon\(50% 0/);
  assert.match(styles, /process-map-handle--input[\s\S]*left:\s*0\s*!important/);
  assert.match(styles, /process-map-handle--output[\s\S]*right:\s*0\s*!important/);
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

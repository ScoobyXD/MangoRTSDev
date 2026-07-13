import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  foldCommittedEntityTitlesSince,
  publishCommittedEntityTitleUpdate,
  readCommittedEntityTitleVersion,
  resetCommittedEntityTitleRegistryForTests,
} from "../../../../frontend/src/modules/company-explorer/companyExplorerLocalEntityUpdates.js";
import {
  kanbanRealtimeCanonicalRefreshDelayMs,
  KANBAN_REALTIME_LOCAL_ECHO_COALESCE_MS,
  KANBAN_REALTIME_REFRESH_DEBOUNCE_MS,
  reconcileCommittedKanbanBoardTitles,
  reconcileCommittedKanbanCardTitles,
  reconcileCommittedKanbanLogicGateLabel,
} from "../../../../frontend/src/modules/kanban/kanbanRealtimeRefresh.js";

test("board realtime refresh waits out local mutations without dropping the pending refresh", () => {
  const now = 10_000;

  assert.equal(kanbanRealtimeCanonicalRefreshDelayMs(now, 0, 0), 0);
  assert.equal(
    kanbanRealtimeCanonicalRefreshDelayMs(now, 0, 1),
    KANBAN_REALTIME_REFRESH_DEBOUNCE_MS,
  );
  assert.equal(
    kanbanRealtimeCanonicalRefreshDelayMs(now, now - 250, 0),
    KANBAN_REALTIME_LOCAL_ECHO_COALESCE_MS - 250,
  );
  assert.equal(
    kanbanRealtimeCanonicalRefreshDelayMs(now, now - KANBAN_REALTIME_LOCAL_ECHO_COALESCE_MS, 0),
    0,
  );
});
test("Kanban async responses retain only title commits newer than their request", () => {
  resetCommittedEntityTitleRegistryForTests();
  const requestStartVersion = readCommittedEntityTitleVersion();
  const target = new EventTarget();
  publishCommittedEntityTitleUpdate({
    companyID: "company-1",
    entityType: "node",
    resourceID: "node-1",
    title: "Committed node",
  }, target);
  publishCommittedEntityTitleUpdate({
    companyID: "company-1",
    entityType: "logic_gate",
    resourceID: "gate-1",
    title: "Committed gate",
  }, target);

  const cards = [{
    company_id: "company-1",
    board_id: "logic-gate:gate-1",
    card_id: "card-1",
    column_id: "column-1",
    node_id: "node-1",
    node_title: "Stale node",
    description_snapshot: "",
    position: 1000,
    created_timestamp: "1",
    updated_timestamp: "1",
  }];
  const boards = [{
    company_id: "company-1",
    board_id: "logic-gate:gate-1",
    logic_gate_id: "gate-1",
    title: "Stale gate",
    position: 1000,
    created_timestamp: "1",
    updated_timestamp: "1",
  }];
  const reconciledCards = foldCommittedEntityTitlesSince(
    cards,
    "company-1",
    requestStartVersion,
    reconcileCommittedKanbanCardTitles,
  );
  const reconciledBoards = foldCommittedEntityTitlesSince(
    boards,
    "company-1",
    requestStartVersion,
    reconcileCommittedKanbanBoardTitles,
  );
  const reconciledLabel = foldCommittedEntityTitlesSince(
    "Stale gate",
    "company-1",
    requestStartVersion,
    (current, update) => reconcileCommittedKanbanLogicGateLabel(current, "gate-1", update),
  );
  assert.equal(reconciledCards[0]?.node_title, "Committed node");
  assert.equal(reconciledBoards[0]?.title, "Committed gate");
  assert.equal(reconciledLabel, "Committed gate");

  const laterRequestVersion = readCommittedEntityTitleVersion();
  assert.equal(foldCommittedEntityTitlesSince(cards, "company-1", laterRequestVersion, reconcileCommittedKanbanCardTitles), cards);
  resetCommittedEntityTitleRegistryForTests();
});

test("every central Kanban async title-bearing load captures and folds a title version", () => {
  const source = readFileSync("frontend/src/modules/kanban/KanbanContent.tsx", "utf8");
  const arenaLoad = source.slice(source.indexOf("const loadLogicGateArenaView"), source.indexOf("useEffect(() => () =>", source.indexOf("const loadLogicGateArenaView")));
  const boardListLoad = source.slice(source.indexOf("const refreshBoards = useCallback"), source.indexOf("const saveCurrentBoardView"));
  const boardLoadStart = source.indexOf("const refreshBoard = useCallback");
  const boardLoad = source.slice(boardLoadStart, source.indexOf("useEffect(() => {", boardLoadStart));
  for (const [name, loadSource] of [["arena", arenaLoad], ["board list", boardListLoad], ["board", boardLoad]]) {
    assert.match(loadSource, /requestStartTitleVersion = readCommittedEntityTitleVersion\(\)/, `${name} load must capture the registry version before awaiting`);
    assert.match(loadSource, /foldCommittedEntityTitlesSince\(/, `${name} load must fold later commits into its response`);
  }
  assert.match(arenaLoad, /reconcileCommittedKanbanLogicGateLabel/);
  assert.match(arenaLoad, /reconcileCommittedKanbanCardTitles/);
  assert.match(boardListLoad, /reconcileCommittedKanbanBoardTitles/);
  assert.match(boardLoad, /applyCards\(foldCommittedEntityTitlesSince\(/);
});

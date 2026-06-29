import test from "node:test";
import assert from "node:assert/strict";
import { KANBAN_COLUMN_TITLE_TEXT_TRANSFORM, KANBAN_DEFAULT_BOARD_TITLE, KANBAN_DEFAULT_COLUMN_HEIGHT_PX, KANBAN_DEFAULT_COLUMN_ITEM_COLOR, KANBAN_DEFAULT_COLUMN_WIDTH_PX, KANBAN_GROUP_FIELDS, KANBAN_ISSUE_CARD_COLOR, KANBAN_MODULE_TOP_CLEARANCE_PX, buildCardBatchReorderPlan, buildCardReorderPlan, buildColumnReorderPlan, buildKanbanCardSelectionUpdate, clampColumnHeight, clampColumnWidth, createClientUUIDv7, getKanbanBoardDisplayTitle, getKanbanCardColorRailStyle, getKanbanConditionalColor, getKanbanGroupValues, getOrderedKanbanCardIDs, groupCardsByColumn, hydrateKanbanCardsFromNodes, isKanbanBoardDropItemType, logicGateKanbanBoardID, nextCardPosition, nextColumnPosition, normalizeKanbanColumnItemColor, parseExplorerEntityDragItems, parseExplorerEntityDragPayload, parseKanbanCardDragPayload, sanitizeExplorerEntityDragPayload, shouldRefreshKanbanBoardForNodeStatusChange, sortKanbanBoards, type KanbanBoard, type KanbanCard, type KanbanColumn, type KanbanGroupField } from "../../../../frontend/src/modules/kanban/shared.js";
import { buildUniversalNestedGroups } from "../../../../frontend/src/modules/grouping/universalGrouping.js";

function card(overrides: Partial<KanbanCard>): KanbanCard {
  return {
    company_id: "c",
    board_id: "b",
    card_id: "card",
    column_id: "todo",
    node_id: "node-1",
    node_title: "card",
    description_snapshot: "",
    position: 1000,
    created_timestamp: "2026-05-01T00:00:00.000Z",
    updated_timestamp: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function column(overrides: Partial<KanbanColumn>): KanbanColumn {
  return {
    company_id: "c",
    board_id: "b",
    column_id: "todo",
    title: "Column",
    position: 1000,
    width_px: 260,
    height_px: 240,
    item_color: "#fbb152",
    created_timestamp: "2026-05-01T00:00:00.000Z",
    updated_timestamp: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function board(overrides: Partial<KanbanBoard>): KanbanBoard {
  return {
    company_id: "c",
    board_id: "board",
    title: KANBAN_DEFAULT_BOARD_TITLE,
    position: 1000,
    created_timestamp: "2026-05-01T00:00:00.000Z",
    updated_timestamp: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

test("createClientUUIDv7 emits canonical sortable UUIDv7 ids", () => {
  const uuid = createClientUUIDv7(() => 0x019e476dee56, (bytes) => {
    bytes.fill(0xaa);
    return bytes;
  });

  assert.equal(uuid, "019e476d-ee56-7aaa-aaaa-aaaaaaaaaaaa");
  assert.equal(uuid[14], "7");
  assert.match(uuid[19], /[89ab]/);
});

test("sanitizes explorer drag payloads and keeps board drops node-only", () => {
  assert.deepEqual(sanitizeExplorerEntityDragPayload({ itemType: "node", nodeID: "node-1", label: " Alpha " }), {
    itemType: "node",
    nodeID: "node-1",
    label: "Alpha",
  });
  assert.deepEqual(parseExplorerEntityDragPayload(JSON.stringify({ itemType: "node", itemID: "legacy-node", label: "" })), {
    itemType: "node",
    nodeID: "legacy-node",
    label: "legacy-node",
  });
  assert.equal(parseExplorerEntityDragPayload(JSON.stringify({ itemType: "logic_gate", itemID: "gate-1", label: "" })), null);
  assert.equal(sanitizeExplorerEntityDragPayload({ itemType: "file", itemID: "x", label: "x" }), null);
  assert.equal(isKanbanBoardDropItemType("node"), true);
  assert.equal(isKanbanBoardDropItemType("logic_gate"), false);
  assert.deepEqual(parseExplorerEntityDragItems(JSON.stringify({
    itemType: "node_batch",
    nodes: [
      { nodeID: "node-1", label: "Alpha" },
      { nodeID: "node-2", label: "Beta" },
      { nodeID: "node-1", label: "Duplicate" },
      { nodeID: "  ", label: "Invalid" },
    ],
  })), [
    { nodeID: "node-1", label: "Alpha" },
    { nodeID: "node-2", label: "Beta" },
  ]);
});

test("nextCardPosition appends inside the target column only", () => {
  const cards = [
    { column_id: "todo", position: 1000 },
    { column_id: "todo", position: 2000 },
    { column_id: "done", position: 9000 },
  ];
  assert.equal(nextCardPosition(cards, "todo"), 3000);
  assert.equal(nextCardPosition(cards, "empty"), 1000);
});

test("groupCardsByColumn sorts each column by stable board position", () => {
  const grouped = groupCardsByColumn([
    card({
      card_id: "late",
      node_id: "node-2",
      node_title: "late",
      position: 2000,
      created_timestamp: "2026-05-01T00:00:02.000Z",
      updated_timestamp: "2026-05-01T00:00:02.000Z",
    }),
    card({
      card_id: "early",
      node_id: "node-3",
      node_title: "early",
      position: 1000,
      created_timestamp: "2026-05-01T00:00:01.000Z",
      updated_timestamp: "2026-05-01T00:00:01.000Z",
    }),
  ]);
  assert.deepEqual((grouped.get("todo") ?? []).map((card) => card.card_id), ["early", "late"]);
});

test("hydrates missing card metadata from arena node metadata", () => {
  const hydrated = hydrateKanbanCardsFromNodes([
    card({ card_id: "task", node_id: "node-task", priority: null }),
  ], [
    {
      node_id: "node-task",
      priority: 2,
      due_date: "2026-06-07",
    },
  ]);

  assert.equal(hydrated[0].priority, 2);
  assert.equal(hydrated[0].due_date, "2026-06-07");
});

test("node status reconciliation detects when a visible card missed its move event", () => {
  const columns = [
    column({ column_id: "todo", title: "Todo", position: 1000 }),
    column({ column_id: "done", title: "Done", position: 2000 }),
  ];
  const cards = [
    card({ card_id: "task", node_id: "node-task", column_id: "todo", position: 1000 }),
  ];

  assert.equal(shouldRefreshKanbanBoardForNodeStatusChange({
    node: { node_id: "node-task", status: "Done" },
    columns,
    cards,
  }), true);
  assert.equal(shouldRefreshKanbanBoardForNodeStatusChange({
    node: { node_id: "node-task", status: "Todo" },
    columns,
    cards,
  }), false);
  assert.equal(shouldRefreshKanbanBoardForNodeStatusChange({
    node: { node_id: "other-node", status: "Done" },
    columns,
    cards,
  }), false);
});

test("node status reconciliation handles Issue status without guessing columns", () => {
  const columns = [column({ column_id: "todo", title: "Todo", position: 1000 })];
  const cards = [card({ card_id: "task", node_id: "node-task", column_id: "todo", is_issue: false })];

  assert.equal(shouldRefreshKanbanBoardForNodeStatusChange({
    node: { node_id: "node-task", status: "Issue" },
    columns,
    cards,
  }), true);
  assert.equal(shouldRefreshKanbanBoardForNodeStatusChange({
    node: { node_id: "node-task", status: "Issue" },
    columns,
    cards: [card({ card_id: "task", node_id: "node-task", column_id: "todo", is_issue: true })],
  }), false);
});

test("kanban grouping values use placed-by users for by-person grouping", () => {
  const userByID = new Map([["user-1", { user_id: "user-1", display_name: "Pat Lee", email: "pat@example.com" }]]);

  assert.deepEqual(getKanbanGroupValues(
    card({ placed_by_user_id: "user-1" }),
    "person",
    new Map(),
    new Map(),
    userByID,
  ), [{ key: "person:user-1", label: "Pat Lee", sortValue: "pat lee" }]);

  assert.deepEqual(getKanbanGroupValues(
    card({ placed_by_user_id: "" }),
    "person",
    new Map(),
    new Map(),
    userByID,
  ), [{ key: "person:none", label: "No person", sortValue: "", sortLast: true }]);
});

test("kanban grouping values resolve priority due date and date-added buckets", () => {
  const columns = new Map([
    ["todo", column({ column_id: "todo", title: "Todo", position: 1000 })],
    ["done", column({ column_id: "done", title: "Done", position: 2000 })],
  ]);
  const nodeByID = new Map([
    ["node-urgent", { node_id: "node-urgent", priority: 1, due_date: "2026-05-09" }],
    ["node-none", { node_id: "node-none" }],
  ]);

  assert.deepEqual(getKanbanGroupValues(card({ card_id: "urgent", node_id: "node-urgent" }), "priority", columns, nodeByID, new Map()), [
    { key: "priority:1", label: "1\u00A0\u00A0URGENT(<1hr)", sortValue: 1, sortLast: false },
  ]);
  assert.deepEqual(getKanbanGroupValues(card({ card_id: "none", node_id: "node-none" }), "due_date", columns, nodeByID, new Map()), [
    { key: "due:none", label: "No due date", sortValue: "", sortLast: true },
  ]);
  assert.deepEqual(getKanbanGroupValues(card({ card_id: "added", created_timestamp: "2026-05-01T14:35:12.000Z" }), "date_added", columns, nodeByID, new Map()), [
    { key: "date-added:2026-05-01T14:35:12.000Z", label: "2026-05-01 14:35", sortValue: Date.parse("2026-05-01T14:35:12.000Z") },
  ]);
});

test("universal nested grouping keeps kanban account duplication and no-account trailing", () => {
  const cards = [
    card({
      card_id: "shared",
      node_id: "node-shared",
      position: 1000,
      accounts: [
        { company_id: "c", account_id: "costco", name: "Costco", created_timestamp: "2026-06-01T00:00:00.000Z" },
        { company_id: "c", account_id: "tj-maxx", name: "TJ Maxx", created_timestamp: "2026-06-01T00:00:00.000Z" },
      ],
    }),
    card({ card_id: "none", node_id: "node-none", position: 2000 }),
  ];
  const groups = buildUniversalNestedGroups<KanbanCard, KanbanGroupField>(cards, [{ field: "account", direction: "asc" }], {
    rootID: "kanban:test",
    rowKey: (item) => item.card_id,
    getValues: (item, field) => getKanbanGroupValues(item, field, new Map(), new Map(), new Map()),
    sortRows: (items) => [...items].sort((left, right) => left.position - right.position),
  });

  assert.deepEqual(groups.map((group) => group.label), ["Costco", "TJ Maxx", "No account"]);
  assert.deepEqual(groups.map((group) => group.rows.map((item) => item.card_id)), [["shared"], ["shared"], ["none"]]);
});

test("card selection helper supports ranges and additive toggles across columns", () => {
  const columns = [
    column({ column_id: "left", title: "Left", position: 1000 }),
    column({ column_id: "middle", title: "Middle", position: 2000 }),
    column({ column_id: "right", title: "Right", position: 3000 }),
  ];
  const cards = [
    card({ card_id: "left-a", column_id: "left", node_id: "node-a", position: 1000 }),
    card({ card_id: "middle-a", column_id: "middle", node_id: "node-b", position: 1000 }),
    card({ card_id: "middle-b", column_id: "middle", node_id: "node-c", position: 2000 }),
    card({ card_id: "right-a", column_id: "right", node_id: "node-d", position: 1000 }),
  ];

  assert.deepEqual(getOrderedKanbanCardIDs(columns, cards), ["left-a", "middle-a", "middle-b", "right-a"]);

  const selectedFirst = buildKanbanCardSelectionUpdate({
    columns,
    cards,
    selectedCardIDs: new Set(),
    anchorCardID: "",
    clickedCardID: "left-a",
  });
  assert.deepEqual(Array.from(selectedFirst.selectedCardIDs), ["left-a"]);
  assert.equal(selectedFirst.anchorCardID, "left-a");

  const selectedRange = buildKanbanCardSelectionUpdate({
    columns,
    cards,
    selectedCardIDs: selectedFirst.selectedCardIDs,
    anchorCardID: selectedFirst.anchorCardID,
    clickedCardID: "middle-b",
    shiftKey: true,
  });
  assert.deepEqual(Array.from(selectedRange.selectedCardIDs), ["left-a", "middle-a", "middle-b"]);
  assert.equal(selectedRange.anchorCardID, "left-a");

  const toggledMiddle = buildKanbanCardSelectionUpdate({
    columns,
    cards,
    selectedCardIDs: selectedRange.selectedCardIDs,
    anchorCardID: selectedRange.anchorCardID,
    clickedCardID: "middle-a",
    additiveKey: true,
  });
  assert.deepEqual(Array.from(toggledMiddle.selectedCardIDs), ["left-a", "middle-b"]);
  assert.equal(toggledMiddle.anchorCardID, "middle-a");

  const continuousRange = buildKanbanCardSelectionUpdate({
    columns,
    cards,
    selectedCardIDs: toggledMiddle.selectedCardIDs,
    anchorCardID: toggledMiddle.anchorCardID,
    clickedCardID: "right-a",
    shiftKey: true,
  });
  assert.deepEqual(Array.from(continuousRange.selectedCardIDs), ["left-a", "middle-a", "middle-b", "right-a"]);
  assert.equal(continuousRange.anchorCardID, "middle-a");
});

test("kanban card helpers color node cards without view-query state", { skip: "Kanban card color scheme is being revised." }, () => {
  const cards = [
    card({ card_id: "beta", node_title: "Beta task", column_id: "done", position: 2000 }),
    card({ card_id: "alpha", node_title: "Alpha task", column_id: "todo", position: 1000 }),
    card({ card_id: "alpha-later", node_title: "Alpha later", column_id: "todo", position: 3000 }),
  ];

  assert.equal(getKanbanConditionalColor(cards[0], new Map([["done", "#123abc"]])), "#123abc");
  assert.equal(getKanbanConditionalColor(card({ is_issue: true }), new Map([["todo", "#123abc"]])), KANBAN_ISSUE_CARD_COLOR);
  assert.equal(normalizeKanbanColumnItemColor("not-a-color"), KANBAN_DEFAULT_COLUMN_ITEM_COLOR);
});

test("kanban board helpers keep saved board list stable and titled", () => {
  const boards = [
    board({ board_id: "later", title: "Later", position: 2000, created_timestamp: "2026-05-01T00:00:02.000Z" }),
    board({ board_id: "first", title: "First", position: 1000, created_timestamp: "2026-05-01T00:00:01.000Z" }),
    board({ board_id: "fallback", title: "  ", position: 3000 }),
  ];

  assert.deepEqual(sortKanbanBoards(boards).map((item) => item.board_id), ["first", "later", "fallback"]);
  assert.equal(getKanbanBoardDisplayTitle(boards[2]), "fallback");
  assert.equal(logicGateKanbanBoardID(" gate-1 "), "logic-gate:gate-1");
  assert.equal(getKanbanBoardDisplayTitle(board({
    board_id: "logic-gate:019e3de8-c507-7a03-a7ab-fbea8f4e1d22",
    logic_gate_id: "019e3de8-c507-7a03-a7ab-fbea8f4e1d22",
    title: "019e3de8-c507-7a03-a7ab-fbea8f4e1d22",
  })), "Logic Gate");
  assert.equal(getKanbanBoardDisplayTitle(board({
    board_id: "logic-gate:019e3de8-c507-7a03-a7ab-fbea8f4e1d22",
    logic_gate_id: "019e3de8-c507-7a03-a7ab-fbea8f4e1d22",
    title: "Quarterly Launch Review",
  })), "Quarterly Launch Review");
});

test("kanban card color rail is independent from selection border styling", { skip: "Kanban card color scheme is being revised." }, () => {
  const style = getKanbanCardColorRailStyle("#123abc");
  assert.equal(style.left, 0);
  assert.equal(style.width, 5);
  assert.equal(style.background, "#123abc");
  assert.equal(getKanbanCardColorRailStyle("bad-color").background, KANBAN_DEFAULT_COLUMN_ITEM_COLOR);
});

test("card reorder helper moves cards vertically with bounded position writes", () => {
  const cards = [
    card({ card_id: "alpha", node_id: "node-a", position: 1000 }),
    card({ card_id: "beta", node_id: "node-b", position: 2000 }),
    card({ card_id: "gamma", node_id: "node-c", position: 3000 }),
  ];
  const plan = buildCardReorderPlan(cards, "alpha", "todo", "beta", "after");
  const sorted = groupCardsByColumn(plan.cards).get("todo") ?? [];

  assert.deepEqual(sorted.map((item) => item.card_id), ["beta", "alpha", "gamma"]);
  assert.deepEqual(plan.updates, [{ cardID: "alpha", columnID: "todo", position: 2500 }]);
});

test("card batch reorder helper moves selected cards together", () => {
  const cards = [
    card({ card_id: "todo-a", node_id: "node-a", column_id: "todo", position: 1000 }),
    card({ card_id: "todo-b", node_id: "node-b", column_id: "todo", position: 2000 }),
    card({ card_id: "doing-a", node_id: "node-c", column_id: "doing", position: 1000 }),
    card({ card_id: "doing-b", node_id: "node-d", column_id: "doing", position: 2000 }),
  ];
  const payload = parseKanbanCardDragPayload(JSON.stringify({ cardID: "todo-a", cardIDs: ["todo-a", "todo-b"], sourceColumnID: "todo" }));
  assert.deepEqual(payload?.cardIDs, ["todo-a", "todo-b"]);

  const plan = buildCardBatchReorderPlan(cards, payload?.cardIDs ?? [], "doing", "doing-b", "before");
  const sorted = groupCardsByColumn(plan.cards).get("doing") ?? [];
  assert.deepEqual(sorted.map((item) => item.card_id), ["doing-a", "todo-a", "todo-b", "doing-b"]);
  assert.deepEqual(plan.updates, [
    { cardID: "todo-a", columnID: "doing", position: 1333 },
    { cardID: "todo-b", columnID: "doing", position: 1666 },
  ]);
});

test("column layout helpers keep reorder and resize writes bounded", () => {
  const columns = [
    { company_id: "c", board_id: "b", column_id: "left", title: "Left", position: 1000, width_px: 260, height_px: 240, item_color: "#fbb152", created_timestamp: "2026-05-01T00:00:01.000Z", updated_timestamp: "2026-05-01T00:00:01.000Z" },
    { company_id: "c", board_id: "b", column_id: "middle", title: "Middle", position: 2000, width_px: 260, height_px: 240, item_color: "#fea94e", created_timestamp: "2026-05-01T00:00:02.000Z", updated_timestamp: "2026-05-01T00:00:02.000Z" },
    { company_id: "c", board_id: "b", column_id: "right", title: "Right", position: 3000, width_px: 260, height_px: 240, item_color: "#fe9b46", created_timestamp: "2026-05-01T00:00:03.000Z", updated_timestamp: "2026-05-01T00:00:03.000Z" },
  ];
  const plan = buildColumnReorderPlan(columns, "left", null);
  assert.deepEqual(plan.columns.map((column) => column.column_id), ["middle", "right", "left"]);
  assert.deepEqual(plan.updates, [{ columnID: "left", position: 4000 }]);
  const afterPlan = buildColumnReorderPlan(columns, "left", "middle", "after");
  assert.deepEqual(afterPlan.columns.map((column) => column.column_id), ["middle", "left", "right"]);
  const swapPlan = buildColumnReorderPlan(columns, "left", "middle", "swap");
  assert.deepEqual(swapPlan.columns.map((column) => column.column_id), ["middle", "left", "right"]);
  assert.deepEqual(swapPlan.updates, [{ columnID: "left", position: 2000 }, { columnID: "middle", position: 1000 }]);
  assert.equal(nextColumnPosition(columns), 4000);
  assert.equal(clampColumnWidth(9999), 2000);
  assert.equal(clampColumnWidth(Number.NaN), KANBAN_DEFAULT_COLUMN_WIDTH_PX);
  assert.equal(clampColumnHeight(9999), 9999);
  assert.equal(clampColumnHeight(Number.NaN), KANBAN_DEFAULT_COLUMN_HEIGHT_PX);
});

test("kanban visual contract preserves column title casing and frame-header clearance", () => {
  assert.equal(KANBAN_COLUMN_TITLE_TEXT_TRANSFORM, "none");
  assert.ok(KANBAN_MODULE_TOP_CLEARANCE_PX >= 34);
  assert.deepEqual(KANBAN_GROUP_FIELDS.map((field) => field.value), ["person", "priority", "due_date", "date_added", "account"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  beginEditorTraceSpan,
  createEditorTraceContext,
  editorTraceInstant,
  endEditorTraceSpan,
  recordEditorDocumentStructure,
  resetEditorTraceForTests,
  restartEditorTraceForTests,
  sanitizeEditorTracePath,
  startEditorTraceForTests,
  stopEditorTraceForTests,
  traceEditorAsyncFunction,
  traceEditorFunction,
} from "../../../../frontend/src/modules/editor/editorTrace.js";

test.afterEach(() => resetEditorTraceForTests());
test("editor trace paths remove query values and stable identities", () => {
  assert.equal(sanitizeEditorTracePath("/nodes/019fb665-072e-7ef1-b7f8-49d390e48454?secret=value"), "/nodes/:resource_id");
  assert.equal(sanitizeEditorTracePath("/v1/editor-json/node/node-123/documents/text?company_id=secret"), "/v1/editor-json/node/:resource_id/documents/:document_id");
  assert.equal(
    sanitizeEditorTracePath("/logic-gates/gate-secret/nodes/node-secret"),
    "/logic-gates/:resource_id/nodes/:resource_id",
  );
});


test("editor trace exports ordered spans and content-free document shape data", async () => {
  startEditorTraceForTests();
  const context = createEditorTraceContext({ resourceType: "node", documentLabel: "Node text" });
  assert.ok(context);

  const sensitiveText = "this exact editor text must never be captured";
  const result = traceEditorFunction(context, "unit.sync", "unit", () => sensitiveText.length, {
    character_count: sensitiveText.length,
  });
  assert.equal(result, sensitiveText.length);
  await traceEditorAsyncFunction(context, "unit.async", "unit", async () => "done");
  editorTraceInstant(context, "unit.instant", "unit", {
    enabled: true,
    reason: "unit_test",
    slowest_script_function: "dispatchTransaction",
    slowest_script_path: "/assets/editor.js",
    unsafe_content: sensitiveText,
  });

  recordEditorDocumentStructure(context, {
    type: { name: "doc" },
    nodeSize: 48,
    childCount: 2,
    descendants(callback) {
      callback({ type: { name: "paragraph" }, childCount: 1 });
      callback({ type: { name: "text" }, isText: true, text: sensitiveText, marks: [] });
    },
  }, "unit_test");

  const exported = stopEditorTraceForTests();
  assert.equal(exported.trace_format, "mango-editor-trace");
  assert.equal(exported.trace_version, 1);
  assert.equal(exported.limits.dropped_events, 0);
  assert.equal(exported.open_spans.length, 0);
  assert.equal(exported.sessions.length, 1);
  assert.ok(exported.events.length > 0);
  assert.deepEqual(
    [...exported.events].sort((left, right) => left.timestamp_us - right.timestamp_us || left.sequence - right.sequence),
    exported.events,
  );

  const shape = exported.events.find((event) => event.name === "editor.document_structure.summary");
  assert.equal(shape?.data?.text_characters, sensitiveText.length);
  assert.equal(shape?.data?.text_nodes, 1);
  assert.ok(!JSON.stringify(exported).includes(sensitiveText));
  assert.equal(exported.events.find((event) => event.name === "unit.instant")?.data?.reason, "unit_test");
  assert.equal(exported.events.find((event) => event.name === "unit.instant")?.data?.slowest_script_function, "dispatchTransaction");
  assert.equal(exported.events.find((event) => event.name === "unit.instant")?.data?.slowest_script_path, "/assets/editor.js");
  assert.equal(exported.events.find((event) => event.name === "unit.instant")?.data?.unsafe_content, undefined);
  assert.equal(exported.events.filter((event) => event.name === "unit.sync" && event.phase === "begin").length, 1);
  assert.equal(exported.events.filter((event) => event.name === "unit.sync" && event.phase === "end").length, 1);
});

test("editor trace closes failed spans once and leaves unfinished spans visible", () => {
  startEditorTraceForTests();
  const context = createEditorTraceContext({ resourceType: "logic_gate", documentLabel: "Logic gate text" });
  assert.ok(context);

  assert.throws(() => traceEditorFunction(context, "unit.failure", "unit", () => {
    throw new TypeError("private failure detail");
  }), TypeError);

  const manuallyClosed = beginEditorTraceSpan(context, "unit.manual", "unit");
  endEditorTraceSpan(manuallyClosed);
  endEditorTraceSpan(manuallyClosed);
  beginEditorTraceSpan(context, "unit.unfinished", "unit");

  const exported = stopEditorTraceForTests();
  const failureEnd = exported.events.find((event) => event.name === "unit.failure" && event.phase === "end");
  assert.equal(failureEnd?.outcome, "error");
  assert.equal(failureEnd?.data?.error_name, "TypeError");
  assert.ok(!JSON.stringify(exported).includes("private failure detail"));
  assert.equal(exported.events.filter((event) => event.name === "unit.manual" && event.phase === "end").length, 1);
  assert.equal(exported.open_spans.length, 1);
  assert.equal(exported.open_spans[0]?.name, "unit.unfinished");
});

test("editor tracing is dormant unless explicitly enabled", async () => {
  resetEditorTraceForTests();
  assert.equal(createEditorTraceContext({ resourceType: "project", documentLabel: "Project text" }), null);
  assert.equal(traceEditorFunction(null, "unit.disabled_sync", "unit", () => 42), 42);
  const originalPromise = Promise.resolve("unchanged");
  const returnedPromise = traceEditorAsyncFunction(null, "unit.disabled_async", "unit", () => originalPromise);
  assert.equal(returnedPromise, originalPromise);
  assert.equal(await returnedPromise, "unchanged");
});

test("starting a new trace while recording discards the old capture and keeps recording", async () => {
  startEditorTraceForTests();
  const context = createEditorTraceContext({ resourceType: "node", documentLabel: "Node text" });
  assert.ok(context);
  editorTraceInstant(context, "unit.before_restart", "unit");
  let finishOldSpan: (() => void) | undefined;
  const oldSpan = traceEditorAsyncFunction(context, "unit.old_async_span", "unit", () => new Promise<void>((resolve) => {
    finishOldSpan = resolve;
  }));

  restartEditorTraceForTests();
  editorTraceInstant(context, "unit.after_restart", "unit");
  const newSpan = beginEditorTraceSpan(context, "unit.new_span", "unit");
  finishOldSpan?.();
  await oldSpan;
  endEditorTraceSpan(newSpan);

  const exported = stopEditorTraceForTests();
  assert.equal(exported.events.some((event) => event.name === "unit.before_restart"), false);
  assert.equal(exported.events.some((event) => event.name === "unit.old_async_span"), false);
  assert.equal(exported.events.some((event) => event.name === "unit.after_restart"), true);
  assert.equal(exported.events.filter((event) => event.name === "unit.new_span" && event.phase === "end").length, 1);
  assert.equal(exported.open_spans.length, 0);
});

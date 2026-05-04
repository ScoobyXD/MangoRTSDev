import test from "node:test";
import assert from "node:assert/strict";
import { selectCurrentEditorTextProjection } from "../../../../frontend/src/modules/editor/editorProjection.js";

test("selects the newest text-box projection for the single editor document", () => {
  const selected = selectCurrentEditorTextProjection([
    { information_id: "older", type: "Text box", information: "old text", updated_timestamp: "2026-05-04T01:00:00.000Z" },
    { information_id: "status", type: "Status", information: "open", updated_timestamp: "2026-05-04T03:00:00.000Z" },
    { information_id: "newer", type: "Text box", information: "new text", updated_timestamp: "2026-05-04T02:00:00.000Z" },
  ]);

  assert.equal(selected?.information_id, "newer");
  assert.equal(selected?.information, "new text");
});

test("does not load non-text projections into the editor document", () => {
  const selected = selectCurrentEditorTextProjection([
    { information_id: "status", type: "Status", information: "open", updated_timestamp: "2026-05-04T03:00:00.000Z" },
    { information_id: "link", type: "Hyperlink", information: "https://example.test", updated_timestamp: "2026-05-04T04:00:00.000Z" },
  ]);

  assert.equal(selected, null);
});


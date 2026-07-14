import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { messageReadStatusSignalTimestamps, messageReadStatusTitle } from "../../../../frontend/src/pages/home/homeUtils.js";

const repoRoot = process.cwd();

test("read receipt signal times are deduplicated, ordered, and locally renderable", () => {
  const status = {
    status: "likely_read" as const,
    signal_count: 4,
    signals: [
      { timestamp: "2026-07-14T18:05:00Z" },
      { timestamp: "2026-07-14T17:05:00Z" },
      { timestamp: "2026-07-14T18:05:00Z" },
    ],
    first_signal_timestamp: "2026-07-14T16:05:00Z",
    last_signal_timestamp: "2026-07-14T19:05:00Z",
  };
  assert.deepEqual(messageReadStatusSignalTimestamps(status), [
    "2026-07-14T17:05:00Z",
    "2026-07-14T18:05:00Z",
  ]);
  const title = messageReadStatusTitle(status);
  assert.match(title, /does not identify which recipient/i);
  assert.match(title, /tracking pixel/i);
});

test("read receipt chip exposes identity limits and every observed timestamp", () => {
  const source = readFileSync(resolve(repoRoot, "frontend/src/pages/home/MessageReadReceiptChip.tsx"), "utf8");
  assert.match(source, /Recipient identity unavailable/);
  assert.match(source, /timestamps\.map/);
  assert.match(source, /role="tooltip"/);
  assert.match(source, /onPointerEnter/);
  assert.match(source, /onFocus/);
});

test("unread triage cards retain the dot without an unread outer frame", () => {
  const styles = readFileSync(resolve(repoRoot, "frontend/src/pages/home/homeStyles.ts"), "utf8");
  assert.match(styles, /visibility: unread \? "visible" : "hidden"/);
  assert.doesNotMatch(styles, /HOME_MAIL_UNREAD_EDGE_FRAME/);
  assert.doesNotMatch(styles, /border: `\$\{unread \? 2 : 1\}/);
});

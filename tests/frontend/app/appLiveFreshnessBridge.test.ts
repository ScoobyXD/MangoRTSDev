import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  localTriageConversionWasApplied,
  rememberLocalTriageConversionIDs,
} from "../../../frontend/src/app/appLiveFreshnessBridgeEcho.js";

describe("AppLiveFreshnessBridge local triage conversion echo", () => {
  it("matches converted message echoes by message id and shared inbox scope", () => {
    const cache = new Map<string, number>();

    rememberLocalTriageConversionIDs(cache, [" message-1 ", "message-2", "message-1"], " shared-1 ");

    assert.equal(localTriageConversionWasApplied(cache, "message-1,message-2", "shared-1"), true);
    assert.equal(localTriageConversionWasApplied(cache, "message-1", "other-shared"), false);
    assert.equal(localTriageConversionWasApplied(cache, "message-3", "shared-1"), false);
  });

  it("keeps My Triage echoes separate from Shared Triage echoes", () => {
    const cache = new Map<string, number>();

    rememberLocalTriageConversionIDs(cache, ["message-1"]);
    rememberLocalTriageConversionIDs(cache, ["message-2"], "shared-1");

    assert.equal(localTriageConversionWasApplied(cache, "message-1"), true);
    assert.equal(localTriageConversionWasApplied(cache, "message-1", "shared-1"), false);
    assert.equal(localTriageConversionWasApplied(cache, "message-2", "shared-1"), true);
    assert.equal(localTriageConversionWasApplied(cache, "message-2"), false);
  });
});

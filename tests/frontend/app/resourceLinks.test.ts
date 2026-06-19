import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAbsoluteAppURL, buildContextualNodeRoute } from "../../../frontend/src/app/resourceLinks.js";

describe("resourceLinks", () => {
  it("builds absolute URLs from canonical app paths", () => {
    assert.equal(
      buildAbsoluteAppURL("https://app.example.com", "/nodes/node%201"),
      "https://app.example.com/nodes/node%201",
    );
    assert.equal(
      buildAbsoluteAppURL("https://app.example.com/app", "/projects/project-1"),
      "https://app.example.com/projects/project-1",
    );
  });

  it("normalizes app paths before opening resources", () => {
    assert.equal(
      buildAbsoluteAppURL("https://app.example.com", "/logic-gates/lg-1/nodes/node-1?ignored=true"),
      "https://app.example.com/logic-gates/lg-1/nodes/node-1",
    );
  });

  it("builds node routes inside the current GVIC or Logic Gate context", () => {
    assert.equal(
      buildContextualNodeRoute("node 2", "/gvic/generated"),
      "/gvic/generated/nodes/node%202",
    );
    assert.equal(
      buildContextualNodeRoute("node 2", "/logic-gates/lg-1"),
      "/logic-gates/lg-1/nodes/node%202",
    );
    assert.equal(
      buildContextualNodeRoute("node 2", "/home"),
      "/nodes/node%202",
    );
  });
});

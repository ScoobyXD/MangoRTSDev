import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAbsoluteAppURL } from "../../../frontend/src/app/resourceLinks.js";

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
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectSummary = readFileSync(
  resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"),
  "utf8",
);

test("Project timeline controls keep the required compact order and shared linker", () => {
  const controlRowIndex = projectSummary.indexOf("data-project-timeline-control-row");
  assert.ok(controlRowIndex >= 0, "Project timeline control row must be present");

  const orderedMarkers = [
    "data-project-add-text-box",
    "data-project-document-toggle",
    "data-project-email-count-toggle",
    "<AttachmentCountDropdown",
    "<UniversalLinkerControls",
  ];
  let previousIndex = controlRowIndex;
  for (const marker of orderedMarkers) {
    const markerIndex = projectSummary.indexOf(marker, previousIndex + 1);
    assert.ok(markerIndex > previousIndex, `${marker} must follow the previous Project timeline control`);
    previousIndex = markerIndex;
  }

  const linkerSource = projectSummary.slice(
    projectSummary.indexOf("<UniversalLinkerControls", controlRowIndex),
    previousIndex + 1_500,
  );
  assert.match(linkerSource, /showCreateFloatingNode=\{false\}/);
  assert.doesNotMatch(projectSummary, />\s*Attach email\s*<\/button>/);
  assert.doesNotMatch(projectSummary, /projectTimelineAddButtonStyle|projectEmailAttachButtonStyle/);
});

test("Project permanent document reuses its exact Project textbox outside the timeline", () => {
  assert.match(projectSummary, /const projectDocumentID\s*=\s*projectID\.trim\(\)/);
  assert.match(projectSummary, /const timelineBlocks\s*=/);
  assert.match(projectSummary, /blocks\.filter\(\(block\)\s*=>\s*block\.id\s*!==\s*projectDocumentID\)/);
  assert.match(projectSummary, /projectDocumentOpen/);
  assert.match(projectSummary, /projectDocumentFullscreen/);
  assert.match(projectSummary, /toggleProjectDocument/);
  assert.match(projectSummary, /data-project-document-pane/);
  assert.match(projectSummary, /data-project-document-fullscreen/);
  assert.match(projectSummary, /<dialog[\s\S]{0,300}data-project-document-pane/);
  assert.match(projectSummary, /pane\.showModal\(\)/);
  assert.match(projectSummary, /projectDocumentOpen && projectDocumentPane \? projectDocumentPane : null/);
  assert.doesNotMatch(projectSummary, /<AppModalPortal[\s\S]{0,900}\{projectDocumentPane\}/);

  const restoreStart = projectSummary.indexOf("const restoreProjectVersion");
  const restoreEnd = projectSummary.indexOf("const addTextBlock", restoreStart);
  const restoreSource = projectSummary.slice(restoreStart, restoreEnd);
  assert.match(restoreSource, /current\.id === projectDocumentID/);
  assert.match(restoreSource, /body: JSON\.stringify\(\{ title: "Project document" \}\)/);
  assert.match(restoreSource, /documentID === projectDocumentID/);
  assert.match(restoreSource, /permanent Project document cannot be restored after deletion/);
  assert.match(restoreSource, /refreshProjectAttachments\(\)/);

  assert.equal(
    (projectSummary.match(/<NodeTextBlockEditor\b/g) ?? []).length,
    2,
    "timeline and permanent-document paths must each declare one editor, without separate inline/fullscreen copies",
  );
});

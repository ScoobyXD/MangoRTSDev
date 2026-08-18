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
  assert.match(
    projectSummary,
    /gridTemplateRows: fullscreen \? "auto 38px minmax\(0, 1fr\)" : "38px minmax\(0, 1fr\)"/,
  );
  assert.match(
    projectSummary,
    /\{projectDocumentFullscreen \? \(\s*<div style=\{projectDocumentFullscreenToolbarStyle\}>\s*\{projectEditorToolbar\}\s*<\/div>\s*\) : null\}/,
  );
  assert.doesNotMatch(projectSummary, /projectDocumentFullscreenToolbarStyle\(projectDocumentFullscreen\)/);

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

  const headerStart = projectSummary.indexOf('data-project-document-header="true"');
  const headerEnd = projectSummary.indexOf("<NodeTextBlockEditor", headerStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart, "Project document must have one bounded header before its editor");
  const headerSource = projectSummary.slice(headerStart, headerEnd);
  assert.match(headerSource, /className="mango-editor-header-scroll"/);

  const orderedHeaderMarkers = [
    'data-project-document-title="true"',
    "<EditorSaveStatusIcon",
    "<EditorSavedTimestamp",
    'aria-label="Add attachment to Project document"',
  ];
  let previousHeaderIndex = -1;
  for (const marker of orderedHeaderMarkers) {
    const markerIndex = headerSource.indexOf(marker, previousHeaderIndex + 1);
    assert.ok(markerIndex > previousHeaderIndex, `${marker} must follow the previous Project document header control`);
    previousHeaderIndex = markerIndex;
  }
  assert.match(headerSource, /aria-label="Open Project document full screen"/);
  assert.match(headerSource, /data-project-document-fullscreen-close="true"/);

  const fullscreenCloseMarker = projectSummary.indexOf('data-project-document-fullscreen-close="true"', headerStart);
  const fullscreenCloseCondition = projectSummary.lastIndexOf("{projectDocumentFullscreen ?", fullscreenCloseMarker);
  const fullscreenCloseEnd = projectSummary.indexOf("</button>", fullscreenCloseMarker);
  assert.ok(
    fullscreenCloseCondition >= headerStart && fullscreenCloseEnd > fullscreenCloseMarker,
    "the Project document close control must be bounded by its fullscreen-only condition",
  );
  const fullscreenCloseSource = projectSummary.slice(fullscreenCloseCondition, fullscreenCloseEnd);
  assert.match(fullscreenCloseSource, /aria-label="Exit Project document full screen"/);
  assert.match(fullscreenCloseSource, /onClick=\{\(\) => setProjectDocumentFullscreen\(false\)\}/);
  assert.match(fullscreenCloseSource, /style=\{projectDocumentFullscreenCloseButtonStyle\}/);
  assert.doesNotMatch(fullscreenCloseSource, /closeProjectDocument/);
  assert.match(projectSummary, /const projectDocumentFullscreenCloseButtonStyle[\s\S]{0,200}UNIFIED_NODE_SHELL_CLOSE_BUTTON_TEMPLATE_STYLE/);
});

test("Project controls and editor toolbar share one header row without a Timeline title", () => {
  assert.match(projectSummary, /const projectDocumentDocked = Boolean\(projectDocumentOpen && projectDocumentBlock && !projectDocumentFullscreen\)/);
  const headingStart = projectSummary.indexOf('data-project-timeline-heading-grid="true"');
  const bodyGridStart = projectSummary.indexOf("gridTemplateColumns: projectDocumentOpen && projectDocumentPane", headingStart);
  assert.ok(headingStart >= 0 && bodyGridStart > headingStart, "the heading grid must be bounded before the document/timeline body grid");
  const headingSource = projectSummary.slice(headingStart, bodyGridStart);
  const controlsIndex = headingSource.indexOf('data-project-timeline-control-row="true"');
  const toolbarIndex = headingSource.indexOf('data-project-timeline-toolbar="true"');
  assert.ok(controlsIndex >= 0 && toolbarIndex > controlsIndex, "controls must precede the editor toolbar in one Project header row");
  assert.doesNotMatch(headingSource, /data-project-timeline-title/);
  assert.doesNotMatch(projectSummary, /const projectTimelineTitleStyle/);
  assert.match(projectSummary, /const projectTimelineHeadingGridStyle[\s\S]{0,320}`\$\{documentWidth\}px 8px 42px minmax\(0, 1fr\)`/);
  assert.match(projectSummary, /const projectTimelineHeadingGridStyle[\s\S]{0,360}: "minmax\(0, 1fr\) minmax\(0, 2fr\)"/);
  assert.match(projectSummary, /const projectTimelineHeadingGridStyle[\s\S]{0,420}gridTemplateRows: "auto"/);
  assert.match(projectSummary, /const projectTimelineControlRowStyle[\s\S]{0,240}overflowX: "auto"/);
  assert.match(projectSummary, /const projectTimelineControlRowStyle[\s\S]{0,320}gridRow: "1"/);
  assert.match(projectSummary, /const projectTimelineToolbarStyle[\s\S]{0,320}gridColumn: documentDocked \? "4" : "2"[\s\S]{0,80}gridRow: "1"/);
  assert.match(projectSummary, /const projectDocumentPaneHeaderContentStyle[\s\S]{0,220}width: "100%"[\s\S]{0,120}minWidth: 0[\s\S]{0,160}gridTemplateColumns: "max-content minmax\(0, 1fr\) 30px"/);
  assert.match(projectSummary, /const projectDocumentPaneHeaderStyle[\s\S]{0,260}background: PROJECT_TEXTBOX_HEADER_BACKGROUND/);
});

test("Project opens its permanent document instead of its email column by default", () => {
  const projectChangeStart = projectSummary.indexOf("if (paneProjectIDRef.current !== cleanProjectID)");
  const projectChangeEnd = projectSummary.indexOf("} else {", projectChangeStart);
  assert.ok(projectChangeStart >= 0 && projectChangeEnd > projectChangeStart, "new-Project pane defaults must have a bounded branch");
  const projectChangeSource = projectSummary.slice(projectChangeStart, projectChangeEnd);
  assert.match(projectChangeSource, /setProjectDocumentOpen\(true\)/);
  assert.match(projectChangeSource, /setOpenEmailBlockIDs\(new Set\(\)\)/);
  assert.doesNotMatch(projectChangeSource, /new Set\(\[PROJECT_EMAIL_COLUMN_LAYOUT_ID\]\)/);
  assert.match(projectSummary, /const ensureProjectDocument = useCallback/);
  assert.match(projectSummary, /!projectDocumentOpen[\s\S]{0,180}ensureProjectDocument\(\)/);

  const emailToggleStart = projectSummary.indexOf("const toggleProjectEmailColumn = useCallback");
  const emailToggleEnd = projectSummary.indexOf("const stageProjectEmailSelectionChatTextBlock", emailToggleStart);
  const emailToggleSource = projectSummary.slice(emailToggleStart, emailToggleEnd);
  assert.match(emailToggleSource, /closeProjectDocument\(\)/);
  assert.match(emailToggleSource, /toggleSetValue\(current, PROJECT_EMAIL_COLUMN_LAYOUT_ID\)/);
});

test("Project text boxes load exact server relationships but ordinary document saves never write server-owned colors", () => {
  const projectionParser = projectSummary.slice(
    projectSummary.indexOf("function blockDraftsFromProjections"),
    projectSummary.indexOf("function ProjectDocumentIcon"),
  );
  assert.match(projectionParser, /linkedEmailMessageIDs: content\.linkedEmailMessageIDs/);
  assert.match(projectionParser, /color: content\.color/);

  const saveConfiguration = projectSummary.slice(
    projectSummary.indexOf("projectTextBlockSaveController.configure"),
    projectSummary.indexOf("const updateProjectTextBlockContent"),
  );
  assert.match(saveConfiguration, /body: JSON\.stringify\(\{ title: content\.title, attachments: content\.attachments \?\? \[\] \}\)/);
  assert.doesNotMatch(saveConfiguration, /\bcolor\b|linkedEmailMessageIDs|email_message_ids/);

  const loadedContentState = projectSummary.slice(
    projectSummary.indexOf("projectTextBlockContentRef.current = new Map"),
    projectSummary.indexOf("setBlocks\(nextBlocks\)"),
  );
  assert.match(loadedContentState, /\{ title: block\.title, document: block\.document, attachments: block\.attachments \}/);
  assert.doesNotMatch(loadedContentState, /\bcolor\b|linkedEmailMessageIDs/);
});

test("Project email actions use one wide attachment path and one exact internal-message textbox path", () => {
  const wideAttach = projectSummary.slice(
    projectSummary.indexOf("const attachEmailToProject = useCallback"),
    projectSummary.indexOf("const linkEmailToProject = useCallback"),
  );
  assert.match(wideAttach, /buildEditorAttachedEmailPayload\(\{ \.\.\.payload, linkWholeThread: true \}\)/);
  assert.doesNotMatch(wideAttach, /block_id|email_message_id|textbox_color/);

  const exactLink = projectSummary.slice(
    projectSummary.indexOf("const linkEmailMessageToProjectTextBlock = useCallback"),
    projectSummary.indexOf("const createProjectEmailTextBlock = useCallback"),
  );
  assert.match(exactLink, /cleanBlockID === projectDocumentID/);
  assert.match(exactLink, /textBoxHasLinkedEmailMessage\(block, cleanMessageID\)/);
  assert.match(exactLink, /email_message_id: cleanMessageID/);
  assert.match(exactLink, /textbox_color: color/);
  assert.match(exactLink, /link_scope: "message"/);
  assert.match(exactLink, /await loadProject\(\{ showLoading: false \}\);\s*focusProjectEmailTextBlock\(cleanBlockID, color\)/);
  assert.doesNotMatch(exactLink, /await loadProject\(\{ showLoading: false \}\);\s*revealProjectEmailTextBlock\(cleanMessageID\)/);
  assert.doesNotMatch(exactLink, /(?:^|\n)\s*(?:message_id|thread_id|email_thread_id):/);

  const explicitFocus = projectSummary.slice(
    projectSummary.indexOf("const focusProjectEmailTextBlock = useCallback"),
    projectSummary.indexOf("const linkEmailMessageToProjectTextBlock = useCallback"),
  );
  assert.match(explicitFocus, /element\.dataset\.projectTextBoxRow === cleanBlockID/);
  assert.match(explicitFocus, /focusProjectEmailTextBlock\(block\.id, block\.color\)/);

  const createExactTextBox = projectSummary.slice(
    projectSummary.indexOf("const createProjectEmailTextBlock = useCallback"),
    projectSummary.indexOf("const removeAttachedEmail = useCallback"),
  );
  assert.match(createExactTextBox, /attachedEmails\.find\(\(email\) => email\.emailMessageID === cleanMessageID\)/);
  assert.doesNotMatch(createExactTextBox, /projectAttachedEmails\[0\]/);
  assert.match(createExactTextBox, /sourceEmail\?\.subject\.trim\(\) \? `Email: \$\{sourceEmail\.subject\.trim\(\)\}` : "Email text box"/);
  assert.match(createExactTextBox, /createEmailSelectionDocument\(document, quote\.trim\(\)\)/);
  assert.match(createExactTextBox, /stagedEmailMessageID: undefined, color: undefined/);

  assert.doesNotMatch(projectSummary, /linkEmailFromEditor|attachEmailToBlock|emailPicker\.blockID/);
  assert.match(projectSummary, /linkTargetTypes=\{\["node", "email_message"\]\}/);
});

test("Project saved versions contain document state only", () => {
  const savedVersionDTO = projectSummary.slice(
    projectSummary.indexOf("type ProjectSavedVersionBlockDTO"),
    projectSummary.indexOf("type ProjectSavedVersion ="),
  );
  for (const field of ["id", "title", "document", "attachments", "createdTimestamp", "updatedTimestamp"]) {
    assert.match(savedVersionDTO, new RegExp(`\\b${field}:`));
  }
  assert.doesNotMatch(savedVersionDTO, /linkedEmailMessageIDs|stagedEmailMessageID|temporaryEmailChat|\bcolor\b/);

  const versionCreation = projectSummary.slice(
    projectSummary.indexOf("const createProjectVersion = useCallback"),
    projectSummary.indexOf("const saveProjectVersion = useCallback"),
  );
  assert.match(versionCreation, /const snapshotBlocks: ProjectSavedVersionBlockDTO\[\]/);
  assert.match(versionCreation, /id: block\.id/);
  assert.match(versionCreation, /createdTimestamp: block\.createdTimestamp/);
  assert.doesNotMatch(versionCreation, /\.\.\.block|linkedEmailMessageIDs|stagedEmailMessageID|temporaryEmailChat|\bcolor\b/);
});

test("Project textbox deletion delegates child cleanup to the atomic document delete", () => {
  const deletion = projectSummary.slice(
    projectSummary.indexOf("const removeTextBlock = useCallback"),
    projectSummary.indexOf("const addTextBlockAttachments = useCallback"),
  );
  assert.match(deletion, /document DELETE is the sole owner command/);
  assert.equal((deletion.match(/method: "DELETE"/g) ?? []).length, 1);
  assert.doesNotMatch(deletion, /relatedProjectionIDs|deleteProjectProjection|Promise\.all/);
});

test("Project email-chat focus has only one active textbox", () => {
  const activeFocus = projectSummary.slice(
    projectSummary.indexOf("const activeProjectEmailChatMessage = useMemo"),
    projectSummary.indexOf("const projectFileAttachments = useMemo"),
  );
  assert.match(activeFocus, /Object\.entries\(activeChatMessageIDs\)/);
  assert.match(activeFocus, /message\.blockID === blockID && message\.id === messageID/);
  assert.match(projectSummary, /setActiveChatMessageIDs\(\{ \[block\.id\]: chatMessage\.id \}\)/);
  assert.match(projectSummary, /setActiveChatMessageIDs\(\{ \[block\.id\]: messageID \}\)/);
  assert.match(projectSummary, /onActivateMessage=\{\(messageID\) => setActiveChatMessageIDs\(\(current\) => current\[block\.id\] === messageID \? \{\} : \{ \[block\.id\]: messageID \}\)\}/);
});

test("Project highlighted-email chat moves one composer and commits its textbox link atomically", () => {
  const destinationMove = projectSummary.slice(
    projectSummary.indexOf("const chooseProjectEmailChatDestination = useCallback"),
    projectSummary.indexOf("const removeTextBlock = useCallback"),
  );
  assert.match(destinationMove, /This text box already has an unsent chat draft/);
  assert.equal((destinationMove.match(/moveEmailChatComposerEntry/g) ?? []).length, 6, "existing and new textbox destinations must each move draft text, entities, and attachments");
  assert.match(destinationMove, /const anchor = \{ \.\.\.pendingProjectEmailChatSelection, blockID/);
  assert.match(destinationMove, /setPendingProjectEmailChatSelection\(anchor\)/);
  assert.match(destinationMove, /if \(event\.key === "Escape"\) clearProjectEmailSelectionChat\(projectEmailChatDestinationBlockID\)/);

  const chatSubmit = projectSummary.slice(
    projectSummary.indexOf("const submitChatMessage = useCallback"),
    projectSummary.indexOf("const deleteChatMessage = useCallback"),
  );
  assert.match(chatSubmit, /ensureEmailTextBoxLinkOnSend = selection\?\.source === "email"/);
  assert.match(chatSubmit, /ensureEmailTextBoxLinkOnSend,/);
  assert.match(chatSubmit, /emailTextBoxColorOnSend,/);
  assert.equal((chatSubmit.match(/await addProjectInformation\(/g) ?? []).length, 1, "one Project chat command must create the chat and exact textbox relationship together");
  assert.doesNotMatch(chatSubmit, /saveLatestContent|startLatestContentSave/);

  assert.match(projectSummary, /data-project-email-chat-parent-destination="true"/);
  assert.match(projectSummary, /data-email-chat-destination-candidate=\{pendingProjectEmailChatSelection && !block\.temporaryEmailChat/);
  const projectRowStart = projectSummary.indexOf("data-project-text-box-row={block.id}");
  const projectHeaderStart = projectSummary.indexOf('className="mango-editor-header-scroll"', projectRowStart);
  assert.ok(projectHeaderStart > projectRowStart);
  assert.equal(
    projectSummary.slice(projectRowStart, projectHeaderStart).includes("onClickCapture"),
    false,
    "the whole Project row must not steal a highlighted-email destination click",
  );
});

test("shared editor and triage contracts are no longer owned by Node or Home page files", () => {
  assert.match(projectSummary, /from "\.\.\/editor\/email\/emailTextBoxRelationships\.js"/);
  assert.match(projectSummary, /from "\.\.\/triage\/triageDragDrop\.js"/);
  assert.match(projectSummary, /from "\.\.\/triage\/triageEvents\.js"/);
  assert.doesNotMatch(projectSummary, /pages\/home\/(homeConstants|homeUtils)/);
});

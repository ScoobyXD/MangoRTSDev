## Initial discussion context

Yes—the HTTP storm is real and should be fixed. But it is not the primary reason the entire app remains slow. The sustained freeze is browser main-thread overload from mounting and repeatedly processing the complete node, every text box, and every chat message.
Ranked diagnosis
Confirmed: the complete node and chat history are mounted eagerly
The large-node trace contains 12 text documents. All 12 are rendered through one blocks.map, and every block containing messages automatically opens its chat pane:
[NodeWorkspaceSurface.tsx (line 2652)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurface.tsx:2652) mounts every block.
[NodeWorkspaceSurface.tsx (line 2658)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurface.tsx:2658) makes chats with messages visible by default.
[NodeWorkspaceSurfaceParts.tsx (line 2071)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:2071) maps every chat thread.
[NodeWorkspaceSurfaceParts.tsx (line 2447)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:2447) renders each message, mentions, links, attachment UI, shadows, and controls.
[NodeWorkspaceSurfaceParts.tsx (line 2575)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:2575) recursively mounts all replies.
There is no virtualization, content-visibility, or CSS containment anywhere in these node surfaces.
That means DOM and rendering cost is approximately proportional to:
all text HTML + all blocks + all messages + all mention/link spans + all attachments
The entire tab shares one JavaScript and rendering thread. When Chrome is reconciling, laying out, painting, or garbage-collecting that subtree, Explorer hover effects cannot run. This is the strongest explanation for the whole-app symptom.
Confirmed: highlighting and editor input still perform document-scale DOM work
Highlight reconstruction is exceptionally expensive:
[NodeWorkspaceSurfaceParts.tsx (line 358)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:358) searches through text nodes to locate each stored offset.
During that search, [line 366 (line 366)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:366) repeatedly calls getSelectionPointDocumentOffset.
[Lines 422–430 (line 422)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:422) clone the document prefix and reconstruct its text for each examined boundary.
[Lines 436–480 (line 436)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:436) repeat this for every chat anchor and call Range.getClientRects(), forcing layout.
Worst case, offset reconstruction approaches quadratic work in the number of text nodes, multiplied by the number of comment/change ranges.
Inner-editor scrolling is wired directly into this:
[useEditorDocumentSurfaceHandlers.ts (line 5279)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:5279) updates React state on every scroll event.
[NodeWorkspaceSurfaceParts.tsx (line 894)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:894) then schedules highlight reconstruction.
A ResizeObserver also rebuilds highlights at [lines 879–892 (line 879)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:879).
Ordinary editor keystrokes still do substantial work before batching:
[useEditorDocumentSurfaceHandlers.ts (line 5084)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:5084) refreshes selection formatting and mention state on every input.
[Lines 2990–3003 (line 2990)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:2990) convert everything from the document start to the caret into a string to look for a mention, with geometry reads when one is found.
[Lines 3280–3300 (line 3280)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:3280) perform computed-style and command-state reads.
[Lines 854–857 (line 854)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:854) query the document for selected table cells.
So the previous optimization removed some full serialization, but not all per-character document traversal and style work.
Confirmed: one chat character rerenders the large shared node subtree
The chat draft is owned by NodeWorkspaceSurface beside all blocks, messages, attachments, and pane state at [NodeWorkspaceSurface.tsx (line 397)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurface.tsx:397).
Every composer character calls the parent setter at [line 3043 (line 3043)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurface.tsx:3043). None of NodeWorkspaceSurface, NodeTextBlockEditor, ChatPane, or ChatThreadItem is memoized.
Therefore one character reruns:
The complete blocks.map.
Every mounted editor component.
Every visible chat pane.
Every recursive message component.
Mention and link splitting for message text.
Inline style-object creation and React reconciliation.
The composer also resets its height and reads scrollHeight after every draft update at [NodeWorkspaceSurfaceParts.tsx (line 1772)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:1772) and [line 1803 (line 1803)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:1803).
This is why chat typing remained slow: the batching change did not touch chat at all.
Confirmed: opening creates an excessive network and recovery burst
From the [attached large-node trace](/C:/Users/Jonat/.codex/attachments/1efbc529-10e8-4b0f-9d97-df4ad8c4112e/pasted-text.txt):
84 HTTP exchanges in approximately four seconds.
60 were node collaboration traffic.
12 unique text documents.
Each document generated one preflight plus four 304 snapshot reads.
48 collaboration GETs averaged 219.5 ms server time.
24 editor subscription acceptances: two per unique editor scope.
1,049,276 response bytes overall.
One Logic Gate view supplied 1,040,360 bytes by itself.
Four attachment-content reads.
Why this happens:
Every text box starts its frontend-backend textbox sync at [useEditorTextboxSync.ts (line 35)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/useEditorTextboxSync.ts:35).
Starting it immediately subscribes and initiates recovery at [editorTextboxSync.ts (line 387)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/editorTextboxSync.ts:387).
Every recovery unconditionally requests an initial snapshot and then a second “final” snapshot at [lines 509–537 (line 509)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/editorTextboxSync.ts:509), even with no pending edits.
Realtime connection recovery invokes every subscription’s recovery again at [realtimeWebSocket.ts (line 764)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/realtime/realtimeWebSocket.ts:764).
React Strict Mode is enabled at [main.tsx (line 9)](/C:/Users/Jonat/MangoRTSDev/frontend/src/main.tsx:9), explaining duplicated subscription lifecycles in development.
A 304 still performs authorization and loads the complete collaboration snapshot before checking its ETag at [editor_collaboration_handlers.go (line 30)](/C:/Users/Jonat/MangoRTSDev/backend/internal/http/editor_collaboration_handlers.go:30) and [line 71 (line 71)](/C:/Users/Jonat/MangoRTSDev/backend/internal/http/editor_collaboration_handlers.go:71).
That snapshot opens a repeatable-read transaction and reads canonical HTML at [postgres_editor_collaboration.go (line 48)](/C:/Users/Jonat/MangoRTSDev/backend/internal/store/postgres_editor_collaboration.go:48).
The OPTIONS requests are CORS preflights. They are noisy, but the server already caches them for 600 seconds. They are not the main freeze.
The 1 MB Logic Gate response is more concerning: it must be transferred, parsed, allocated, and applied while the node is mounting. The current Logic Gate record store uses an unconditional JSON request at [LogicGateRecordStore.ts (line 72)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/logic-gate-map/LogicGateRecordStore.ts:72), unlike the ETag-aware node store.
This network work meaningfully worsens the opening period, but the supplied log ends at 23:25:56. It cannot explain continuing hover starvation after that without the frontend work above.
Confirmed contributor, but probably not primary here: image hydration
Every editor scans all image frames at [editorImages.ts (line 469)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/editorImages.ts:469). Viewport loading starts reasonably, but after five seconds the watchdog schedules every remaining image at [lines 577–579 (line 577)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/editorImages.ts:577). Failed display variants retry using originals at [line 507 (line 507)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/editorImages.ts:507).
Your trace only shows four image requests, so images are not the leading cause for this particular node. They still increase decoded-image memory, layout, and paint pressure.
Why the previous batching felt ineffective
The batch flushes after 160 ms idle or 500 ms maximum at [editorInputBatch.ts (line 3)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/editorInputBatch.ts:3).
At five characters per second, characters arrive about 200 ms apart—so the 160 ms timer can still flush once per character. During faster typing, the 500 ms maximum still runs full text extraction and serialization twice per second at [useEditorDocumentSurfaceHandlers.ts (line 2836)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:2836).
It improved one path, but it did not address the dominant open-time, chat, DOM, highlight, and paint costs.
What is ruled out
Chat composer typing does not make HTTP requests. Its request occurs only on submit at [NodeWorkspaceSurface.tsx (line 1514)](/C:/Users/Jonat/MangoRTSDev/frontend/src/modules/editor/NodeWorkspaceSurface.tsx:1514).
Ordinary outer-node and chat scrolling do not intentionally make requests.
Waiting on asynchronous HTTP alone cannot suppress CSS hover effects after the requests finish.
The snapshot/serialization path was not the only cause.
Removing Strict Mode would reduce development-only duplicate effects, but it would not solve production responsiveness.
Recommended order of fixes
Virtualize node rows and chat messages. Offscreen blocks should use height-preserving placeholders and should not initialize editors, highlight engines, image hydration, chats, or collaboration subscriptions. Keep focused/dirty blocks pinned.

Isolate chat composer state. Move drafts into the individual ChatPane or a keyed external store, then memoize the block row, editor, chat pane, and message components with stable callbacks.

Replace highlight rescanning with a text-node offset index rebuilt once per document mutation. Resolve offsets by binary search, calculate geometry only for visible annotations, and throttle scrolling to one animation-frame update.

Fix collaboration recovery fan-out: remove the unconditional second snapshot when nothing was drained, coalesce initial and realtime recovery, share in-flight snapshot reads, and subscribe only mounted/nearby editors.

Make Logic Gate view caching ETag-aware and determine why opening a child node forces a fresh 1 MB parent response.

Rework remaining per-input work: inspect only the current text run for mentions, stop reading toolbar formatting on every character, and skip table queries unless a table selection actually exists. Increase the batch idle period enough to span normal typing cadence.

A Chrome Performance recording is still needed to assign exact percentages. The decisive trace would record opening this node and then hovering Explorer after network becomes idle, looking specifically for React commits, buildTextHighlightRects, readRichTextMentionDraft, style recalculation, layout, paint, and garbage collection.
No repository files were changed. Current checkout remains clean at main, HEAD 23daff26b7f9f4ad69624eeb0b5746f797030dc5.

-----------------------------------------------------------------------

Your reaction is fair. There is much more machinery running than “load the text and display it,” and several pieces are running at the worst possible frequency.
How I knew there were 12 text boxes
I did not know the node’s human-readable name. The attached log identified it by UUID:
019f055e-c842-799b-83c9-f6adcd2375cb
The collaboration URLs have this structure:
/editor-collaboration/node/{node ID}/documents/{document ID}
I grouped those requests by unique document ID under that node and found 12 unique IDs. The code passes each text box’s blockID as its collaboration documentID, so those 12 unique document scopes correspond to 12 mounted text-box editors.
The 24 editor subscription acceptances were those same 12 scopes accepted twice. I should have explained that derivation instead of simply stating “12.”
What “mounting” means
There are three different stages:
Fetching: the data arrives from the backend and exists in JavaScript memory.
Mounting: React creates actual browser elements, state, effects, observers, listeners, editor controllers, chat components, and image loaders for that data.
Painting: Chrome calculates where those elements go and draws them.
You can fetch 10,000 messages without mounting 10,000 message elements.
For example:
Loaded data:       10,000 messages in an array
Mounted normally:  10,000 message <div> elements
Virtualized:       10,000 messages loaded, but only ~30 elements mounted
That distinction fits exactly with what you want: we can leave fetching alone for now, load everything at once, but stop turning everything into live browser UI simultaneously.
What modern apps normally do
For large repeating interfaces, the standard solution is windowing or virtualization.
The browser mounts:
What is currently visible.
A small amount above and below the visible area.
Any focused or actively edited item that must remain alive.
Everything else is represented by empty spacers with remembered heights. As you scroll, rows enter and leave the mounted window.
For this node, the normal architecture would be:
All node data loaded in memory
          ↓
Virtualized block list
          ↓
Only visible text-box rows mounted
          ↓
Inside an open chat, only visible messages mounted
A good implementation would keep the active/focused text box mounted even if it is barely outside the viewport, so editing state and caret position are never destroyed.
Other standard techniques support virtualization:
State isolation: typing in one composer updates only that composer.
Memoization: unchanged rows do not rerun their React component code.
Containment: tell Chrome that layout or painting inside one block cannot affect the entire page.
content-visibility: let Chrome skip most layout and paint for offscreen content. This is easier but weaker than real virtualization because the components and DOM still exist.
Incremental calculations: update only the part that changed instead of rescanning the full document.
Frame throttling: scroll work runs at most once per animation frame, not once for every raw scroll event.
The large-list part of this is absolutely an old, solved problem. Rich collaborative editing is more complicated, but it also has established patterns: use a document model with positions, transactions, and visual decorations instead of repeatedly interrogating raw HTML.
What React “reconciliation” means
React components return descriptions of what the UI should look like.
When state changes, React calls the affected component functions again, creates a new description, compares it with the previous description, and updates the real browser elements that differ. That comparison is reconciliation.
In the current structure, the chat draft lives high up in the node component. Typing one character changes that high-level state, so React calls the node workspace again. That code loops over every block and recreates the component descriptions for every editor and chat.
It does not necessarily delete and recreate every real DOM element. But it still:
Reruns the complete block loop.
Reruns every non-memoized block component.
Reruns every visible chat pane.
Reruns every visible message component recursively.
Re-splits message text into mentions and links.
Builds thousands of new JavaScript objects describing styles and elements.
Compares that output with the existing DOM.
That is what I meant by “one chat character rerenders the large shared node subtree.”
The proper design is for the composer to own its draft locally. Typing should rerender approximately this:
Chat composer
└── textarea
It should not rerender this:
Entire node
├── every text box
├── every editor wrapper
├── every chat pane
├── every message
├── every mention
├── every link
└── every attachment
What highlight reconstruction means
Your intuition about HTML tags is reasonable. A simple static highlight can be:
Normal text <mark>highlighted text</mark> normal text
But MangoRTS does not currently store comment highlights as tags inside the document HTML. A comment stores separate metadata resembling:
Quote: "the selected sentence"
Start offset: 12,430
End offset: 12,451
Comment ID: ...
When the editor opens, the browser gives us newly created DOM nodes:
<p>
  Some text
  <strong>more text</strong>
  <span>@mention</span>
</p>
The code must determine where character 12,430 lives in that nested DOM. It might mean:
Text node #387, character position 14
That conversion from a plain character number back to a DOM node and position is what I called offset reconstruction.
After locating both ends, the code creates a browser Range, asks Chrome for the rectangles occupied by that range, and draws translucent rectangles over those coordinates. That is highlight reconstruction: rebuilding the visual overlay from saved comment offsets.
Why not just store <mark> tags?
That is possible, but comments introduce complications:
Two highlights can overlap.
A comment highlight should not count as a user editing the document.
Deleting a comment should not rewrite the canonical rich-text document.
Other users may edit text before or inside the highlighted range.
Paragraphs, lists, links, mentions, tables, and formatting can divide one selection across many nested elements.
Collaboration operations must transform the highlight’s position as text changes.
Mature rich-text systems normally represent these as decorations or annotations in a document model. They can display highlights without making those highlights part of the saved text.
Our current editor is built directly on browser contenteditable and saved HTML. Because there is no deeper document model providing efficient positions and decorations, MangoRTS manually translates offsets back into DOM ranges.
That design can work. The current implementation is simply doing the translation very inefficiently and far too often.
Why the offset calculation approaches quadratic work
Suppose the document contains 1,000 text nodes and we need to find character offset 50,000.
The current code walks through the text nodes. For each candidate node, it effectively asks:
“How much text exists from the beginning of the document to this node?”

It answers that by cloning and reading the document prefix again.
Conceptually:
Node 1: measure characters from start to node 1
Node 2: measure characters from start to node 2
Node 3: measure characters from start to node 3
...
Node 900: measure characters from start to node 900
That repeatedly reprocesses the same earlier text. Then it does the process again for the highlight’s ending offset, and again for every comment highlight and content-change marker.
The normal implementation is one pass:
Text node 1 begins at offset 0
Text node 2 begins at offset 48
Text node 3 begins at offset 113
...
Store that index once, then find an offset using a fast lookup. Rebuild the index only when the document actually changes—not when it scrolls.
Why scrolling rebuilds highlights
The current highlights are coordinate overlays. When the editor scrolls, their visible screen positions change, so the implementation recalculates their rectangles.
That is not inherently absurd, but the implementation couples:
Every scroll event
    ↓
React state update
    ↓
Rerender editor component
    ↓
Rescan comment ranges
    ↓
Translate offsets into DOM positions
    ↓
Ask Chrome for layout rectangles
    ↓
Update highlight state
    ↓
Rerender overlays
A better design would let highlight decorations scroll naturally with the content, or at minimum:
Calculate only visible highlights.
Use the prebuilt offset index.
Run once per animation frame.
Avoid React state if nothing changed.
Avoid all work when the block has no annotations.
Why mentions and toolbar formatting run on every character
These features need some updating:
The mention picker must notice when the caret follows @ or !.
The toolbar must know whether the caret is currently bold, italic, highlighted, centered, and so on.
The problem is how they obtain that information.
The mention logic currently converts everything from the beginning of the editor to the caret into a plain string after every input. It then searches that string for an active mention.
It should inspect only the local word or text run immediately before the caret. Usually that is tens of characters, not the entire document.
Likewise, the formatting toolbar does not need a complete browser style interrogation after every ordinary character. Formatting state can be updated when:
The selection changes.
The caret moves.
The user clicks a formatting command.
The active editor changes.
During uninterrupted typing, we already know the active typing style.
What else is being reconstructed
Not all reconstruction is bad, but current examples include:
Saved HTML string → live editable DOM.
Flat chat message records → threaded parent/reply tree.
Plain chat message text → mention and link elements.
Saved comment offsets → visible highlight rectangles.
Content-change records → addition/deletion overlays and labels.
Plain document text → indentation guide segments.
Collaboration snapshot plus pending local patches → optimistic document.
Caret position → toolbar formatting state.
Most of those are legitimate features. The mistake is rebuilding broad portions on every input, scroll, resize, or unrelated parent-state update.
What the backend is actually doing
The 48 collaboration reads are not all required merely to put the initial text on screen.
The node view already contains the text projections needed to render it. Then each text box independently:
Starts frontend-backend textbox sync.
Reads the canonical collaboration snapshot.
Reads it again at the end of recovery.
Subscribes to realtime.
Runs recovery again when realtime becomes healthy.
Potentially repeats some lifecycle work because of development Strict Mode.
Those are safety and collaboration layers placed on top of the initial display. The implementation currently allows those layers to create a request storm.
So your original mental model was closer to what the first paint should be:
Load the node once
    ↓
Display its text
    ↓
Attach collaboration without blocking or duplicating everything
Instead, we currently load the node, mount every editor/chat/message, initialize each editor independently, run repeated canonical recovery, rebuild highlights, hydrate images, and leave the whole massive DOM active.
What I would fix first
Keeping fetching unchanged, I would do this in order:
Virtualize the block rows and chat messages while keeping all data loaded in memory.
Move chat draft state into the individual composer and memoize block/message components.
Add browser containment and content-visibility as immediate safeguards.
Replace offset reconstruction with one cached text-node index.
Stop full-prefix mention scanning and per-character toolbar style reads.
Stop highlight recalculation on every raw scroll event.
Afterwards, remove duplicate collaboration recovery requests.
That sequence directly targets the “entire browser becomes unresponsive” symptom. Fixing only HTTP would improve opening, but the enormous live UI and high-frequency document work would still be there.

---------------------------------------------------------------------------

They are related, but they are not the same problem.
The cleanest way to think about it is:
Tiptap/ProseMirror replaces the machinery inside each text editor.
Virtualization, mounting, React rerenders, and chat rendering control how many editors and other UI elements the overall page keeps active.
Network/subscription cleanup controls how the page loads and synchronizes those documents.
You need all three. Tiptap is a major part of doing this properly, but installing Tiptap alone would not fix the entire node.
What Tiptap would directly improve
JSON by itself is not the important part. The important part is using ProseMirror’s structured document model, transactions, and positions as the actual editor.
Instead of Mango doing this:
Let the browser mutate HTML.
Read that HTML back.
Reconstruct what changed.
Recalculate text offsets.
Reconstruct highlights and indentation.
Serialize the document.
Build undo snapshots and collaboration patches.
Tiptap/ProseMirror works more like this:
The user inserts a character at position 875.
ProseMirror creates a small operation describing that insertion.
It updates its structured document.
It updates only the affected DOM.
It maps selections, comments, highlights, and history positions through that operation.
That would directly replace or substantially simplify:
Whole-document HTML serialization during editing.
Manual before-and-after undo snapshots.
Reconstructing changes from mutated HTML.
Much of the custom selection and caret handling.
Manual formatting detection.
Mention parsing based on reading everything before the caret.
List, table, and keyboard behavior implemented on top of contenteditable.
Collaboration based on HTML patches.
Many of the current text-offset reconstruction operations.
Sanitizing the entire editor during ordinary typing.
That is why the migration document correctly says Tiptap must become the actual editor. It cannot just be a JSON conversion layer hidden behind the current HTML editor.
The proposal is fundamentally sound: [Migration to Tiptap.md](/C:/Users/Jonat/.codex/worktrees/25cb/MangoRTSDev/docs/important tasks/After Go Live/Migration to Tiptap.md).
What “structured JSON” changes
Currently, HTML tells us how something looks, but it is often a poor source for understanding what it means.
For example, in Tiptap JSON, a paragraph can explicitly say:
This node is a paragraph.
Its indent level is 3.
Characters 10–18 contain a mention.
Characters 25–34 are highlighted.
This image has a particular attachment ID.
This is a table cell rather than a random nested collection of HTML elements.
We no longer need to inspect a complicated DOM tree and reverse-engineer those facts.
This matters enormously for correctness and editor performance. However, merely replacing an HTML database column with a JSON column does not provide these benefits. The benefits come from conducting editing as structured transactions.
If we kept the current editor and converted its HTML into JSON after every change, we would probably make it slower.
Highlights and comments
There are actually two different kinds of highlighting.
A normal formatting highlight—such as giving text a yellow background—can be a Tiptap mark stored directly in the JSON.
A comment highlight is different. The comment and its highlighted range often need to exist separately from the document because:
Comments can overlap.
Resolving a comment should not necessarily edit the document.
Permissions for comments and document editing may differ.
A comment must survive someone inserting text before it.
ProseMirror has a standard mechanism called decorations for displaying that sort of UI. More importantly, every edit includes a position mapping. If someone inserts five characters before a comment, ProseMirror can move the comment range five positions forward.
We would still write Mango-specific comment behavior, but we would stop repeatedly crawling the rendered HTML to rediscover where the comment belongs.
Indentation
Tiptap would also improve indentation, but the exact result depends on the feature.
Actual nested lists and semantic indentation can live directly in the document structure. There is much less to reconstruct.
If Mango still wants custom vertical indent-guide lines, those guides remain a custom visual feature. But they can be derived from structured nodes and updated around the changed section. We should not have to reread and reinterpret the complete rendered document after ordinary edits or scrolling.
What Tiptap does not fix
Suppose we replace every current editor with Tiptap but still do this:
Mount all 12 text-box editors simultaneously.
Mount every message in every chat.
Keep chat-composer state in the parent of the entire node.
Rerender the complete node when one composer character changes.
Run layout-reading highlight effects on every scroll.
Create duplicate subscriptions and snapshot recovery requests.
The application could still be slow.
Each mounted Tiptap editor has its own editor state, DOM, plugins, observers, event handlers, selection handling, and collaboration machinery. Twelve of them are better than twelve instances of our current custom editor, but they are not free.
Chat rendering is almost entirely separate. Tiptap will not virtualize 1,000 chat messages or stop the composer from rerendering its ancestors.
Likewise, Tiptap does not automatically fix:
Block-level virtualization.
Chat-message virtualization.
React state ownership and rerender boundaries.
CSS layout and paint containment.
Image decoding and memory pressure.
Duplicate subscriptions.
Repeated open-time snapshot requests.
Large Logic Gate responses.
Attachment request fan-out.
The architecture should be treated as two connected workstreams
1. Replace the editor internals
Use Tiptap/ProseMirror for:
Structured JSON as the canonical document.
Transactions and small steps.
Undo and redo.
Selection and formatting.
Lists, tables, mentions, links, and images.
Comments represented through mapped positions and decorations.
Batched Mango-owned persistence with exact revision protection.
HTML only for import, paste, email, export, and legacy compatibility.
2. Fix the node shell around the editor
Independently:
Virtualize text blocks and chat messages.
Mount only visible blocks, plus the active or dirty editor.
Keep composer state inside the composer.
Memoize block and message rows.
Add layout and paint containment.
Remove per-scroll React state where possible.
Coalesce duplicate subscriptions and snapshot recovery.
Keep images and attachments from consuming resources while far offscreen.
These shell improvements remain valuable even after the Tiptap migration.
My recommendation
Do not spend months perfecting the current HTML editor and then throw it away. But also do not wait for the entire Tiptap migration before fixing page-level mounting and rerendering.
The sensible sequence is:
Fix reusable shell problems first: virtualization, composer isolation, component boundaries, containment, and duplicate loading.
Build the Tiptap prototype as a genuine replacement—not as a JSON mirror behind the existing editor.
Reimplement editor-specific features using ProseMirror’s native model, transactions, decorations, and position mappings.
Keep ProseMirror transactions and mappings in the browser, and send one validated complete JSON snapshot per Mango save batch while automatic concurrent merging remains shelved.
Migrate HTML once, retain rollback data, and stop treating HTML and JSON as two authoritative editable documents.
So the short answer is: Tiptap solves a large portion of the awful editor-internal work, but it does not solve the large-node page architecture. We should migrate the editor and fix the surrounding rendering architecture as coordinated parts of one modernization project.

## Actual implementation planning and framework

so basically, long story short, we could divide the problem up into three distinct sections. 
The clean division
Problem 1: Too much exists
Solution: Virtualization and bounded DOM
Problem 2: Too many mechanisms within each Dom
A mounted editor currently brings or starts things such as:
Collaboration recovery.
Realtime subscription.
IndexedDB recovery.
Resize observation.
Scroll state.
Image loading.
Comment/change highlighting.
Selection and formatting management.
Undo-history infrastructure.
Solution: Lazy activation, delete or simplify mechanisms
Problem 3: Necessary editor work is too expensive
Solution: Tiptap/ProseMirror’s structured model and transactions


Yes. I understand the dependency structure now.
The clean rule is:
Build the page shell first, build activation rules second, and build the new editor engine and JSON storage together.

Problem 1 is independent of the document format
Virtualization and bounded DOM can be implemented while Postgres still stores rich HTML.
That work includes:
Mounting only visible or nearby text boxes and chats.
Using lightweight placeholders for offscreen blocks.
Keeping focused, dirty, selected, or saving editors mounted.
Separating chat state so one chat keystroke does not rerender the Node.
Reducing broad React rerenders.
Limiting mounted images and attachment thumbnails.
It does not need to understand whether the document contains HTML or Tiptap JSON.
The only future consideration is that virtualization should treat an editor as a contained unit. It should not reach inside the current HTML DOM to manage it. That allows the current editor to be replaced with Tiptap later without rewriting virtualization.
Problem 2 has two different halves
Your division is right.
Half	Can improve now?	Tiptap dependency
When an editor mounts, activates, sleeps, or unmounts	Yes	None
When frontend-backend textbox sync starts	Mostly	Starting/stopping is independent; the future change format depends on Tiptap
Realtime subscription lifetime	Yes	Message contents will change later
Image loading and viewport eligibility	Yes	Tiptap image elements come later
Resize and scroll observation	Yes	None
Undo and redo	Avoid major current rewrite	Tiptap should own it
Selection and caret positions	Avoid major current rewrite	ProseMirror positions should own it
Formatting commands	Avoid major current rewrite	Tiptap commands and marks should own it
Comment/change positions and highlights	Only emergency fixes now	ProseMirror mappings and decorations should replace it
Document serialization and changes	No major HTML redesign	Tiptap transactions should replace it

Some mechanisms therefore have two pieces.
For frontend-backend textbox sync:
Deciding when the sync starts and stops belongs to Problem 2’s page machinery.
Deciding that JSON mode batches ProseMirror activity into one revision-protected complete JSON snapshot per save belongs to Problem 3.
For images:
Deciding whether an offscreen image loads belongs to Problem 2.
Defining the Tiptap image element and its attachment-ID attributes belongs to Problem 3.
For comments:
Deciding whether an inactive editor needs comment UI running belongs to Problem 2.
Tracking the comment’s exact document position through edits belongs to Problem 3.
Problem 3 should be built around Tiptap from the beginning
We should not spend months building a better custom HTML undo system, selection model, range mapper, formatting engine, or document-difference system and then throw it away.
The Tiptap work should include:
A versioned Mango document schema.
Paragraphs, lists, checklists, indentation, formatting, tables, mentions, and permanent attachment IDs.
ProseMirror positions and mappings.
ProseMirror decorations for comment and change overlays.
Native transactions for typing and formatting.
Native editor undo and selection behavior.
A complete JSON snapshot at each bounded backend save while automatic concurrent merging is shelved.
A complete JSON snapshot for opening, reconnecting, and recovering.

The implementation sequence is:
1. We're gonna fix problem 1.
2. We're gonna fix problem 2.
3. We're gonna fix problem 3.
4. Convert existing PostgreSQL rich HTML documents into validated Tiptap-compatible JSON.


Notes for implementing problem 1 here:

Notes for implementing problem 2 here:
Yes—your list is broadly correct. The main thing is to separate “starts when the textbox mounts” from “runs after typing” and “runs when a typing batch closes.”
Assume Problem 1 leaves a window of 20 mounted rows. For each editable textbox in those rows, current code does roughly this:
When the textbox mounts
Creates the frontend-backend textbox sync.
Registers one exact realtime subscription scope.This is a logical subscription per textbox; the underlying WebSocket connection is shared.

Starts recovery:Searches IndexedDB for unsent operations.
Fetches the latest backend copy.
Replays or sends pending work.
Fetches the backend copy again at the end.

Creates an empty undo-history container.It does not create full undo snapshots until editing begins.

Creates selection, formatting, mention, and table-selection state.
Starts a ResizeObserver.
Installs several broad listeners:Window scroll.
Window resize.
Document selection changes.
Document pointer release/cancellation.

Starts scroll-position tracking and restoration.
Schedules comment/change/chat highlighting work.
Searches the textbox DOM for images.
If images exist:Starts an intersection observer to detect images near the viewport.
Resolves attachment URLs.
Loads authenticated image blobs.
Tracks image sizes.
Starts timers, including a five-second fallback that eventually loads remaining images.

Creates cleanup behavior for unmounting.
Uses animation frames for some scroll, resize, and highlighting work.
That means your consolidated mount list is:
Frontend-backend textbox sync.
Realtime subscription.
IndexedDB and backend recovery.
Undo-history container.
Selection and formatting tracking.
Mention detection infrastructure.
Table-selection tracking.
Resize observation.
Scroll tracking and restoration.
Comment, change, and chat highlighting.
Image discovery, observation, loading, and sizing.
Window and document event listeners.
Timers and animation-frame callbacks.
Unmount cleanup and flushing.
There are some important qualifications:
Read-only textboxes do not start the frontend-backend sync, but much of the visual machinery still starts.
Undo history is almost free when initially created. The expensive full-document snapshots happen during editing.
Mention detection mainly runs on input and key release, rather than constantly running in the background.
Some highlighting is conditional, but the chat-highlight path currently reads the complete document even when no chat anchors exist.
Images appear lazy initially, but the five-second fallback makes all images in a mounted textbox eventually eligible to load.
A textbox hidden using CSS can remain mounted, meaning its subscriptions, observers, and listeners can remain alive.
Unmounting and remounting repeats recovery and loses the textbox’s in-memory undo history.
After the user types one character
A separate group of work occurs:
The browser changes the editable DOM.
At the beginning of a typing batch, the editor captures the complete “before” HTML for undo.
It checks the caret and selection.
It calculates formatting state for the toolbar.
It runs mention detection.
It checks table selection.
It reads the complete plain text for list and automatic-outline behavior.
It updates React state, which can cause surrounding Node or Project components to rerender.
Some of these checks happen again on key release.
When the typing batch closes
Typing is grouped into batches—normally after about 160 milliseconds of inactivity, with a maximum continuous batch of about 500 milliseconds.
At that point:
The complete editor DOM is sanitized and serialized to HTML.
The complete plain text is extracted.
The complete “after” undo snapshot is captured.
The before and after HTML snapshots are stored in undo history.
The old and new HTML strings are compared.
The changed section is converted to UTF-8.
A bounded HTML patch is created.
The pending operation is written to IndexedDB.
The operation is sent to the backend.
The backend applies the patch and updates the complete canonical HTML and compatibility projection in PostgreSQL.
One precision correction to your pasted note: the complete “before” snapshot is captured when the batch begins, while the complete “after” snapshot is captured when it closes. They are then stored together as one undo entry.
So Problem 2 is really asking:
For every textbox that Problem 1 leaves mounted, which of these systems must be awake now, which can sleep, and which should activate only when the textbox becomes visible, focused, edited, or explicitly opened?

A sensible lifecycle would be:
Mounted but sleeping: display the existing HTML without recovery, broad listeners, or active editing machinery.
Near the viewport: recover the latest content and begin image eligibility.
Focused/active: start selection, formatting, mention, and undo behavior.
Dirty: keep sync and recovery alive until the edit is safely stored and confirmed.
Inactive again: remove broad listeners and observers while retaining only the state needed for correctness.
The major rewrites of undo, caret positions, formatting commands, comment positions, and HTML serialization should still wait for Tiptap. Problem 2 can reduce when those systems run, but should avoid rebuilding them just before Tiptap replaces them.

Notes for implementing problem 3 here:

Notes for implementing problem 4 here:


## Project Progress: (make sure you leave datetime timestamps of when you inserted to this progress tracker below)

### Step 1:

Completed in the bounded editor-mounting implementation on 2026-07-17.

- Node and Project text-box lists now share a fixed-row virtualization primitive. The browser mounts only the visible rows, two rows of overscan above and below, and at most a small number of explicitly pinned active rows.
- Height-preserving spacers represent every unmounted row, so the list keeps its full scroll height and order. Scroll-window updates are scheduled once per animation frame and do not walk or mount the intervening rows during a long jump.
- Normal opens start at the top. Block, chat-message, attached-email, email-message, and Node change targets resolve to their owning row before navigation; their neighborhood mounts first. Target intent remains pending while projections load.
- Node and Project use the same permanent row layout: email on the left, text editor in the middle, and chat on the right. Email-created Nodes retain their email and chat associations but no longer use a second visual Node layout.
- Each header has independent, keyboard-accessible email, text-editor, and chat toggles. On a Node's first open, editor and chat open for every row; email starts closed when the Node has no attached email and starts open for every row when the Node has one or more attached emails. Project first-open defaults remain all three sections open. Explicit closures persist through later projection updates, while newly arriving block IDs receive only the applicable defaults. Closing a section unmounts that section's UI while keeping its data and draft state; the one deliberate exception is an active unsent email reply, whose row and reply UI stay pinned until another reply takes ownership so closing or scrolling cannot discard the draft.
- Text-box rows and editor bodies use one fixed vertical height and no longer expose user-controlled vertical resizing. Node and Project email/chat panes participate in that fixed row height. Horizontal email/chat column resizing remains available; narrow windows retain the fixed row and scroll horizontally across the columns.
- Before a virtualized editor unmounts, pending local textbox input crosses the existing frontend-backend textbox sync boundary and the existing flush/retry/recovery path continues. Inner editor scroll memory is kept outside the row so a remount restores it.
- Stable block IDs remain React keys and persistence document IDs. Existing HTML and PostgreSQL storage, add/delete behavior, formatting, images, highlights, permissions, and mounted-editor undo behavior remain in place.
- Logic Gate is explicitly excluded from row virtualization.
- Focused regression coverage asserts bounded mounted counts for large Nodes and Projects, monotonic scrolling through multiple windows to the final row, fast jumps, one-time deep-target handling, spacer geometry, late block/chat/email projection arrival, Node zero-email and attached-email defaults, manual closure retention, correct content/chat remounting, safe unmount flushing, retained Project behavior, and the Logic Gate exclusion.
- Corrective pass completed 2026-07-17 13:59:39 -07:00: Node pane defaults now initialize only after that Node's projections have loaded, the faulty v2 empty-pane browser state from the first implementation is bypassed while nonempty v2 preferences migrate forward, and an ordinary Node text/change deep target explicitly reopens its editor column. A real React lifecycle test now loads Node and Project hosts, checks the DOM row bound, moves the window, flushes an edited row through virtual unmount, remounts it, and follows deep targets; the earlier arithmetic/source-contract test remains as lower-level coverage.
- Corrective pass completed 2026-07-17 18:55:16 -07:00: the blank-row failure was caused by same-Node projection reconciliation filtering existing pane sets without adding newly arrived block IDs. Pane layout storage now records explicit editor/email/chat closures separately from first-open defaults, so late or incremental blocks mount editor and chat instead of leaving only fixed-height shells, while manual closures remain respected. The scroll reset was caused by deep-target navigation writing the outer scroll position from both the shared virtualizer and its Node/Project parent effect, with browser scroll anchoring also free to compensate while spacer DOM changed. The shared virtualizer is now the sole target-scroll owner, ordinary window measurement no longer carries target intent, and the Node/Project scroll roots disable native anchoring. The real React test covers late empty-to-populated projections, both Node email defaults, manual closure retention, monotonic bottom reachability, non-replayed handled targets, correct content/chat remounting, and bounded Project mounting.

### Step 2:

The inactive lifecycle foundation was implemented on 2026-07-18 and corrected in refinements completed on 2026-07-19 at 09:00:01 and 12:17:19 -07:00, with a further correctness pass on 2026-07-20. It is not active for stored production documents because Step 4 has not run and the gate remains disabled.

- Gated non-email Tiptap text boxes move through sleeping/static, preparing/recovering, active, dirty/pending, and safely inactive states. A near-viewport margin may prepare and recover a static row, but it no longer controls realtime eligibility.
- Exact realtime document scopes now exist only while the textbox literally intersects the viewport. A visible sleeping/static row subscribes, refreshes canonical state after subscription, and displays current content and annotations. Leaving the viewport releases that scope immediately, including for an offscreen dirty row that remains mounted only to finish its HTTP save/retry.
- Dirty lifecycle state is published to the Node and Project virtualizers. Those outer row windows pin a pending editor until backend acknowledgement reduces its pending count to zero, then release it. The DOM pin attribute remains diagnostic and is not the ownership mechanism.
- The JSON pending store is keyed by company, resource type, resource ID, and document ID and uses exact IndexedDB reads. Live typing stays in ProseMirror memory. At a roughly 180 ms quiet boundary, with a 1.5-second maximum during continuous input, Mango reads, validates, serializes, publishes, and writes at most one latest JSON snapshot plus mapped annotation positions for the batch. Blur, explicit flush, navigation, and shutdown close the batch; acknowledgement deletes the exact pending record.
- Failed saves retain the exact stable operation and retry with bounded delay. Once a network attempt can have reached the backend, that operation ID, base revision, document, and annotation payload are immutable; later typing is captured under a new operation instead of rewriting the attempted one. Recovery replays the attempted operation before declaring a base-revision conflict, so an operation already accepted by the server whose HTTP acknowledgement was lost is recognized as acknowledged even when the user typed again. Exact revisions still stop real divergent overwrites and expose keep-local/use-canonical recovery. No automatic merge or concurrent collaboration protocol is implemented.
- IndexedDB unavailability, quota failure, or cleanup failure is surfaced separately as `Browser recovery storage failed` with useful detail and the consequence that browser recovery is not guaranteed; it is not reported as a document-revision conflict. A successful backend acknowledgement remains canonical and immediately reduces pending ownership to zero, so a row cannot stay pinned forever because recovery-storage cleanup failed. The warning clears only after a later successful recovery-store read/write proves storage is usable again.
- Runtime counters now distinguish immediate ProseMirror transactions from full-document serializations, IndexedDB writes, network saves, recoveries, subscriptions/resources, images, dirty editors, and conflicts. The full-document counter is incremented inside the validating/stringifying/UTF-8 boundary itself. The mounted large-document test proves a typing burst performs zero eager serializations/writes and one of each at the batch boundary; duplicate React lifecycle/document publications are suppressed.

### Step 3:

An inactive JSON foundation exists behind the atomic workspace gate. The 2026-07-19 refinement corrects material source-branch defects, but Step 3 is not accepted as a complete parity or migration result. The gate defaults to `legacy_html/not_started` and must remain disabled until Step 4 conversion/cutover and the remaining evidence below are completed.

- Open-source Tiptap/ProseMirror 3.28.0 is pinned locally for Node, Project, and standalone Logic Gate/Editor rich documents. Email compose/reply/forward, attached-email reply, drafts, signatures, recovery, display, and send formatting now bypass Tiptap completely and remain on the existing rich-HTML editor/storage path. Email is removed from the JSON resource types, authorization branches, repository schema constraint, and communication API dual-format fields.
- The strict `mango-tiptap-json` version 1 schema rejects unknown structure, legacy HTML, unsafe links, transient URLs/bytes, and unsupported versions. Mentions persist an explicit `normal` or `urgent` kind and use separate `@`/`!` triggers. Tab/Shift+Tab route through list indentation or shared block indentation rather than table-cell navigation.
- JSON-mode annotations, chat selections, change ranges, deep-link positions, and editor selections use genuine ProseMirror positions with no plain-text `+1/-1` adapter. ProseMirror transaction mappings update active decorations across structured edits. Durable comment/change/chat/highlight positions are committed atomically with the accepted document revision in canonical, stable-operation, and immutable-version rows, so save, unmount/remount, reload, recovery replay, realtime refresh, and sleeping rendering cannot restore positions from an older document revision. Ephemeral local selections are explicitly excluded from persistence.
- Image nodes store permanent Mango attachment identity and safe metadata. Display and original-preview loads are separate and cancelable, failures expose Retry, and pointer resize is visual while moving with one document transaction committed at completion. Direct-to-S3 upload ownership remains Mango's. Full legacy image action/paste-source parity still requires the acceptance work listed below.
- Mango owns the Go API, PostgreSQL JSONB canonical document/version/operation rows, permission checks, exact revisions, idempotency, realtime outbox, browser sync, recovery, and attachment integration. Ordinary document commits and document deletion do not create generic Updates notifications. The accepted operation compares stable mention occurrences before and after the commit, so only newly added normal `@` or urgent `!` mentions notify; retaining, moving, or removing an existing mention does not, re-adding a removed occurrence does, and retrying the same stable operation remains idempotent. Node, Project, and Logic Gate use the same rule, while existing chat notification paths remain unchanged. No Tiptap Cloud, Hocuspocus, Yjs, outside Tiptap server, automatic merging, or concurrent collaboration protocol is used.
- The repository migration and canonical schema contain only inactive Node/Project/Logic Gate JSON contracts, including revision-bound durable annotation-position arrays. No existing HTML is converted, no data rows are backfilled, and no live database migration is applied by this work.
- Real test coverage includes the mounted React/Tiptap component, the production Node/Project/Logic Gate JSON adapters, and the actual `NodeWorkspaceSurface`, `ProjectSummaryContent`, and standalone Logic Gate `EditorContent` page hosts in `tiptap_json` mode. The full Node/Project virtualization hosts and unified Node email/HTML email paths remain covered. Tests prove large-document transaction batching at the actual serializer boundary; an immutable lost-ack operation followed by later typing; unavailable, quota-failed, and cleanup-failed recovery storage with separate warning/conflict behavior and eventual unpin; visible-only exact subscriptions; a visible sleeping production host receiving live document/highlight refresh; and actual ProseMirror insertion/deletion mapping comment/change/chat positions through save and repeated remount. Backend HTTP coverage proves ordinary edits and DELETE are silent, stable retries do not duplicate, retaining/removing mentions is silent, remove/re-add creates a new event, and normal/urgent Node, Project, and Logic Gate mentions follow their supported notification paths.
- Remaining Step 3 work is focused Mango integration verification, not re-proving standard Tiptap/ProseMirror behavior. Use standard editor conventions and existing extensions for indentation, lists, numbering, formatting, tables, and ordinary keyboard behavior. Verify only the Mango-specific boundaries: normal/urgent mentions, permanent attachment IDs and uploads, comment/change/chat positions, the actual Node/Project/Logic Gate hosts, frontend-backend textbox sync/recovery/realtime, and the permanent separation of rich-HTML email.
- Historical verification passed on the implemented and merged JSON foundation, including actual JSON-mode page hosts, the unified Node email column and rich-HTML email regressions, frontend build, Go tests, clean and legacy disposable-PostgreSQL paths, and the former production-path browser harness. That browser harness was removed from CI on 2026-07-28.
- Database progress reported by the operator on 2026-07-20: the inactive Tiptap foundation migrations have been applied. They create the gate and JSON storage but do not convert HTML or activate Tiptap. Runtime remains `legacy_html/not_started`.

### Step 4:

Active planning; conversion has not started. The goal is one controlled conversion of every non-email Node, Project, and Logic Gate text document, followed by an atomic workspace cutover. Email remains HTML.

#### Agreed conversion rules

- Use Tiptap's official `@tiptap/html` `generateJSON(html, extensions)` utility with the same pinned extension/schema configuration as the editor. Do not build another HTML parser.
- Explicit HTML-to-JSON conversion occurs only during the read-only dry run and one-time database migration. External clipboard HTML is parsed by Tiptap's normal paste pipeline. Normal typing, saving, loading, and realtime delivery remain JSON and do not reconvert HTML.
- The source for a text box is `editor_collaboration_documents.canonical_html` when that canonical row exists. Otherwise extract the `document` HTML from its Node, Project, or Logic Gate projection. The projection's `information_id` is the JSON `document_id`.
- Convert active text boxes only. Never include email bodies, drafts, signatures, imported email snapshots, or email display data.
- Do not mix live HTML and JSON documents within one workspace and do not dual-write both formats.

#### First pilot: one known text box

Target Node: `019f811d-669f-7e6c-9b02-d8c0e2df5d6b`.

1. Read the Node's active `Text box` projection rows and identify the one `information_id` containing the pasted test material.
2. Read its authoritative HTML, run that single HTML string through `generateJSON`, and wrap the result in the strict `mango-tiptap-json` version 1 envelope.
3. Put the result only in a disposable local database or test fixture. Do not change the live workspace or flip its company-wide gate.
4. Load it through the real Mango Tiptap host and test the features present in that text box, then edit, save, refresh, sleep/remount, and reopen it.
5. If the result is wrong, correct the standard extension configuration or the narrowly required Mango extension parsing and repeat.

#### Read-only whole-database check

- After the pilot works, run the same conversion over every active non-email Node, Project, and Logic Gate text document without writing results back.
- Require the source count and successfully converted count to match. Compare visible text and permanent attachment IDs, and list any conversion failures instead of silently accepting them. A concise failure summary is enough; no separate custom conversion system is needed.
- Legacy comment/change/chat highlight records are separate from document HTML. Where they exist, map their stored offsets to positions in the converted ProseMirror document and verify the target. Documents without these records need no annotation conversion.
- Fix any real failures found by this pass before scheduling the write conversion.

#### Full conversion and cutover

1. Stop non-email editor writes and wait for pending frontend-backend textbox sync saves to finish.
2. Take a verified database snapshot and confirm it can be restored.
3. Set the workspace gate to `legacy_html/converting`. Run the rehearsed script: read each authoritative HTML document, call `generateJSON`, and write its JSON document and any converted annotation positions.
4. Require the stored JSON document count to equal the frozen source count, then atomically set the gate to `tiptap_json/ready`.
5. While writes remain stopped, open and test existing and new Node, Project, and Logic Gate documents; saving/reload; images; mentions; comments/changes/chat; permissions; realtime; and rich-HTML email.
6. If the smoke test fails, restore the verified HTML snapshot before reopening writes. If it passes, reopen writes and retain the snapshot and legacy non-email data during the agreed confidence period.
7. After the confidence period, remove only the legacy non-email HTML editor, HTML frontend-backend textbox sync path, and rollback-only collaboration storage. Keep the JSON sync path and keep all email and clipboard HTML support.

Step 4 is complete when the whole workspace is `tiptap_json/ready`, converted counts match, the smoke test passes, writes reopen successfully, and the rollback snapshot is retained for the agreed period. Applying schema migrations or converting only the pilot text box does not complete Step 4.

## Things to Do Later: Shelved Items

- **Automatic concurrent simultaneous-edit merging:** shelved by product decision. Exact revisions, durable pending work, idempotency, and visible keep-local/use-canonical conflicts remain the current protection. Yjs, CRDT, OT, Hocuspocus, Tiptap Cloud, and external document servers are not part of the current design.
- **Legacy editor deletion:** remove the old non-email HTML path and rollback-only data only after the successful cutover and confidence period. Email continues to use HTML.

Last updated: 2026-07-20 13:33:31 -07:00

## 2026-07-27 Node V2 write/read amplification fix

The Node V2 browser no longer calls `getJSON()`/`getText()` or sends a full `Y.encodeStateAsUpdate()` checkpoint on a 1.5-second timer or unchanged blur. A 180-ms batching window merges only the Yjs transaction deltas and durably queues the exact bytes before sending. The trusted provider performs materialization/compaction only at 512 updates, 512 KiB, 15 minutes idle, or an explicit recovery boundary.

Initial Node workspace reads now return only text-box metadata/counts and stable continuation cursors. Full TipTap JSON/plain text is fetched for the active or visible document, and archived summaries never hydrate document bodies. Text-box reordering uses a sparse single-item move command, so a paged browser never sends a partial list as if it were complete.

Disposable PostgreSQL coverage measures 20 small durable update rows against a generated 1-MiB canonical document and asserts that ordinary input creates no extra checkpoint and does not increment the materialized revision. The production-path browser harness proves paged hydration and continuation instead of relying on source-text assertions.
## 2026-07-28 Node v2 Phase 3 override

The earlier “no Yjs/Hocuspocus” decision in this document remains accurate for the legacy generic JSON editor and HTML email surfaces, but it is superseded for the gated Node v2 text-box path. Node v2 now uses the repository-owned production Hocuspocus/Yjs service with PostgreSQL commit-only acknowledgement, exact snapshot durability, materialization, compaction, authorization, quarantine, and offline recovery. Project and Logic Gate cutover continue to use exact-revision JSON writes in owner-specific tables. Email remains HTML and outside document conversion.

See docs/backend/node-v2-phase3-engineering.md for the current authority, rollout gates, tests, limits, and manual/live steps. No real workspace was converted or activated.
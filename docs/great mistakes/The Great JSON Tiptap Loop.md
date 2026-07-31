# The Great JSON Tiptap Loop

Timestamp: 2026-07-31 02:36:07 -07:00 (America/Los_Angeles)

## What users saw

Typing in a sufficiently large Node, Project, or Logic Gate editor would abruptly stop painting. Keyboard input queued while Chrome's main thread was stuck. Several moments later, the queued characters appeared in one burst.

The document was already on the JSON/Tiptap path. The pause was not evidence that normal typing used the legacy HTML editor, and it was not caused by the 500-millisecond quiet save repeatedly firing while the user typed.

## Runtime evidence

The dev-only function trace captured 53.6 seconds, 248,365 events, 354 real keydowns, and 354 real document-changing ProseMirror transactions. In the same capture it recorded:

- 13,136 total ProseMirror dispatches.
- 12,782 transactions with no document change, no selection change, and no steps.
- 12,770 annotation replacement transactions.
- 76,773 React commits of `MangoTiptapEditor` across six mounted editor sessions.
- A 4,350.2 millisecond long animation frame while the page remained visible.
- Keydown input delays of 1,216 milliseconds and 967 milliseconds during the freeze.
- The queued DOM input events then being processed in a burst, matching the visible “gush” of delayed characters.

The final four seconds alone contained 29 keydowns, 29 real document transactions, 854 metadata-only transactions, and 5,130 React editor commits. Each of the six mounted editors committed 855 times. The loop also continued during seconds with zero keyboard input, which proved that typing and saving were not required to keep it alive.

The trace file was about 80 MB and nearly reached its 250,000-event cap. That much tracing can add memory and garbage-collection pressure, so it may have made the captured pause larger. It did not create ProseMirror transactions or React commits; those were application work observed by the recorder.

## What did not cause it

No save was running when the 4.35-second freeze began. The previous save had ended roughly four seconds earlier, and the next 500-millisecond quiet save started only after the freeze.

Measured save-path costs were small compared with the freeze:

- Tiptap `getJSON()`: six calls, 0.6 milliseconds total, 0.2 milliseconds maximum.
- Snapshot provider: 0.2 milliseconds maximum.
- `JSON.stringify`: seven calls, 1.2 milliseconds total, 0.3 milliseconds maximum.
- IndexedDB puts: asynchronous, 16.5 to 20.8 milliseconds.
- IndexedDB transaction maximum: 33.8 milliseconds.
- HTTP fetch: asynchronous, 692.6 milliseconds maximum.
- Response JSON parsing: 20.2 milliseconds maximum.

The backend's full-document current row, version row, operation row, and realtime-outbox payload may deserve separate storage and bandwidth work, but they were not on the main thread during this freeze. Moving the save request to a Web Worker would not have fixed this incident.

## The exact feedback loop

1. `NodeWorkspaceSurface` built a fresh `messages` array inside every timeline-row render, even when the underlying messages had not changed.
2. `NodeTextBlockEditor` derived an annotation array from the `chatMessages` prop. A fresh messages array therefore produced a fresh annotations array.
3. `MangoTiptapEditor` treated the new array reference as an annotation change and unconditionally called `updateMangoTiptapAnnotations`.
4. `updateMangoTiptapAnnotations` unconditionally dispatched a ProseMirror transaction containing a full annotation replacement in plugin metadata.
5. Tiptap's `onTransaction` callback recalculated selection and toolbar state for that annotation-only transaction because its condition was backwards for no-op metadata.
6. The inline-format callback created a fresh `{ bold, underline, italic, strikethrough }` object.
7. `EditorContent` stored that fresh object without comparing its values, causing the parent to render again.
8. The parent render recreated messages and annotations, returning to step 3.

One editor started the state update, but the parent owned six mounted editor components. That is why one cycle produced commits across all six editors and why the trace showed an exact six-to-one commit multiplier.

The “metadata” was not database metadata and did not contain document JSON. It was ProseMirror transaction metadata used to replace the in-memory comment, chat, and change-highlight decorations. The metadata transaction was legitimate when annotations actually changed. Repeating it hundreds of times per second with identical contents was the bug.

## The fix

The patch breaks the loop at every unsafe boundary:

1. `NodeWorkspaceSurface` now creates a memoized per-block display-message map. Ordinary parent renders reuse the same row arrays. The special legacy email-chat merge is sorted only when its source data or mapping changes.
2. The annotation-prop effect in `MangoTiptapEditor` compares annotation contents before dispatch. A new array with the same meaningful values causes zero transactions.
3. `updateMangoTiptapAnnotations` performs the same content comparison at the ProseMirror boundary. Any future caller that forgets the first guard still cannot dispatch an identical replacement.
4. Tiptap transaction handling no longer recalculates toolbar state for arbitrary metadata-only transactions. It updates for document changes that lack a separate selection event and for stored-mark changes used by caret formatting. Selection changes remain handled by the selection callback.
5. `EditorContent` compares the four inline-format booleans before updating React state. Identical values retain the existing object and cannot cause a parent render.

The defenses are intentionally layered. Stable React props reduce ordinary work, content comparison defines the actual annotation rule, the ProseMirror boundary protects every caller, the transaction filter prevents unrelated metadata from publishing toolbar state, and the React setter prevents equal value objects from rerendering the owner.

## Behavior that must remain true

- One typed character produces one real document change, subject only to bounded internal Tiptap plugin work.
- A content-identical annotation array produces zero replacement transactions.
- A real annotation ID, kind, range, active-state, or durability change produces exactly one replacement transaction.
- Typing maps annotation positions through the real document transaction and persists those mapped positions with the document.
- Selection and caret-format changes still update toolbar controls immediately.
- Annotation-only work does not publish toolbar values.
- Saving remains a 500-millisecond quiet batch with a separate 10-second maximum timer.
- Full-document JSON saving and recovery behavior remain unchanged by this fix.

## Regression coverage

`mangoTiptapFoundation.test.ts` counts annotation transactions and proves that an identical replacement is skipped while a real change dispatches once.

`mangoTiptapEditorIntegration.test.tsx` mounts the real shared editor, forces a parent rerender that supplies a newly allocated but content-identical annotation array, and proves that it produces zero ProseMirror dispatches, no toolbar publication, and no React commit loop. The existing formatting assertions then prove that caret-format commands still update immediately.

`editorOpenPerformanceContract.test.ts` locks down the guards, transaction filter, React value comparison, and memoized Node message map so a later refactor cannot silently remove one layer.

The incident trace remains useful as the before-fix baseline. A post-fix dev trace should no longer show idle annotation replacement transactions or thousands of React editor commits per second.

# Example Project Inputs

These examples show the kind of top-level prompts the user may give to the orchestrator. The orchestrator should treat each heading as a separate project and split it into worker assignments.

## Text Editor

Expected themes:

- Outline style selection should not make the node title disappear.
- Format tab controls should be redesigned around font size increase/decrease controls.
- Remove or revise bold, underline, and hyperlink UI behavior that currently produces markdown/HTML-like artifacts or browser popups.
- URL paste should auto-detect links, render blue/underlined text, and open the destination when clicked.
- Font size changes should apply to selected text while preserving selection, or to future typed characters when only an insertion point exists.
- Outline style dropdown should match MangoRTS styling and show a check mark on the selected style.
- Dropdown hover styling should match frame accent colors, including `rgb(0, 233, 255)` in light mode.
- Pressing Enter at the bottom of the editor should keep creating blank rows and scrollable space.
- The editor should maintain a roughly 20-line buffer between the caret/end of content and the bottom of the frame.

## Kanban Board

Expected themes:

- Left-clicking `All Boards` should open a small menu-like board picker.
- Board picker should show folders and child Kanban boards in a list/tree structure.
- Selecting a board in the picker should display that board.
- Kanban header hit targets should allow editing board name, searching boards, and clicking `All Boards`.
- Board name input should be moved right enough that it does not sit under the frame label.
- Company Explorer Kanban icon should use a black board with bright red, yellow, and `rgb(0, 233, 255)` columns.
- Kanban column scrollbars should be thinner than Editor/Company Explorer scrollbars and use the selected card color.
- Remove the `Find on Company Explorer` right-click option from Kanban cards.

## Company Explorer

Expected themes:

- Dragging a folder into another folder should preserve the target folder's existing expanded/collapsed state instead of auto-expanding collapsed folders.
- Switching top-level dashboard tab views should preserve selection state for Company Explorer, Node Map, and Editor without flashing or forgetting.
- Company Explorer context menu should replace separate `Create Node folder` and `Create Logic Gate folder` options with one generic `Create New folder`.
- Context menu should include `Create Node`, `Create Logic Gate`, and `Create New Kanban Board`.
- Kanban boards should be placeable in any folder where the product model expects them to appear.
- `Find on Company Explorer` from Node Map or Logic Gate Map should scroll the target row into actual view, not one row below the frame edge.


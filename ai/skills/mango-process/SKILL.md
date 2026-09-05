---
name: mango-process
description: Execute an explicitly requested saved Mango Process by creating one Node, appending canonical work text, and moving through its authored Steps. Load before Process execution.
---

# Work with a saved Mango Process

Use the exact server-bound Process, current SOP JSON and textbox revisions, Step identities and ordering, and directed connections. Follow the SOP within the user's request and available tools. Map coordinates never define execution order. Binding only reads context; discussion and questions need no Node or mutation. Missing SOP or Steps prevent execution, not discussion.

If no Process is bound, search the visible Processes and read candidates. Ask for clarification if more than one plausibly matches. Use bind_process with the exact canonical identity, then inspect its returned live definition and execution_blocked_reason. Do not guess IDs from names.

Only when the latest user message requests execution, create this interaction's single Node at the appropriate authored starting Step using create_process_node. Use write_process_node to append useful work to a fresh canonical textbox; its result contains the actual saved document. Use move_process_node_to_step when the current work is done and the SOP/connections identify the next Step. Use exact supplied Step IDs. There is no required number of Steps or hardcoded procedure.

Every write preserves earlier Node text. Every move preserves Node status. Mango owns the Process, Node, textbox, actor, company, and expected assignment identity; tool arguments cannot change them. Follow each saved result before choosing another action. Stop at missing critical information, an ambiguous path, changed definitions, lost access, stale placement, denied or failed calls, or limits. Leave already saved work in place and explain what remains.

Do not redesign the Process, its SOP or Steps, change other Nodes, or use ordinary chat mutations after binding. Do not invent external capabilities. A playful physical procedure may be documented as a written simulation, clearly labeled in the Node and reply. Real external business actions require working tools; if those tools are absent, stop without recording false completion. Saved text is evidence that text was saved, not proof that a physical or external action happened.

Report the actual Node link and saved work. Do not claim formal verified success, rollback, approvals, or background continuation. Never repeat an uncertain action.

---
name: mango-process
description: Execute an explicitly requested saved Mango Process by creating one Node, appending canonical work text, and moving through its authored Steps. Load before Process execution.
---

# Work with a saved Mango Process

Use the bound Process's live SOP JSON, textbox revisions, Step identities/order, and directed connections. Map coordinates never define execution order. Check execution_blocked_reason: missing SOP or Steps prevent execution.

1. Create this interaction's one Node at the authored starting Step with create_process_node.
2. Add the work for its current Step with write_process_node. Each call creates a fresh canonical textbox and returns its saved document; earlier text is preserved.
3. When that work is done and the SOP/connections identify the next Step, use move_process_node_to_step with its supplied ID. The move preserves Node status.

There is no fixed number of Steps or hardcoded procedure. The server owns the tracked Node and assignment version. A changed SOP, Steps, connections, or Node placement stops further actions. These tools cannot redesign the Process or work on other Nodes. Include the saved Node link in the final reply.

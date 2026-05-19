# V2 Architecture Doc

## Sacred Text
MangoRTS is B2B software built for:
- millions of companies
- millions of users and AI agents per company
- millions of simultaneous frontend UI elements and backend operations
- strict latency culture with sub-100ms targets
- strict robustness and reliability
- future headless AI-agent operation through APIs as the main interaction path
- millions of AI agents using APIs concurrently
- AWS-hosted app and database infrastructure, with efficient code to minimize cloud cost

Default engineering rule:
- Write code in an architecture where it would be possible for 20 agents to develop on this app simultaneously.
- Find the simplest solution possible. Only increase complexity when needed.

## Workspace Read Lesson
The bad pattern is not "snapshots exist." The bad pattern is an unbounded convenience snapshot:

```text
one endpoint = whole company = easy frontend code = impossible tenant scale
```

The V2 pattern is:

```text
surface-specific bounded snapshot + targeted queries + event deltas
```

Snapshots are acceptable only when they hydrate a bounded view. They are not acceptable as routine whole-company reads on hot paths.

## Read Path Types
### Bounded Snapshots
Use snapshots for initial hydration of a UI or API surface that needs several related object types at once.

Examples:
- Node Map: nodes, relationships, map positions, and folder metadata for one folder subtree.
- Logic Gate Map: logic gates, relationships, map positions, and folder metadata for one folder subtree.
- Kanban board view: columns and a bounded card window for one board.
- Company Explorer: folders and folder items for a declared folder kind or subtree.

Rules:
- Every snapshot must declare a scope such as `node_map`, `logic_gate_map`, `company_explorer`, or `kanban`.
- Every snapshot must have a hard boundary: `folder_id`, `board_id`, cursor, page size, query, or an equivalent bounded selector.
- Snapshot `304` handling must happen before payload assembly, marshaling, hashing, and expensive repository reads whenever a version-based validator is available.
- Full snapshots are allowed only for admin, debug, export, migration, or explicit compatibility paths. They are not frontend hot-path APIs.

### Conditional GET And Scoped ETags
Conditional HTTP reads are a server-side version check, not just a bandwidth feature.

The old inefficient pattern was:

```text
request with If-None-Match
-> query database
-> build full response object
-> marshal JSON
-> hash response bytes
-> compare ETag
-> maybe return 304
```

That saved network transfer, but it did not save the hot-path database, object assembly, marshal, or hash work.

The V2 pattern is:

```text
request with If-None-Match
-> read cheap scoped version token
-> build ETag from that token and request scope
-> compare ETag
-> return 304 immediately when unchanged
-> only then query/build/marshal the full response when changed
```

Current implementation:
- Workspace snapshots use scoped workspace event validators before loading snapshot rows.
- `company_explorer`, `node_map`, `logic_gate_map`, and `kanban` snapshots use different event filters so unrelated changes do not invalidate unrelated scoped snapshots.
- Kanban snapshot validators are board-scoped with `board_id`.
- Hot list endpoints for nodes, relationships, logic gates, map layout, and kanban lists use pre-body ETag checks instead of `writeJSONMaybeNotModified`.
- The validator source is `CurrentDomainEventSequence` with optional event-type and simple payload equality filters, for example `board_id`, `folder_kind`, or `item_type`.

Important distinction:
- `writeJSONMaybeNotModified` is still acceptable for low-risk small/detail responses where no cheap validator exists.
- Hot reads must prefer scoped version validators and must return `304` before expensive repository reads whenever correctness can be preserved.
- Event-token validators rely on API mutation handlers publishing workspace domain events. Direct SQL or repository writes outside those handlers are outside this cache contract unless they also publish equivalent events or bump the relevant read-model version.

### Targeted Query Endpoints
Use targeted endpoints when the caller needs a specific collection, filtered list, search result, or page.

Examples:
- email inbox pages
- shared inbox message pages
- communications status
- logic gates by person, function, assignment, or search query
- node search and filtered node lists
- kanban cards by board, column, cursor, or query

Rules:
- Prefer indexed filters and pagination over bundling unrelated objects into a snapshot.
- Return only the fields needed by the surface or contract.
- Avoid hidden fan-out reads that load unrelated company data.
- API paths used by future headless AI agents must be just as bounded as frontend paths.

### Event Streams And Deltas
Use events to keep hydrated views fresh after the initial bounded read.

Rules:
- Commands should return changed objects so the UI/API client can update local state without a full refresh.
- Streams should carry enough event data for common local delta updates.
- If an event cannot be applied safely, refresh the smallest relevant bounded snapshot, not the full workspace.
- Event versions can be used for cheap cache validators and `304` responses.

## Architectural Rule
Differences between read styles are healthy when they are intentional:

- maps use bounded snapshots because they need a coherent graph view
- inboxes use paginated query endpoints because they are naturally list/page oriented
- search and assignment views use targeted indexed queries
- streams provide freshness after initial hydration
- commands return local mutation data

The weakness to avoid is a generic endpoint that quietly becomes the dependency for every module.

## Review Checklist
Before adding or changing a read path, verify:

- Does this path load more than the current surface needs?
- Can the request be bounded by folder, board, cursor, query, user, or assignment?
- Does the database query filter before returning rows, instead of filtering large result sets in memory?
- Does `304` return before expensive payload construction?
- Is this endpoint safe for many AI agents calling it concurrently?
- Would 20 engineers be able to extend this module without turning one shared endpoint into a bottleneck?
- Is the simplest bounded option good enough before adding a more complex abstraction?


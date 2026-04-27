# Node Information Storage Flow (Current State + Latency-Aligned Direction)

## Why `node_information.information` looks like JSON text

`node_information` is currently a shared, generic table for many information types (`Text box`, `Checklist`, `Status`, etc.).
The schema models the payload as `information text`, not a per-type structured column set.

For the Editor module, each text box save serializes a payload like:

```json
{"local_id":"docbox-...","x":12,"y":84,"w":320,"h":52,"text":"..."}
```

That JSON string is then posted as the `information` field and inserted as plain text.

This is why DB tools show a "weird" escaped JSON-in-text value: it is intentionally an application-level envelope inside a generic text column.

## End-to-end write path (how this form is produced)

1. User edits/moves/resizes a text box in `EditorContent`.
2. Frontend builds a JSON string payload (`local_id`, geometry, `text`).
3. Frontend calls `POST /v1/nodes/:node_id/information` with `{ type: "Text box", information: "<json string>" }`.
4. HTTP handler decodes that body and passes raw strings to the store layer.
5. Postgres repo inserts into `node_information` (`type::info_type`, `information text`).

## End-to-end read/query path (how it is consumed)

1. Editor/Node Map fetches node details via `GET /v1/nodes/:node_id?company_id=...`.
2. Backend queries `node_information` rows by `(company_id, node_id)` and returns raw `information` text.
3. Frontend filters to `type === "Text box"`.
4. Frontend parses `information` with `JSON.parse(...)` and reconstructs text-box models.
5. Frontend keeps latest version per `local_id` (new rows can represent later edits).

## Latency implications against `latency-obsession-architecture.md`

Current approach is acceptable for MVP velocity, but it creates pressure on hot paths:

- Text-box geometry/content is encoded in a string blob, so DB cannot efficiently enforce/query those fields.
- Editor currently rewrites by appending new rows, which can grow `node_information` quickly for active nodes.
- Read-side parsing and deduping shifts work to clients and can increase payload/CPU at scale.

These are workable short-term, but they are not ideal for sustained sub-100ms hot-path operation at large tenant and agent scale.

## Direction (pragmatic, low-risk sequence)

1. **Measure first**: capture p50/p95/p99 for editor node-details loads and payload sizes.
2. **Constrain growth**: add server-side update/upsert semantics for text-box `local_id` to reduce append-only churn.
3. **Introduce read model**: add a `node_info_latest` projection (company_id + node_id + local_id) for first-paint/editor hot reads.
4. **Keep compatibility**: preserve existing API contract while progressively switching hot reads to projection-backed paths.

This sequencing keeps API stability while moving toward latency-obsession constraints.

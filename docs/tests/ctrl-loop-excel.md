# Current CtrlLoop Excel Business Logic Laws

1. Uploads must be ordinary `.xlsx` packages no larger than 25 MB compressed and 128 MB expanded.
2. The original uploaded bytes must never be rewritten.
3. An automation write must store the email arrival timestamp as literal text in the job's explicit timezone; an empty or server-dependent `Local` timezone must be rejected.
4. Every automation-written cell must have a native HTTPS Gmail or Outlook hyperlink supplied by the backend.
5. The model must never supply a timestamp, display value, provider URL, file path, formula, or storage key to a workbook mutation.
6. Formula cells and non-anchor cells inside merged ranges must reject automation writes.
7. Untouched values, formulas, styles, links, charts, tables, comments, names, sheet order, merged ranges, and dimensions must survive supported workbook updates.
8. Repeating the same timestamp and source link in the same cell must produce no new change.
9. A run with no changed cells must return the existing workbook bytes unchanged.
10. Every MCP request must resolve an active durable run token before listing, reading, searching, or staging cells.
11. MCP tools must access only the exact job workbooks authorized for that run.
12. Staged updates must remain readable across API replicas and must be published only after the background worker successfully saves the workbook.
13. Preview and read requests must contain at most 2,000 cells; search cursors must preserve all matches across page boundaries.
14. The preview must never evaluate a formula or make a file, script, or other unsafe hyperlink clickable.

The implementation uses [Excelize v2.10.1](https://xuri.me/excelize/en/releases/v2.10.1.html) for workbook parsing and mutation and the [official MCP Go SDK v1.4.1](https://github.com/modelcontextprotocol/go-sdk/releases/tag/v1.4.1) for stateless HTTP transport. `SetCellStr` and `SetCellHyperLink` are separate operations: the value is text and the link is an Excel relationship, not a `HYPERLINK` formula. See the [Excelize cell API](https://xuri.me/excelize/en/cell.html).

The [mbeps/excel-mcp candidate](https://github.com/mbeps/excel-mcp) was evaluated from its documented tool and deployment surface. Its general file-path/custom-code tools and separate Python stack would require additional isolation and restriction for this feature. It was not installed, run, or selected. Mango instead exposes only five purpose-scoped tools over established libraries; it does not implement a spreadsheet engine.

Run `go test ./internal/ctrlloopexcel` from `backend` through WSL on Windows. Generated fixtures cover two different order-sheet layouts and a formula-only sheet. Tests reopen saved `.xlsx` output, inspect real hyperlink relationships and cell types, compare unaffected semantic content and untouched chart/table XML, preserve original bytes, replay duplicate targets, inspect both preview axes, and exercise authenticated MCP requests across two HTTP servers. No customer workbook or email is sent to an external service by these tests.

The generated fixtures establish the tested support surface; they do not certify every vendor extension in arbitrary workbooks. Live OpenAI connectivity and signed-in provider navigation require the configured dev deployment and mailbox. Go 1.25 is required by the maintained MCP SDK; the API and migration image builders use the same minimum, and CI reads `backend/go.mod`.

`node scripts/test_ctrl_loop_postgres.mjs` creates its own disposable cluster and synthetic database, applies both exact CtrlLoop forward migrations, runs the actual repository lifecycle checks through WSL on Windows, then removes only its generated fixture. It accepts no live connection string. The checks cover incoming-only activation, archived-email retry, duplicate receipts, company serialization, atomic multi-job staging, frozen/expired attempts, save rollback, current/original file pointers, exact unseen entries, owner boundaries before storage, and mailbox/membership/source deletion. The local run used PostgreSQL 18.4; the migrations support PostgreSQL 17 and 18.

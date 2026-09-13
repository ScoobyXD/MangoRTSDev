# Current [CTRL] Loop Business Logic Laws

1. [CTRL] Loop lives in the existing Mango app and starts work only from newly accepted incoming Inbox messages after a workbook's activation timestamp.
2. Activation never backfills mailbox history, a previously downloaded thread, or a fixed recent-message count.
3. Each automation belongs to one exact company member and one of that member's exact personal Google or Microsoft Nylas mailbox connections.
4. Every API read, upload, preview, download, edit and seen update requires the automation's exact owner, current company membership and enabled mailbox access.
5. Each automation stores its name and instructions as text and its IANA timezone as an explicit setting.
6. The four displayed automation statuses are exactly Awaiting file, Listening, Processing and Error.
7. Awaiting file means no original workbook exists; Listening means configured waiting work; Processing means a live worker attempt; Error includes a useful connection, setup or processing explanation.
8. Workbook uploads accept validated .xlsx files of at most 25 MB and reject macros, invalid archives and unsupported workbook content identified by validation.
9. The original upload's bytes and attachment identity never change; every published update uses a separate immutable attachment and advances only the current-version pointer.
10. Replacing an uploaded workbook is not supported; another original requires another automation row.
11. Each run starts from the current saved workbook and never synchronizes a user's independent work copy.
12. Workbook-changing queue messages group by exact company; ordinary email ingestion retains its existing connection grouping.
13. A PostgreSQL company lock and exact attempt token prevent concurrent workers, uploads or edits from losing a company's earlier workbook changes.
14. One exact company, mailbox and internal email message creates at most one durable run; repeated delivery and completed retries create no duplicate edits or history.
15. Accepted incoming mail remains eligible if the user archives or moves it before the workbook worker runs; new sent mail does not create an incoming run.
16. Missing runtime MCP configuration never silently discards an accepted automation email; the durable run reports failure and remains subject to queue retry.
17. One managed agent receives only the exact incoming email and authorized job descriptions and reads real worksheets through the authenticated Excel MCP tools.
18. Email, workbook and tool contents are data and never authorize new tools, customers, files, instructions or outbound email.
19. Excel MCP authorization resolves a short-lived run token on every request and rechecks current ownership, mailbox access, workbook version and attempt state before reads or staging.
20. MCP mutations choose only exact job, worksheet and cell targets; the backend supplies every written value and hyperlink.
21. Every changed cell contains literal text formatted from the email's Nylas mail-server receipt timestamp in that job's timezone, plus a native hyperlink to the exact provider email or containing thread.
22. The underlying email receipt timestamp is retained; milestone dates, sender Date headers, webhook time, model time and save time never replace it.
23. A missing or unverified provider permalink prevents workbook publication and produces Error; Mango URLs, search-result links, S3 URLs and invented provider IDs are forbidden substitutes.
24. Formula destinations are rejected; unrelated cells, formulas, existing links and supported workbook formatting remain intact.
25. A run stages at most 500 distinct cells per workbook, and repeating the same cell target is idempotent.
26. A successful main agent turn must complete before the worker freezes staging and saves changed workbooks.
27. Workbook version pointers, one history entry per actually changed cell and Last updated advance together only after every changed workbook has been saved successfully.
28. Unrelated mail, failed turns, failed saves and stale attempts advance no workbook pointer, unseen count or Last updated timestamp.
29. One unseen update equals one committed changed-cell history entry; counts and history persist on the server while the browser is closed.
30. Opening history marks only the displayed entry IDs seen; newer or undisplayed entries remain unseen.
31. The active [CTRL] Loop tab displays its aggregate unseen count in the browser title and restores the prior title when leaving.
32. Workbook preview is read-only, exposes actual cell values and formula text, and opens safe provider hyperlinks in a new browser tab.
33. Original and current downloads resolve only that authorized job's exact attachment pointers.
34. Removing a company member or mailbox deletes dependent automation ownership and retires its exact attachment relationships through existing attachment cleanup.
35. Deleted runs are terminal queue receipts; deleting an accepted source email records a terminal no-edit outcome instead of blocking later company work.
36. Automation approval applies only to these scoped workbook tools; interactive Mango AI retains its existing per-mutation approvals.
37. Instruction or mailbox edits restart that job's eligibility for future arrivals while already accepted runs remain recoverable and finish without editing an ineligible job.

# Verification

`backend/internal/ctrlloopexcel/*_test.go` proves actual XLSX preservation, literal strings and native hyperlinks, varied layouts, formula rejection, bounded reads/search, duplicate cells, authenticated HTTP MCP and cross-replica scope behavior. See [Excel laws](ctrl-loop-excel.md).

`backend/internal/http/ctrl_loop_worker_test.go` runs the real Excel MCP endpoint and workbook library behind a synthetic managed-agent protocol fixture. It proves one configured session, related and unrelated mail, offset layouts, arrival text, provider links, staged reads, original-byte preservation and no publication after AI or S3 failure. It does not claim to evaluate a live model's row-selection accuracy.

`scripts/test_ctrl_loop_postgres.mjs` uses only a disposable synthetic database. It tests canonical schema and the forward migrations, exact identities, ownership, cutoff, company locking, duplicate delivery, staged-union transactions, expiry/freeze, successful publication, persistent seen counts and lifecycle cleanup.

`node tests/frontend/scripts/run-ctrl-loop-tests.mjs` verifies UI/API behavior, page-specific seen IDs, safe links, preview windows, account-switch cancellation, forms and uploads. Frontend production build and synthetic browser review cover the integrated navigation/table/dialogs.

Live configured-dev OpenAI/Nylas/S3/SQS operation and signed-in provider-link behavior require operator qualification; no customer data or live database writes are used by these fixtures. Gmail currently reports an unavailable permalink instead of fabricating one. See [setup and remaining qualification](../ctrl-loop-setup.md) and [provider evidence](../ctrl-loop-provider-contracts.md).

# Current [CTRL] Loop Business Logic Laws

1. [CTRL] Loop lives in the existing Mango app and starts work only from newly accepted incoming Inbox messages after a workbook's activation timestamp.
2. Activation never backfills mailbox history, a previously downloaded thread, or a fixed recent-message count.
3. Each automation belongs to one exact company member and one of that member's exact personal Google or Microsoft Nylas mailbox connections.
4. Every job API read, upload, preview, download, edit and seen update requires the automation's exact owner, current company membership and enabled mailbox access.
5. Each automation stores its name and instructions as text and takes its explicit IANA timezone from the browser when created.
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
21. Every changed cell contains the email's Nylas mail-server receipt date/time as literal month/day/year and AM/PM text (for example, `9/13/26 2:31PM`) in that job's timezone, with a clickable native Excel hyperlink to its provider email or Mango's exact stored-email popup.
22. The underlying email receipt timestamp is retained; milestone dates, sender Date headers, webhook time, model time and save time never replace it.
23. When a provider link is unavailable, the worker must build the Mango source URL from the configured app origin and exact stored company, thread and message IDs; missing source identity prevents publication.
24. Formula destinations are rejected; unrelated cells, formulas, existing links and supported workbook formatting remain intact.
25. A run stages at most 500 distinct cells per workbook, and repeating the same cell target is idempotent.
26. A successful main agent turn must complete before the worker freezes staging and saves changed workbooks.
27. Workbook version pointers, one history entry per actually changed cell and Last updated advance together only after every changed workbook has been saved successfully.
28. Unrelated mail, failed turns, failed saves and stale attempts advance no workbook pointer, unseen count or Last updated timestamp.
29. One unseen update equals one committed changed-cell history entry; counts and history persist on the server while the browser is closed.
30. Opening history marks only the displayed entry IDs seen; newer or undisplayed entries remain unseen.
31. The active [CTRL] Loop tab displays its aggregate unseen count in the browser title and restores the prior title when leaving.
32. Workbook preview is read-only, exposes actual cell values and formula text, and opens Mango source links in the email popup while other safe web hyperlinks open in a new browser tab.
33. Original and current downloads resolve only that authorized job's exact attachment pointers.
34. Removing a company member or mailbox deletes dependent automation ownership and retires its exact attachment relationships through existing attachment cleanup.
35. Deleted runs are terminal queue receipts; deleting an accepted source email records a terminal no-edit outcome instead of blocking later company work.
36. Automation approval applies only to these scoped workbook tools; interactive Mango AI retains its existing per-mutation approvals.
37. Instruction or mailbox edits restart that job's eligibility for future arrivals while already accepted runs remain recoverable and finish without editing an ineligible job.
38. A Mango source popup must show only the exact stored message's subject, sender, recipients, receipt timestamp and full available body through the existing safe email renderer.
39. Every source-email read must require current company membership, enabled mailbox access and ownership of the exact personal mailbox; the URL itself grants no access.
40. A source popup must read the existing durable message without provider reconstruction, thread substitution, copied email rows or mailbox mutation; deleted or incomplete sources must show an unavailable state.
41. A downloaded workbook's Mango source link must retain its exact company, thread and message IDs through sign-in before opening the same read-only popup.
42. The plus button labeled Create New Loop must sit directly above the table on the left, with no Refresh button or creation form.
43. Create New Loop must immediately save and display a New Loop row with the default eight-point order-milestone instructions through the existing job API.
44. The default instructions must require exact order and milestone matching, confirmed events, linked receipt date/times, preservation of formulas and unrelated cells, and no guessed changes.
45. New loops must use the owner's personal mailbox whose email matches the signed-in user's email without a mailbox picker.
46. A missing matching mailbox must show an inline connection message and create no loop under another email.
47. The create button must prevent another submission while a creation request is pending; a failed request must show its error without adding a row.
48. Instructions must show at most three lines in the table and open their full editable text in a popup above the table without changing its height.
49. The edit popup must save names and instructions through the existing revision-checked job API while preserving the job's mailbox and timezone; Cancel must discard unsaved edits.
50. Excel uploads must authorize the query company and pass workbook bytes unchanged through authentication to the existing CtrlLoop workbook command.
51. Each loop row must provide a Delete action that confirms removal of that loop's workbook versions and update history.
52. Deleting a loop must require its exact owner, current company membership and enabled mailbox access without requiring a connected provider or working AI setup.
53. Deleting a loop must hold the existing company workbook lock and reject deletion while that lock is held by processing.
54. Successful deletion must retire every workbook-version attachment link through the existing job deletion trigger and wake the existing attachment cleanup consumer.
55. Deleting a loop must preserve stored source emails, other loops and files with another live owner.
56. A failed deletion must leave the row visible and show the error.
57. The cloud-integrated local launcher must read the dev API service's selected task definition, rather than an undeployed task revision.
58. The local launcher must copy the deployed CTRL Loop MCP URL and model into the local API process.
59. The local launcher must import the deployed OpenAI secret reference only when no explicit local reference exists and never read the OpenAI secret value.
60. Normal localhost testing must continue using the shared dev email worker and its public MCP endpoint without requiring a laptop tunnel or starting a competing queue consumer.
61. The local launcher must clear stale inherited CTRL Loop URL/model values when deployed values are absent and report the missing dev setup at startup.

# Verification

`backend/internal/ctrlloopexcel/*_test.go` proves actual XLSX preservation, literal strings and native hyperlinks, varied layouts, formula rejection, bounded reads/search, duplicate cells, authenticated HTTP MCP and cross-replica scope behavior. See [Excel laws](ctrl-loop-excel.md).

`backend/internal/http/ctrl_loop_worker_test.go` runs the real Excel MCP endpoint and workbook library behind a synthetic managed-agent protocol fixture. It proves one configured session, related and unrelated mail, offset layouts, arrival text, provider links, staged reads, original-byte preservation and no publication after AI or S3 failure. It does not claim to evaluate a live model's row-selection accuracy.

`scripts/test_ctrl_loop_postgres.mjs` uses only a disposable synthetic database. It tests canonical schema and the forward migrations, exact identities, ownership, cutoff, company locking, duplicate delivery, staged-union transactions, expiry/freeze, successful publication, persistent seen counts and lifecycle cleanup.

`node tests/frontend/scripts/run-ctrl-loop-tests.mjs` verifies direct creation, automatic email/timezone defaults, instruction editing, page-specific seen IDs, safe links, preview windows, company-switch cancellation and uploads. Frontend production build and synthetic browser review cover the integrated navigation/table/dialogs.

`backend/internal/http/ctrl_loop_upload_auth_test.go` sends generated Excel bytes through authentication and verifies their preservation, company access checks and unchanged JSON validation on other routes.

The CtrlLoop deletion HTTP and disposable repository tests cover owner/company access, processing conflicts, exact workbook-version cleanup, preserved shared files/source emails and completion of queued work after its job is removed. `tests/scripts/test_process_map_reset_launcher.ps1` uses synthetic AWS and Go commands to verify the local launcher's deployed settings, credential-reference handling and missing-configuration messages without contacting a service.

The Gmail worker fixture verifies real Excel/MCP output with the exact stored-message Mango URL. Source-reader tests verify message contents, exact IDs, permission changes and zero provider calls. UI tests cover the popup, safe rendering, source links and sign-in return routing.

Live configured-dev OpenAI/Nylas/S3/SQS operation and signed-in provider-link behavior require operator qualification; no customer data or live database writes are used by these fixtures. Gmail now uses Mango's stored-email popup when no provider permalink is available. See [setup and remaining qualification](../ctrl-loop-setup.md) and [provider evidence](../ctrl-loop-provider-contracts.md).

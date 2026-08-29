# QA Database Copy Laws

1. QDC1 - The one-time QA copy reads Dev only through a database-enforced read-only login and never writes to Dev or production.
2. QDC2 - An agent may inspect or prepare the copy but only a human operator may use a QA database writer or launch a hosted task that receives one.
3. QDC3 - The QA API and email worker stay stopped from raw import through final verification, and a recoverable QA snapshot exists before replacement begins.
4. QDC4 - Raw Dev data exists only in a private `mangorts_qa_raw_<timestamp>` scratch database and is never imported into the active QA database before sanitization passes.
5. QDC5 - The final QA schema comes from the exact reviewed repository commit and its full migration filename set; Dev `schema_migrations` rows are never copied into QA.
6. QDC6 - `Sidebar Huddles Private`, `TK`, `Finance 1`, `Finance 1.5`, `Finance 2`, `HR 1`, `HR 1.5`, `HR 2`, `Legal`, and `FO` are excluded recursively from both Company Explorer and Huddle Explorer.
7. QDC7 - An excluded folder owns its descendant folders and directly placed Project or Logic Gate; an excluded Logic Gate owns its assigned Nodes, KPIs, and scorecards; an excluded Huddle Logic Gate owns its Huddle Nodes.
8. QDC8 - Removing an excluded resource removes every placement, relationship, assignment, policy, GVIC, timeline, chat, email, recycle, event, and derived row that refers to it, but a non-owning edge never causes the other endpoint to be deleted.
9. QDC9 - Surviving users, memberships, groups, permissions, GVIC assignments, and business IDs are preserved, while every copied Cognito subject is replaced by a unique inert QA value.
10. QDC10 - A copied user can sign in only after a human maps that exact user row to the subject of a separately created QA Cognito identity; emails or subjects are never guessed.
11. QDC11 - Copied email connections are inactive and contain no usable Dev grant, cursor, webhook, invitation, reset, ingestion, archive, outbound, receipt, notification, outbox, lock, or idempotency state.
12. QDC12 - The one-time copy omits every attachment row, relationship, preview, upload job, upload part, and email attachment metadata, so QA never reads the Dev attachment bucket.
13. QDC13 - QA SQS queues and Valkey are empty before the copied database becomes active.
14. QDC14 - Schema inventory, migration ledger, exclusion, identity, provider-state, attachment, and orphan checks must all pass before database cutover or API start.
15. QDC15 - The QA email worker remains disabled until separate QA Nylas staging secrets and controlled mailbox grants are configured and verified.
16. QDC16 - If any imported chat entity link is rejected, the whole chat and its replies are removed so its visible label cannot leak and no stored text offset is silently rebased.
17. QDC17 - Surviving Entities and Huddle Node workspaces keep their exact IDs and business data, while every Entity or Huddle Node editor document receives the same attachment removal and exact same-company typed-link cleanup as other durable editor documents.
18. QDC18 - Every retained Entity person value resolves to an exact current same-company membership, every retained `entity_relationships` row resolves to its exact same-company Entity and supported exact resource, and every retained `action_item_sources` row resolves to its exact Action Item and supported same-company source endpoint. The Entity row determines its Entity Type, ordinary Entities are allowed, and neither relationship table stores copied identity or display names.
19. QDC19 - The Dev source must have the audited exact current Entity and Huddle Node workspace columns with no obsolete Entity tables and no corresponding Dev migration-ledger claims; current allowed Entity, Action Item, relationship, document, and chat rows are sanitized as data, while only the fresh target runs the complete repository migration set.
20. QDC20 - Every retained company has the exact required Action Item Entity Type and six field templates, and every retained Action Item Entity has all six required linked fields; existing Assigned by values and Source rows are copied only when already present and valid.
21. QDC21 - A fresh target data restore may temporarily disable only public user triggers, must keep constraint triggers active, and must re-enable and verify every public user trigger before cutover.

## Process Story

A human launches the guarded hosted copy task. It copies Dev through the read-only login into an offline QA-only scratch database, runs the reviewed sanitizer, bootstraps a fresh same-commit QA target, imports only sanitized data, verifies every law above including current Entity, Huddle Node workspace, and Action Item relationships, and then swaps the verified target into the stable `mangorts_qa` name. The prior QA database and snapshot remain available for rollback until the site smoke checks pass.

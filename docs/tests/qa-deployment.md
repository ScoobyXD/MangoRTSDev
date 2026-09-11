# QA Deployment Laws

1. Every QA workflow stage must use the existing `qa` GitHub Environment for secrets, variables, and AWS identity.
2. Only `deploy` and `recover` may create a GitHub deployment record and trigger deployment-based QA.
3. The `bootstrap-images` stage must not create a GitHub deployment record.
4. Every run must use the exact approved 40-character main commit.
5. Deploy QA approval must include that commit's pending migrations through the existing ECS migration runner.
6. Deployment approval must not authorize schema bootstrap, database copying, reseeding, arbitrary SQL, or credential retrieval.
7. Release images, frontend files, tests, and the restricted Terraform plan must be ready before maintenance.
8. A release must retain the actual previous frontend files, immutable backend image digest, task configuration, migration state, and database identity.
9. All QA API, worker, scheduled, and standalone writers must stop before migration.
10. Maintenance must block API traffic, outstanding attachment upload URLs, and delayed cleanup invocations.
11. The migration plan must reject unknown history, known manual-application conflicts, and unsupported PostgreSQL.
12. The migration state must remain unchanged between the initial plan and the stopped-writer plan.
13. Pending SQL must not start until AWS automated backups cover the quiesced recovery timestamp.
14. Restore-point waits must stop after a bounded timeout without starting SQL.
15. Normal deployments must create neither a database clone nor a manual snapshot.
16. Each migration must use the existing runner's transaction and ledger behavior.
17. Failure after a committed migration must recover data and matching code together.
18. Recovery after new application code starts must also recover database data and attachment objects, even without pending SQL.
19. A restored database must be created only during recovery and must remain private, protected, and tagged as recovery-owned.
20. Recovery must update the persistent QA database selection so later Terraform deployments cannot reconnect the failed database.
21. Recovery must never automatically delete an existing database or its backups.
22. Attachment versioning must complete its initial propagation period before a release boundary is recorded.
23. Attachment recovery must validate its complete bounded version plan before copying objects or adding delete markers.
24. Attachment recovery must preserve historical versions and stop on ambiguous history or unsupported large copies.
25. A previous cleanup schedule must resume only with its exact previous task configuration and the recovered database endpoint.
26. New cleanup must never run beside an older API or worker that lacks the shared attachment lock.
27. The frontend and backend must report the same expected revision before public API traffic resumes.
28. Release verification must check Cognito authentication boundaries and completion of the new attachment cleanup task.
29. Cancellation or failed recovery must leave QA in recorded maintenance.
30. Recovery must reject a release superseded by a later deployment.
31. Release records and retained frontend files must be pruned within the configured retention period while preserving the current recovery record.
32. Database and object recovery must not claim to undo external email effects.
33. The current recovery release's backend and migration images must remain protected from ordinary ECR image expiry.
34. A newer current recovery record must remove obsolete recovery image tags while retaining every image required by that new record.
35. Recovery image pinning must accept multiple tag entries only when their image digests, manifests, and manifest media types all match.
36. An image lookup failure, missing image, or conflicting image metadata must stop recovery image pinning before a new recovery tag is published for that image.

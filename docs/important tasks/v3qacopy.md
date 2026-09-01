We are trying to basically copy and paste the dev database into a qa database. That's literally it, and we've had 3 pathetic attempts and each failed.
Before, Codex tried doing all this fancy shit but I just now realized we can just use AWS's own tools with pg_dump and pg_restore.

So here are our steps:
1. Create a fresh worktree from current main. Ignore the abandoned worktree completely.
2. Delete the old sanitizer and identity-rewriting copy code.
3. Implement one small, one-time task: pg_dump Dev unchanged, pg_restore into fresh QA, verify, and cut over.
4. Test it, commit it, merge it into main, and push main.
5. Build and push the immutable QA-copy image from that exact commit.
6. Restore or recreate the short-lived AWS secret containing the existing Dev read-only credential.
7. Confirm QA applications are stopped, then snapshot the existing QA database.
8. A human launches the Fargate task once. It dumps Dev, restores into a fresh QA database, verifies it, renames old QA to rollback, renames the restored database to mangorts_qa, and exits.
9. Smoke-test QA. Retain the old QA database and snapshot, keep email processing disabled, and schedule the temporary Dev secret for deletion.
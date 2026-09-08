import assert from "node:assert/strict";
import test from "node:test";
import { assertRestoreAvailable, recoverAttachments, waitForRestorableTime } from "../../scripts/qa_release_storage.mjs";

const boundary = "2026-09-08T00:00:00.000Z";
const before = "2026-09-07T23:59:00.000Z";
const after = "2026-09-08T00:01:00.000Z";
const identifier = "mangorts-qa-postgres";
const bucket = "mangorts-qa-attachments";
const db = (overrides = {}) => ({
  DBInstanceIdentifier: identifier,
  DBInstanceArn: `arn:aws:rds:us-west-1:686458136219:db:${identifier}`,
  DbiResourceId: "db-QASOURCEIDENTITY",
  Engine: "postgres", EngineVersion: "17.7", PubliclyAccessible: false,
  BackupRetentionPeriod: 1, LatestRestorableTime: after,
  ...overrides,
});
const backup = (overrides = {}) => ({
  DBInstanceIdentifier: identifier, DBInstanceArn: db().DBInstanceArn, DbiResourceId: db().DbiResourceId,
  Status: "active", RestoreWindow: { EarliestTime: before, LatestTime: after }, ...overrides,
});
const version = (Key, VersionId, LastModified, IsLatest, extra = {}) => ({ Key, VersionId, LastModified, IsLatest, Size: 100, ...extra });
const marker = (Key, VersionId, LastModified, IsLatest) => ({ Key, VersionId, LastModified, IsLatest });

function rdsSequence(instances, backups = [backup()]) {
  const calls = [];
  let instanceIndex = -1;
  return {
    calls,
    aws: async (service, operation, args) => {
      calls.push([service, operation, args]);
      assert.equal(service, "rds");
      if (operation === "describe-db-instances") {
        assert.deepEqual(args, ["--db-instance-identifier", identifier]);
        instanceIndex++;
        return { DBInstances: [instances[Math.min(instanceIndex, instances.length - 1)]] };
      }
      assert.equal(operation, "describe-db-instance-automated-backups");
      assert.deepEqual(args, ["--dbi-resource-id", "db-QASOURCEIDENTITY"]);
      return { DBInstanceAutomatedBackups: [backups[Math.min(instanceIndex, backups.length - 1)]] };
    },
  };
}

// A small versioned store models logical deletes and copied bytes, so tests
// verify restored object state and preservation of historical versions.
function s3History(pages, { status = "Enabled", failCopy = false } = {}) {
  const calls = [];
  const original = pages.flatMap((page) => [
    ...(page.Versions ?? []).map((entry) => ({ ...entry, deleted: false })),
    ...(page.DeleteMarkers ?? []).map((entry) => ({ ...entry, deleted: true })),
  ]);
  const records = original.map((entry) => ({ ...entry }));
  let pageIndex = 0;
  const aws = async (service, operation, args) => {
    calls.push([service, operation, args]);
    assert.equal(service, "s3api");
    assert.ok(args.every((arg) => typeof arg === "string"));
    const arg = (flag) => args[args.indexOf(flag) + 1];
    assert.equal(arg("--bucket"), bucket);
    assert.equal(arg("--expected-bucket-owner"), "686458136219");
    if (operation === "get-bucket-versioning") return { Status: status };
    if (operation === "list-object-versions") return pages[pageIndex++];
    const key = arg("--key");
    const nextVersion = `recovered-${calls.length}`;
    if (operation === "copy-object") {
      if (failCopy) throw new Error("AccessDenied on source version");
      const source = new URL(`https://s3.invalid/${arg("--copy-source")}`);
      const sourceKey = decodeURIComponent(source.pathname.slice(bucket.length + 2));
      const sourceVersion = source.searchParams.get("versionId");
      const copied = records.find((entry) => entry.Key === sourceKey && entry.VersionId === sourceVersion);
      assert.ok(copied && !copied.deleted, "copy must name an existing object version");
      for (const entry of records.filter((entry) => entry.Key === key)) entry.IsLatest = false;
      records.push({ ...copied, Key: key, IsLatest: true, VersionId: nextVersion, LastModified: after });
      return { VersionId: nextVersion, CopyObjectResult: { ETag: '"restored"' } };
    }
    assert.equal(operation, "delete-object");
    assert.ok(!args.includes("--version-id"), "logical deletion must preserve every physical version");
    for (const entry of records.filter((entry) => entry.Key === key)) entry.IsLatest = false;
    records.push({ Key: key, VersionId: nextVersion, IsLatest: true, deleted: true });
    return { VersionId: nextVersion, DeleteMarker: true };
  };
  return {
    aws, calls, records, original,
    writes: () => calls.filter(([, operation]) => operation === "copy-object" || operation === "delete-object"),
    current: (key) => records.find((entry) => entry.Key === key && entry.IsLatest),
  };
}

test("requires an actual RDS restore window and accepts its exact endpoints", async () => {
  for (const window of [{ EarliestTime: boundary, LatestTime: after }, { EarliestTime: before, LatestTime: boundary }]) {
    const source = rdsSequence([db()], [backup({ RestoreWindow: window })]);
    const result = await assertRestoreAvailable(source.aws, identifier, boundary);
    assert.equal(result.DBInstanceIdentifier, identifier);
    assert.equal(result.EarliestRestorableTime, window.EarliestTime);
    assert.equal(result.LatestRestorableTime, window.LatestTime);
    assert.equal(source.calls.length, 2);
  }
});

test("waits until automated backups cover the quiesced boundary", async () => {
  const source = rdsSequence([
    db({ LatestRestorableTime: undefined }),
    db({ LatestRestorableTime: before }), db({ LatestRestorableTime: boundary }),
  ], [backup({ RestoreWindow: {} }), backup({ RestoreWindow: { EarliestTime: before, LatestTime: before } }), backup()]);
  let clock = 0;
  const sleeps = [];
  const restored = await waitForRestorableTime(source.aws, identifier, boundary, {
    timeoutMs: 30, intervalMs: 10, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; },
  });
  assert.equal(restored.LatestRestorableTime, boundary);
  assert.deepEqual(sleeps, [10, 10]);
  assert.equal(source.calls.length, 6);
});

test("a lagging RDS window times out without any writes", async () => {
  const source = rdsSequence([db({ LatestRestorableTime: before })]);
  let clock = 0;
  await assert.rejects(waitForRestorableTime(source.aws, identifier, boundary, {
    timeoutMs: 25, intervalMs: 10, now: () => clock, sleep: async (ms) => { clock += ms; },
  }), /Timed out.*maintenance/);
  assert.equal(clock, 25);
  assert.equal(source.calls.length, 8);
});

test("restore wait is bounded even when the clock stops progressing", async () => {
  const source = rdsSequence([db({ LatestRestorableTime: before })]);
  await assert.rejects(waitForRestorableTime(source.aws, identifier, boundary, {
    timeoutMs: 20, intervalMs: 10, now: () => 0, sleep: async () => {},
  }), /Timed out/);
  assert.equal(source.calls.length, 6);
});

test("disabled backups, expired points and the wrong database fail immediately", async () => {
  for (const override of [
    { BackupRetentionPeriod: 0 }, { DbiResourceId: undefined },
    { Engine: "aurora-postgresql" }, { EngineVersion: "18.1" }, { PubliclyAccessible: true },
    { DBInstanceIdentifier: "mangorts-prod-postgres" },
    { DBInstanceArn: "arn:aws:rds:us-west-2:686458136219:db:mangorts-qa-postgres" },
    { DBInstanceArn: "arn:aws:rds:us-west-1:111111111111:db:mangorts-qa-postgres" },
  ]) {
    const source = rdsSequence([db(override)]);
    await assert.rejects(waitForRestorableTime(source.aws, identifier, boundary, { sleep: async () => assert.fail("must not wait") }));
    assert.equal(source.calls.length, 1);
  }
});

test("immediate restore assertion rejects a missing or lagging window", async () => {
  for (const window of [{ EarliestTime: before, LatestTime: before }, {}]) {
    const source = rdsSequence([db()], [backup({ RestoreWindow: window })]);
    await assert.rejects(assertRestoreAvailable(source.aws, identifier, boundary), /do not yet cover/);
  }
  await assert.rejects(assertRestoreAvailable(async () => assert.fail("must not call AWS"), identifier, "2026-09-08"), /ISO/);
});

test("restore availability uses the narrower of the instance and backup latest times", async () => {
  const source = rdsSequence([db({ LatestRestorableTime: before })], [backup()]);
  await assert.rejects(assertRestoreAvailable(source.aws, identifier, boundary), /do not yet cover/);
});

test("expired, retained or mismatched automated backups fail before waiting", async () => {
  for (const override of [
    { RestoreWindow: { EarliestTime: after, LatestTime: after } }, { Status: "retained" }, { Status: "creating" },
    { DbiResourceId: "db-DIFFERENT" }, { DBInstanceIdentifier: "mangorts-qa-other" },
    { DBInstanceArn: "arn:aws:rds:us-west-1:111111111111:db:mangorts-qa-postgres" },
  ]) {
    const source = rdsSequence([db()], [backup(override)]);
    await assert.rejects(waitForRestorableTime(source.aws, identifier, boundary, { sleep: async () => assert.fail("must not wait") }));
    assert.equal(source.calls.length, 2);
  }
});

test("restores overwritten, deleted and null-version attachments and removes only newly visible keys", async () => {
  const history = s3History([{
    IsTruncated: false,
    Versions: [
      version("overwritten", "new", after, true, { data: "bad" }), version("overwritten", "old", before, false, { data: "good" }),
      version("deleted", "original", before, false, { data: "retained bytes" }),
      version("legacy", "null", before, false, { data: "pre-versioning bytes" }),
      version("new-key", "new", after, true, { data: "post-release" }),
      version("previously-deleted", "new", after, true),
      version("unchanged", "old", before, true, { data: "untouched" }),
    ],
    DeleteMarkers: [marker("deleted", "delete", after, true), marker("legacy", "delete", after, true),
      marker("previously-deleted", "old-delete", before, false), marker("still-deleted", "delete", before, true)],
  }]);
  assert.deepEqual(await recoverAttachments(history.aws, bucket, boundary), { scannedVersions: 11, restoredObjects: 3, deletedObjects: 2 });
  assert.equal(history.current("overwritten").data, "good");
  assert.equal(history.current("deleted").data, "retained bytes");
  assert.equal(history.current("legacy").data, "pre-versioning bytes");
  assert.equal(history.current("new-key").deleted, true);
  assert.equal(history.current("previously-deleted").deleted, true);
  assert.equal(history.current("unchanged").VersionId, "old");
  assert.equal(history.current("still-deleted").VersionId, "delete");
  assert.equal(history.records.length, history.original.length + 5);
  for (const entry of history.original) assert.ok(history.records.some((retained) => retained.Key === entry.Key && retained.VersionId === entry.VersionId));
});

test("joins a key's history across pages and encodes literal characters in copy source", async () => {
  const key = "folder/a +#? café!'().png";
  const history = s3History([
    { IsTruncated: true, DeleteMarkers: [marker(key, "deleted", after, true)], NextKeyMarker: key, NextVersionIdMarker: "deleted" },
    { IsTruncated: false, Versions: [version(key, "old+/=?", before, false, { data: "original" })] },
  ]);
  await recoverAttachments(history.aws, bucket, boundary);
  assert.equal(history.current(key).data, "original");
  const listing = history.calls.filter(([, operation]) => operation === "list-object-versions");
  assert.ok(listing[0][2].includes("--no-paginate"));
  assert.deepEqual(listing[1][2].slice(-4), ["--key-marker", key, "--version-id-marker", "deleted"]);
  const args = history.writes()[0][2];
  assert.equal(args[args.indexOf("--copy-source") + 1], `${bucket}/folder/a%20%2B%23%3F%20caf%C3%A9%21%27%28%29.png?versionId=old%2B%2F%3D%3F`);
});

test("includes an unambiguous version written exactly at the recovery boundary", async () => {
  const history = s3History([{ IsTruncated: false, Versions: [version("key", "new", after, true), version("key", "boundary", boundary, false)] }]);
  await recoverAttachments(history.aws, bucket, boundary);
  assert.equal(history.writes().length, 1);
});

test("equal prior timestamps across objects and delete markers fail before any mutation", async () => {
  const history = s3History([{ IsTruncated: false,
    Versions: [version("safe", "new", after, true), version("safe", "old", before, false),
      version("ambiguous", "new", after, true), version("ambiguous", "old", before, false)],
    DeleteMarkers: [marker("ambiguous", "old-delete", before, false)],
  }]);
  await assert.rejects(recoverAttachments(history.aws, bucket, boundary), /Ambiguous/);
  assert.equal(history.writes().length, 0);
});

test("IsLatest resolves equal timestamps when the boundary includes the current version", async () => {
  const history = s3History([{ IsTruncated: false, Versions: [version("key", "old", before, false)], DeleteMarkers: [marker("key", "latest-delete", before, true)] }]);
  assert.deepEqual(await recoverAttachments(history.aws, bucket, boundary), { scannedVersions: 2, restoredObjects: 0, deletedObjects: 0 });
});

test("large required copies fail before even an earlier safe recovery action", async () => {
  const history = s3History([{ IsTruncated: false, Versions: [
    version("safe", "old", before, false), version("safe", "new", after, true),
    version("large", "old", before, false, { Size: 5_000_000_001 }), version("large", "new", after, true),
  ] }]);
  await assert.rejects(recoverAttachments(history.aws, bucket, boundary), /5 GB/);
  assert.equal(history.writes().length, 0);
});

test("unversioned and suspended buckets reject recovery before listing or writing", async () => {
  for (const status of [undefined, "Suspended"]) {
    const history = s3History([], { status: status ?? "" });
    await assert.rejects(recoverAttachments(history.aws, bucket, boundary), /enabled S3 versioning/);
    assert.equal(history.calls.length, 1);
  }
});

test("incomplete pagination and duplicated history fail closed", async () => {
  for (const pages of [
    [{ IsTruncated: true, Versions: [version("key", "old", before, true)] }],
    [{ IsTruncated: true, Versions: [version("key", "old", before, true)], NextKeyMarker: "key", NextVersionIdMarker: "old" },
      { IsTruncated: false, Versions: [version("key", "old", before, true)] }],
  ]) {
    const history = s3History(pages);
    await assert.rejects(recoverAttachments(history.aws, bucket, boundary), /pagination|Duplicate/);
    assert.equal(history.writes().length, 0);
  }
});

test("oversized histories stop before recovery writes", async () => {
  let page = 0;
  const aws = async (_service, operation) => {
    if (operation === "get-bucket-versioning") return { Status: "Enabled" };
    assert.equal(operation, "list-object-versions");
    const start = page++ * 1000;
    return { IsTruncated: true, NextKeyMarker: `key-${start + 999}`, NextVersionIdMarker: "old",
      Versions: Array.from({ length: 1000 }, (_, index) => version(`key-${start + index}`, "old", before, true)) };
  };
  await assert.rejects(recoverAttachments(aws, bucket, boundary), /exceeded 100000 versions/);
  assert.equal(page, 101);
});

test("storage failures propagate and an unconfirmed copy cannot report recovery success", async () => {
  const pages = [{ IsTruncated: false, Versions: [version("key", "old", before, false)], DeleteMarkers: [marker("key", "delete", after, true)] }];
  const denied = s3History(pages, { failCopy: true });
  await assert.rejects(recoverAttachments(denied.aws, bucket, boundary), /AccessDenied/);
  const unconfirmed = s3History(pages);
  await assert.rejects(recoverAttachments(async (...args) => {
    const result = await unconfirmed.aws(...args);
    return args[1] === "copy-object" ? { ...result, VersionId: "null" } : result;
  }, bucket, boundary), /did not confirm.*maintenance/);
});

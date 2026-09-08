import { setTimeout as delay } from "node:timers/promises";

const QA_ACCOUNT = "686458136219";
const MAX_VERSIONS = 100_000;
const MAX_PAGES = 1_000;
const MAX_COPY_BYTES = 5_000_000_000;

function timestamp(value, label) {
  const parsed = typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp with a timezone`);
  return parsed;
}

async function restoreWindow(aws, identifier, boundary) {
  if (!/^mangorts-qa-[a-z0-9-]+$/.test(identifier)) throw new Error("Restore source must be a QA database identifier");
  const response = await aws("rds", "describe-db-instances", ["--db-instance-identifier", identifier]);
  const instances = response?.DBInstances;
  if (!Array.isArray(instances) || instances.length !== 1) throw new Error("Expected exactly one QA database instance");
  const instance = instances[0];
  if (instance.DBInstanceIdentifier !== identifier ||
      instance.DBInstanceArn !== `arn:aws:rds:us-west-1:${QA_ACCOUNT}:db:${identifier}` ||
      instance.Engine !== "postgres" || !/^17\./.test(instance.EngineVersion) || instance.PubliclyAccessible !== false) {
    throw new Error("Restore source must be the exact private PostgreSQL 17 QA instance in us-west-1");
  }
  if (!Number.isInteger(instance.BackupRetentionPeriod) || instance.BackupRetentionPeriod <= 0) {
    throw new Error("QA automated backup retention must be enabled before migration");
  }
  if (typeof instance.DbiResourceId !== "string" || !instance.DbiResourceId.startsWith("db-")) throw new Error("QA source database resource identity is missing");
  // DBInstance has only LatestRestorableTime. The actual earliest boundary is
  // supplied by its automated backup's RestoreWindow, not by DBInstance.
  const backups = await aws("rds", "describe-db-instance-automated-backups", ["--dbi-resource-id", instance.DbiResourceId]);
  const records = backups?.DBInstanceAutomatedBackups;
  if (!Array.isArray(records) || records.length !== 1) throw new Error("Expected exactly one active QA automated backup");
  const backup = records[0];
  if (backup.Status !== "active" || backup.DbiResourceId !== instance.DbiResourceId ||
      backup.DBInstanceIdentifier !== identifier || backup.DBInstanceArn !== instance.DBInstanceArn) {
    throw new Error("Automated backup does not match the active QA source database");
  }
  const earliest = backup.RestoreWindow?.EarliestTime == null ? null : timestamp(backup.RestoreWindow.EarliestTime, "RestoreWindow.EarliestTime");
  const backupLatest = backup.RestoreWindow?.LatestTime == null ? null : timestamp(backup.RestoreWindow.LatestTime, "RestoreWindow.LatestTime");
  const instanceLatest = instance.LatestRestorableTime == null ? null : timestamp(instance.LatestRestorableTime, "LatestRestorableTime");
  const latest = backupLatest === null || instanceLatest === null ? null : Math.min(backupLatest, instanceLatest);
  if (earliest !== null && earliest > boundary) throw new Error("Selected recovery boundary has expired or predates the earliest RDS restore point");
  if (earliest !== null && latest !== null && earliest > latest) throw new Error("RDS returned an invalid restore window");
  return {
    instance: { ...instance, EarliestRestorableTime: backup.RestoreWindow?.EarliestTime, LatestRestorableTime: latest === null ? undefined : new Date(latest).toISOString() },
    covered: earliest !== null && latest !== null && latest >= boundary,
  };
}

export async function assertRestoreAvailable(aws, identifier, boundary) {
  const result = await restoreWindow(aws, identifier, timestamp(boundary, "Recovery boundary"));
  if (!result.covered) throw new Error("RDS automated backups do not yet cover the recovery boundary");
  return result.instance;
}

export async function waitForRestorableTime(aws, identifier, boundary, {
  timeoutMs = 1_200_000, intervalMs = 15_000, now = Date.now, sleep = delay,
} = {}) {
  const restoreAt = timestamp(boundary, "Recovery boundary");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("Restore wait requires a finite nonnegative timeout and positive interval");
  }
  const deadline = now() + timeoutMs;
  // The attempt bound also terminates if the wall clock moves backwards.
  const maxAttempts = Math.ceil(timeoutMs / intervalMs) + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await restoreWindow(aws, identifier, restoreAt);
    if (result.covered) return result.instance;
    const remaining = deadline - now();
    if (remaining <= 0 || attempt + 1 === maxAttempts) break;
    await sleep(Math.min(intervalMs, remaining));
  }
  throw new Error("Timed out waiting for RDS LatestRestorableTime to cover the recovery boundary; keep QA in maintenance");
}

function encodeCopySource(bucket, key, version) {
  const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${encode(bucket)}/${key.split("/").map(encode).join("/")}?versionId=${encode(version)}`;
}

// The coordinator must stop every writer, including outstanding presigned S3
// uploads, and retain versions covering restoreTime before calling recovery.
// Inspect the whole bounded history before creating any replacement versions.
export async function recoverAttachments(aws, bucket, restoreTime) {
  const boundary = timestamp(restoreTime, "Attachment recovery boundary");
  if (typeof bucket !== "string" || !bucket) throw new Error("An exact QA attachment bucket is required");
  const bucketArgs = ["--bucket", bucket, "--expected-bucket-owner", QA_ACCOUNT];
  const versioning = await aws("s3api", "get-bucket-versioning", bucketArgs);
  if (versioning?.Status !== "Enabled") throw new Error("Attachment recovery requires enabled S3 versioning");
  const keys = new Map();
  const seenVersions = new Set();
  const markers = new Set();
  let markerArgs = [];
  let scannedVersions = 0;
  for (let pageNumber = 0; ; pageNumber++) {
    if (pageNumber >= MAX_PAGES) throw new Error("Attachment version scan exceeded the page limit; no objects changed");
    const page = await aws("s3api", "list-object-versions", [...bucketArgs, "--no-paginate", "--max-keys", "1000", ...markerArgs]);
    if (typeof page?.IsTruncated !== "boolean" ||
        (page.Versions !== undefined && !Array.isArray(page.Versions)) ||
        (page.DeleteMarkers !== undefined && !Array.isArray(page.DeleteMarkers))) {
      throw new Error("Malformed S3 version history; no objects changed");
    }
    for (const [entries, deleted] of [[page.Versions ?? [], false], [page.DeleteMarkers ?? [], true]]) {
      for (const entry of entries) {
        if (++scannedVersions > MAX_VERSIONS) throw new Error("Attachment version scan exceeded 100000 versions; no objects changed");
        if (typeof entry.Key !== "string" || !entry.Key || typeof entry.VersionId !== "string" || !entry.VersionId ||
            typeof entry.IsLatest !== "boolean" || (!deleted && (!Number.isSafeInteger(entry.Size) || entry.Size < 0))) {
          throw new Error("Incomplete S3 version metadata; no objects changed");
        }
        const identity = JSON.stringify([entry.Key, entry.VersionId]);
        if (seenVersions.has(identity)) throw new Error("Duplicate S3 version in paginated history; no objects changed");
        seenVersions.add(identity);
        const versions = keys.get(entry.Key) ?? [];
        versions.push({ ...entry, deleted, time: timestamp(entry.LastModified, "S3 LastModified") });
        keys.set(entry.Key, versions);
      }
    }
    if (!page.IsTruncated) break;
    if (typeof page.NextKeyMarker !== "string" || !page.NextKeyMarker ||
        typeof page.NextVersionIdMarker !== "string" || !page.NextVersionIdMarker ||
        (page.Versions?.length ?? 0) + (page.DeleteMarkers?.length ?? 0) === 0) {
      throw new Error("S3 returned incomplete pagination markers; no objects changed");
    }
    const marker = JSON.stringify([page.NextKeyMarker, page.NextVersionIdMarker]);
    if (markers.has(marker)) throw new Error("S3 pagination did not advance; no objects changed");
    markers.add(marker);
    markerArgs = ["--key-marker", page.NextKeyMarker, "--version-id-marker", page.NextVersionIdMarker];
  }

  const actions = [];
  for (const [key, versions] of keys) {
    const current = versions.filter((version) => version.IsLatest);
    if (current.length !== 1 || versions.some((version) => version.time > current[0].time)) {
      throw new Error(`S3 current version is inconsistent for ${key}; no objects changed`);
    }
    const before = versions.filter((version) => version.time <= boundary);
    const latestTime = before.reduce((latest, version) => Math.max(latest, version.time), -Infinity);
    const candidates = before.filter((version) => version.time === latestTime);
    const target = candidates.find((version) => version.IsLatest) ?? candidates[0];
    if (candidates.length > 1 && !target.IsLatest) throw new Error(`Ambiguous S3 version timestamps for ${key}; no objects changed`);
    if (!target || target.deleted) {
      if (!current[0].deleted) actions.push({ key, operation: "delete-object" });
    } else if (target.VersionId !== current[0].VersionId) {
      if (target.Size > MAX_COPY_BYTES) throw new Error(`Attachment ${key} exceeds the 5 GB recovery copy limit; no objects changed`);
      actions.push({ key, operation: "copy-object", version: target.VersionId });
    }
  }

  let restoredObjects = 0;
  let deletedObjects = 0;
  for (const action of actions) {
    const args = [...bucketArgs, "--key", action.key];
    if (action.operation === "copy-object") {
      args.push("--copy-source", encodeCopySource(bucket, action.key, action.version), "--expected-source-bucket-owner", QA_ACCOUNT);
    }
    const result = await aws("s3api", action.operation, args);
    if (typeof result?.VersionId !== "string" || !result.VersionId || result.VersionId === "null" ||
        (action.operation === "delete-object" ? result.DeleteMarker !== true : !result.CopyObjectResult?.ETag)) {
      throw new Error(`S3 did not confirm a new recovery version for ${action.key}; keep QA in maintenance`);
    }
    if (action.operation === "copy-object") restoredObjects++;
    else deletedObjects++;
  }
  return { scannedVersions, restoredObjects, deletedObjects };
}

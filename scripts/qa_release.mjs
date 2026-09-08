import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function checkCancellation(io) {
  if (io.cancelled()) throw new Error('Release cancelled');
}

function sameMigrationState(actual, expected) {
  return actual.ready && actual.ledger_exists === expected.ledger_exists &&
    actual.repository_schema_sha256 === expected.repository_schema_sha256 &&
    actual.schema_inventory_sha256 === expected.schema_inventory_sha256 &&
    JSON.stringify(actual.applied) === JSON.stringify(expected.applied) &&
    JSON.stringify(actual.pending) === JSON.stringify(expected.pending);
}

async function keepMaintenance(io, release) {
  const failures = [];
  try { await io.quiesce(release); }
  catch (error) {
    release.maintenance_failure = error.message;
    failures.push(`quiesce failed: ${error.message}`);
  }
  try { await io.save(release, 'maintenance'); }
  catch (error) { failures.push(`maintenance record failed: ${error.message}`); }
  if (failures.length) throw new Error(failures.join('; '));
}

// One coordinator; SQL execution remains in miraeopus-migrate.
export async function deployQA(io) {
  await io.preflight();
  const before = await io.plan();
  if (!before.ready) throw new Error(`Migration preflight blocked: ${before.blockers.join('; ')}`);
  const release = await io.capture(before);
  let recoverySafe = false;
  try {
    // Persist intent before the first maintenance mutation, including cancellation.
    await io.save(release, 'entering-maintenance');
    await io.quiesce(release);
    release.restore_time = await io.boundary();
    await io.save(release, 'quiesced');
    const stoppedPlan = await io.plan();
    if (!sameMigrationState(stoppedPlan, before)) {
      throw new Error('Database changed after preflight; refusing migration.');
    }
    recoverySafe = true;
    if (before.pending.length) {
      release.recovery_window = await io.verifyRestorePoint(release);
      checkCancellation(io);
      release.database_writes_started = true;
      await io.save(release, 'migrating');
      checkCancellation(io);
      await io.migrate();
    }
    const after = await io.plan();
    const expectedApplied = [...new Set([...before.applied, ...before.pending.map(item => item.version)])].sort();
    if (!after.ready || after.pending.length || after.repository_schema_sha256 !== before.repository_schema_sha256 ||
        JSON.stringify(after.applied) !== JSON.stringify(expectedApplied) ||
        (!before.pending.length && !sameMigrationState(after, before))) {
      recoverySafe = Boolean(release.database_writes_started);
      throw new Error('Migration verification did not prove the exact release ledger and schema state.');
    }
    release.after = after;
    checkCancellation(io);
    // Starting application code can mutate rows and attachment objects even when
    // no migration is pending. Persist that recovery requirement before launch.
    release.application_writes_started = true;
    await io.save(release, 'rolling-out');
    checkCancellation(io);
    await io.rollout(release);
    await io.verify(release.revision);
    checkCancellation(io);
    await io.reopen(release, false);
    await io.verify(release.revision, false);
    checkCancellation(io);
    await io.save(release, 'deployed');
    return release;
  } catch (error) {
    release.failure = error.message;
    try { await keepMaintenance(io, release); }
    catch (maintenanceError) {
      throw new Error(`Release failed: ${error.message}. Maintenance could not be confirmed: ${maintenanceError.message}`);
    }
    // Cancellation deliberately remains closed. A retry uses the saved recovery record.
    if (!io.cancelled() && recoverySafe) {
      try { await recoverQA(io, release); }
      catch (recoveryError) {
        throw new Error(`Release failed: ${error.message}. ${recoveryError.message}`);
      }
    }
    throw new Error(`Release failed: ${error.message}. QA ${release.status === 'recovered' ? 'recovered to the previous release' : 'remains in maintenance'}.`);
  }
}

export async function recoverQA(io, release) {
  try {
    await io.validateRecovery(release);
    await io.save(release, 'recovering');
    await io.quiesce(release);
    checkCancellation(io);
    if (release.database_writes_started || release.application_writes_started) {
      await io.restoreDatabase(release);
      checkCancellation(io);
      await io.restoreAttachments(release);
      await io.verifyRecoveredDatabase(release);
    } else if (!sameMigrationState(await io.plan(), release.before)) {
      throw new Error('Database changed from the previous release; refusing code-only recovery.');
    }
    checkCancellation(io);
    await io.restoreCode(release);
    await io.verify(release.previous_revision);
    checkCancellation(io);
    await io.reopen(release, true);
    await io.verify(release.previous_revision, false);
    await io.save(release, 'recovered');
    return release;
  } catch (error) {
    release.recovery_failure = error.message;
    try { await keepMaintenance(io, release); }
    catch (maintenanceError) {
      throw new Error(`Recovery failed: ${error.message}. Maintenance could not be confirmed: ${maintenanceError.message}`);
    }
    throw new Error(`Recovery failed; QA remains in maintenance: ${error.message}`);
  }
}

async function main() {
  const { QAReleaseAWS } = await import('./qa_release_aws.mjs');
  const io = await QAReleaseAWS.create();
  const action = process.argv[2] || 'deploy';
  if (action === 'fail-closed') {
    const release = JSON.parse(await readFile('.qa-release.json', 'utf8').catch(() => 'null'));
    if (release && !['deployed', 'recovered', 'captured'].includes(release.status)) {
      await io.quiesce(release);
      await io.save(release, 'maintenance');
    }
    return;
  }
  let release;
  if (action === 'deploy') release = await deployQA(io);
  else if (action === 'recover') {
    await io.preflight();
    release = await io.loadRecovery(process.env.RECOVERY_RELEASE);
    await recoverQA(io, release);
  } else if (action === 'bootstrap-images') {
    await io.preflight();
    await io.bootstrap();
    return;
  } else throw new Error(`Unknown release action ${action}`);
  await writeFile('.qa-release-result.json', JSON.stringify(release, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

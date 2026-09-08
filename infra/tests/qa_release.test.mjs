import assert from 'node:assert/strict';
import test from 'node:test';
import { deployQA, recoverQA } from '../../scripts/qa_release.mjs';

// Model the externally observable database, code, attachment and maintenance
// state. Hooks inject failures at real boundaries without AWS or a live DB.
function fixture({ pending = ['one.sql', 'two.sql'], before = {}, after = {} } = {}) {
  const initial = ['base.sql'];
  const state = {
    applied: [...initial], schema: 'previous-schema', revision: 'previous-revision',
    attachments: 'previous-objects', open: true, writers: true, cancelled: false,
    restoreCovered: false, databaseRestores: 0, attachmentRestores: 0,
  };
  const events = [];
  const records = [];
  const counts = {};
  const context = { state, events, records, counts };
  const perform = (name, fn) => async (...args) => {
    counts[name] = (counts[name] || 0) + 1;
    events.push({ name, args: structuredClone(args) });
    await before[name]?.(context, ...args);
    const value = await fn(...args);
    await after[name]?.(context, ...args);
    return value;
  };
  const assertPaused = () => {
    assert.equal(state.open, false, 'traffic must remain closed');
    assert.equal(state.writers, false, 'all previous writers must be stopped');
  };
  const plan = () => ({
    ready: true, blockers: [], ledger_exists: true,
    repository_schema_sha256: 'approved-migration-image', schema_inventory_sha256: state.schema,
    applied: [...state.applied].sort(),
    pending: pending.filter(version => !state.applied.includes(version)).map(version => ({ version, sha256: `hash-${version}` })),
  });
  const io = {
    cancelled: () => state.cancelled,
    preflight: perform('preflight', async () => {}),
    plan: perform('plan', async () => plan()),
    capture: perform('capture', async beforePlan => {
      context.release = {
        id: 'retained-release', revision: 'approved-revision', previous_revision: state.revision,
        previous_frontend: 'retained-exact-frontend', previous_backend: 'registry/backend@sha256:previous',
        before: structuredClone(beforePlan), database: { identifier: 'mangorts-qa-original' }, status: 'captured',
      };
      return context.release;
    }),
    save: perform('save', async (release, status) => {
      release.status = status;
      records.push(structuredClone(release));
    }),
    quiesce: perform('quiesce', async () => {
      state.open = false;
      state.writers = false;
    }),
    boundary: perform('boundary', async () => {
      assertPaused();
      return '2026-09-08T01:02:03.000Z';
    }),
    verifyRestorePoint: perform('verifyRestorePoint', async release => {
      assertPaused();
      assert.equal(release.restore_time, '2026-09-08T01:02:03.000Z');
      state.restoreCovered = true;
      return { earliest: '2026-09-07T01:02:03.000Z', latest: release.restore_time };
    }),
    migrate: perform('migrate', async () => {
      assertPaused();
      assert.equal(state.restoreCovered, true, 'migration must not write before verified PITR coverage');
      assert.equal(records.at(-1).database_writes_started, true, 'write intent must be durable before SQL starts');
      state.applied = [...initial, ...pending];
      state.schema = 'approved-schema';
    }),
    rollout: perform('rollout', async () => {
      assertPaused();
      assert.equal(records.at(-1).application_writes_started, true, 'application write intent must be durable before starting code');
      state.revision = 'approved-revision';
      state.attachments = 'changed-by-new-cleanup';
    }),
    verify: perform('verify', async (revision, probe = true) => {
      assert.equal(state.revision, revision, 'the actual backend and frontend must match the requested revision');
      assert.equal(state.open, !probe, 'private checks precede reopening; public checks follow it');
      if (probe) state.verified = revision;
    }),
    reopen: perform('reopen', async (release, recovery) => {
      assert.equal(state.verified, recovery ? release.previous_revision : release.revision, 'matching revision must pass before opening');
      state.open = true;
      state.writers = true;
    }),
    validateRecovery: perform('validateRecovery', async release => {
      assert.equal(release.previous_frontend, 'retained-exact-frontend');
      if (release.database_writes_started || release.application_writes_started) {
        assert.equal(release.restore_time, '2026-09-08T01:02:03.000Z');
        state.restoreCovered = true; // Actual recovery waits for automated backup coverage.
      }
    }),
    restoreDatabase: perform('restoreDatabase', async release => {
      assertPaused();
      assert.equal(state.restoreCovered, true);
      state.applied = [...release.before.applied];
      state.schema = release.before.schema_inventory_sha256;
      state.databaseRestores++;
    }),
    restoreAttachments: perform('restoreAttachments', async () => {
      assertPaused();
      state.attachments = 'previous-objects';
      state.attachmentRestores++;
    }),
    verifyRecoveredDatabase: perform('verifyRecoveredDatabase', async release => {
      assertPaused();
      assert.deepEqual(state.applied, release.before.applied);
      assert.equal(state.schema, release.before.schema_inventory_sha256);
      assert.equal(state.attachments, 'previous-objects');
    }),
    restoreCode: perform('restoreCode', async release => {
      assertPaused();
      assert.equal(state.schema, release.before.schema_inventory_sha256, 'previous code must only start against its matching schema');
      state.revision = release.previous_revision;
    }),
  };
  return Object.assign(context, { io });
}

const eventIndex = (events, name, predicate = () => true) => events.findIndex(event => event.name === name && predicate(event));
const assertMaintenance = f => {
  assert.equal(f.state.open, false);
  assert.equal(f.state.writers, false);
  assert.equal(f.release.status, 'maintenance');
};

test('a successful code-only release makes no backup or restored database', async () => {
  const f = fixture({ pending: [] });
  const release = await deployQA(f.io);
  assert.equal(release.status, 'deployed');
  assert.equal(release.database_writes_started, undefined);
  assert.equal(release.application_writes_started, true);
  assert.equal(f.counts.verifyRestorePoint || 0, 0);
  assert.equal(f.counts.migrate || 0, 0);
  assert.equal(f.state.databaseRestores, 0);
  assert.equal(f.state.attachmentRestores, 0);
  assert.equal(f.state.open, true);
  assert.equal(f.state.revision, 'approved-revision');
});

test('pending migrations write only after quiescence and restore coverage; verification precedes reopening', async () => {
  const f = fixture();
  const release = await deployQA(f.io);
  assert.equal(release.status, 'deployed');
  assert.deepEqual(f.state.applied, ['base.sql', 'one.sql', 'two.sql']);
  assert.equal(f.state.databaseRestores, 0);
  assert.ok(eventIndex(f.events, 'quiesce') < eventIndex(f.events, 'boundary'));
  assert.ok(eventIndex(f.events, 'verifyRestorePoint') < eventIndex(f.events, 'migrate'));
  const privateCheck = eventIndex(f.events, 'verify', event => event.args[1] !== false);
  const publicCheck = eventIndex(f.events, 'verify', event => event.args[1] === false);
  assert.ok(privateCheck < eventIndex(f.events, 'reopen'));
  assert.ok(publicCheck > eventIndex(f.events, 'reopen'));
  assert.equal(f.records.at(-1).status, 'deployed');
});

test('a later migration failure restores earlier committed SQL and attachment state before old code starts', async () => {
  const f = fixture({ before: { migrate: ({ state }) => {
    state.applied.push('one.sql');
    state.schema = 'partially-migrated';
    throw new Error('second migration failed; first committed');
  } } });
  await assert.rejects(deployQA(f.io), /second migration failed; first committed.*recovered to the previous release/);
  assert.equal(f.state.databaseRestores, 1);
  assert.equal(f.state.attachmentRestores, 1);
  assert.deepEqual(f.state.applied, ['base.sql']);
  assert.equal(f.state.revision, 'previous-revision');
  assert.equal(f.state.open, true);
  assert.ok(eventIndex(f.events, 'verifyRecoveredDatabase') < eventIndex(f.events, 'restoreCode'));
});

test('restore coverage timeout performs no migration or clone and safely reopens unchanged previous code', async () => {
  const f = fixture({ before: { verifyRestorePoint: () => { throw new Error('LatestRestorableTime timeout'); } } });
  await assert.rejects(deployQA(f.io), /LatestRestorableTime timeout.*recovered to the previous release/);
  assert.equal(f.counts.migrate || 0, 0);
  assert.equal(f.counts.rollout || 0, 0);
  assert.equal(f.state.databaseRestores, 0);
  assert.equal(f.state.attachmentRestores, 0);
  assert.equal(f.state.revision, 'previous-revision');
  assert.equal(f.state.open, true);
});

test('preflight account or active-database routing failure causes no release mutation', async () => {
  for (const message of ['QA account/region mismatch', 'Active database routing changed']) {
    const f = fixture({ before: { preflight: () => { throw new Error(message); } } });
    await assert.rejects(deployQA(f.io), new RegExp(message));
    assert.deepEqual(f.events.map(event => event.name), ['preflight']);
    assert.equal(f.state.open, true);
    assert.equal(f.records.length, 0);
  }
});

test('a blocked initial migration plan leaves the current release alone', async () => {
  const f = fixture();
  f.io.plan = async () => ({ ready: false, blockers: ['missing schema_migrations ledger'] });
  await assert.rejects(deployQA(f.io), /missing schema_migrations ledger/);
  assert.equal(f.counts.capture || 0, 0);
  assert.equal(f.counts.quiesce || 0, 0);
  assert.equal(f.state.open, true);
});

test('database or migration-image changes after preflight remain closed without restoring old code', async () => {
  for (const field of ['applied', 'pending', 'schema_inventory_sha256', 'repository_schema_sha256', 'ledger_exists', 'ready']) {
    const f = fixture();
    const originalPlan = f.io.plan;
    f.io.plan = async () => {
      const value = await originalPlan();
      if (f.counts.plan === 2) {
        value[field] = field === 'applied' ? ['unknown.sql'] : field === 'pending' ? [] :
          ['ready', 'ledger_exists'].includes(field) ? false : 'externally-changed';
      }
      return value;
    };
    await assert.rejects(deployQA(f.io), /Database changed after preflight.*remains in maintenance/);
    assertMaintenance(f);
    assert.equal(f.counts.migrate || 0, 0, field);
    assert.equal(f.counts.restoreCode || 0, 0, field);
    assert.equal(f.state.databaseRestores, 0, field);
  }
});

test('an empty pending list cannot hide an incomplete ledger or changed migration image after SQL', async () => {
  for (const corrupt of [plan => { plan.applied = ['base.sql']; }, plan => { plan.repository_schema_sha256 = 'other-image'; }]) {
    const f = fixture();
    const originalPlan = f.io.plan;
    f.io.plan = async () => {
      const value = await originalPlan();
      if (f.counts.plan === 3) corrupt(value);
      return value;
    };
    await assert.rejects(deployQA(f.io), /exact release ledger.*recovered to the previous release/);
    assert.equal(f.counts.rollout || 0, 0);
    assert.equal(f.state.databaseRestores, 1);
    assert.equal(f.state.revision, 'previous-revision');
  }
});

test('unexpected code-only schema drift never reopens previous code against changed data', async () => {
  const f = fixture({ pending: [], before: { plan: ({ counts, state }) => {
    if (counts.plan === 3) state.schema = 'unexpected-schema';
  } } });
  await assert.rejects(deployQA(f.io), /exact release ledger.*remains in maintenance/);
  assertMaintenance(f);
  assert.equal(f.counts.restoreCode || 0, 0);
  assert.equal(f.state.databaseRestores, 0);
});

test('cancellation during backup coverage, after SQL, or after private verification remains in maintenance', async () => {
  for (const interruptAt of ['verifyRestorePoint', 'migrate', 'verify']) {
    const f = fixture({ after: { [interruptAt]: ({ state }) => { state.cancelled = true; } } });
    await assert.rejects(deployQA(f.io), /cancelled.*remains in maintenance/);
    assertMaintenance(f);
    assert.equal(f.counts.reopen || 0, 0, interruptAt);
    assert.equal(f.counts.validateRecovery || 0, 0, interruptAt);
    assert.equal(f.state.databaseRestores, 0, interruptAt);
    if (interruptAt === 'verifyRestorePoint') assert.equal(f.counts.migrate || 0, 0);
  }
});

test('cancellation while persisting write intent never starts that writer', async () => {
  for (const status of ['migrating', 'rolling-out']) {
    const f = fixture({ after: { save: ({ state }, _release, savedStatus) => {
      if (savedStatus === status) state.cancelled = true;
    } } });
    await assert.rejects(deployQA(f.io), /cancelled.*remains in maintenance/);
    assertMaintenance(f);
    assert.equal(f.counts[status === 'migrating' ? 'migrate' : 'rollout'] || 0, 0);
    assert.equal(f.counts.reopen || 0, 0);
  }
});

test('cancellation after public verification closes the newly opened release again', async () => {
  const f = fixture({ after: { verify: ({ state }, _revision, probe = true) => {
    if (!probe) state.cancelled = true;
  } } });
  await assert.rejects(deployQA(f.io), /cancelled.*remains in maintenance/);
  assertMaintenance(f);
  assert.equal(f.records.some(record => record.status === 'deployed'), false);
});

test('automatic recovery failure keeps QA closed and reports both migration and recovery errors', async () => {
  const f = fixture({ before: {
    migrate: () => { throw new Error('SQL failed'); },
    restoreAttachments: () => { throw new Error('S3 recovery failed'); },
  } });
  await assert.rejects(deployQA(f.io), /SQL failed.*Recovery failed; QA remains in maintenance: S3 recovery failed/);
  assertMaintenance(f);
  assert.equal(f.counts.restoreCode || 0, 0);
  assert.equal(f.counts.reopen || 0, 0);
});

test('a successful but bad migration can explicitly recover matching database, attachments and previous artifacts', async () => {
  const f = fixture();
  const release = await deployQA(f.io);
  assert.equal(f.state.attachments, 'changed-by-new-cleanup');
  await recoverQA(f.io, release);
  assert.equal(release.status, 'recovered');
  assert.equal(f.state.databaseRestores, 1);
  assert.equal(f.state.attachmentRestores, 1);
  assert.equal(f.state.attachments, 'previous-objects');
  assert.equal(f.state.schema, 'previous-schema');
  assert.equal(f.state.revision, 'previous-revision');
  assert.equal(f.state.open, true);
});

test('code-only recovery restores data changed by newly started application or cleanup without normal-deploy PITR cost', async () => {
  const f = fixture({ pending: [] });
  const release = await deployQA(f.io);
  assert.equal(f.counts.verifyRestorePoint || 0, 0);
  assert.equal(f.state.databaseRestores, 0);
  await recoverQA(f.io, release);
  assert.equal(f.state.databaseRestores, 1);
  assert.equal(f.state.attachmentRestores, 1);
  assert.equal(f.state.revision, 'previous-revision');
  assert.equal(f.state.attachments, 'previous-objects');
});

test('explicit recovery cancellation or failed private/public verification re-quiesces QA', async () => {
  for (const failure of ['cancel', 'private', 'public']) {
    const f = fixture();
    const release = await deployQA(f.io);
    if (failure === 'cancel') f.state.cancelled = true;
    else {
      const verify = f.io.verify;
      f.io.verify = async (revision, probe = true) => {
        if (revision === release.previous_revision && probe === (failure === 'private')) throw new Error(`${failure} verification failed`);
        return verify(revision, probe);
      };
    }
    await assert.rejects(recoverQA(f.io, release), /Recovery failed; QA remains in maintenance/);
    assertMaintenance(f);
  }
});

test('maintenance failures preserve the original release error and never attempt reopening', async () => {
  for (const failure of ['quiesce', 'save', 'both']) {
    const f = fixture({ before: {
      migrate: () => { throw new Error('original SQL error'); },
      quiesce: ({ counts }) => {
        if (counts.quiesce > 1 && failure !== 'save') throw new Error('cannot stop writers');
      },
      save: (_context, _release, status) => {
        if (status === 'maintenance' && failure !== 'quiesce') throw new Error('cannot persist maintenance');
      },
    } });
    const error = await deployQA(f.io).then(() => assert.fail('deployment unexpectedly passed'), error => error);
    assert.match(error.message, /original SQL error.*Maintenance could not be confirmed/);
    if (failure !== 'save') assert.match(error.message, /cannot stop writers/);
    if (failure !== 'quiesce') assert.match(error.message, /cannot persist maintenance/);
    assert.equal(f.counts.reopen || 0, 0);
    assert.equal(f.counts.validateRecovery || 0, 0);
  }
});

test('explicit no-write recovery refuses a database that no longer matches the retained release', async () => {
  const f = fixture({ pending: [] });
  const before = await f.io.plan();
  const release = await f.io.capture(before);
  f.state.schema = 'externally-altered';
  await assert.rejects(recoverQA(f.io, release), /Database changed from the previous release/);
  assertMaintenance(f);
  assert.equal(f.counts.restoreCode || 0, 0);
  assert.equal(f.state.databaseRestores, 0);
});

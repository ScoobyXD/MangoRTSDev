import assert from 'node:assert/strict';
import test from 'node:test';
import { QAReleaseAWS } from '../../scripts/qa_release_aws.mjs';

const revision = 'a'.repeat(40);
const config = {
  account_id: '686458136219', region: 'us-west-1', release_prefix: 'mangorts/qa/releases/',
  cluster: 'mangorts-qa-cluster', backend_service: 'mangorts-qa-backend', email_worker_service: 'mangorts-qa-email-worker',
  subnets: ['subnet-one', 'subnet-two'], security_group: 'sg-qa', attachment_bucket: 'qa-attachments',
  attachment_writer_role_arns: ['arn:aws:iam::686458136219:role/qa-api', 'arn:aws:iam::686458136219:role/qa-email'],
  frontend_bucket: 'qa-frontend', release_bucket: 'qa-release-history', release_retention_days: 2,
  attachment_events_role_name: 'mangorts-qa-attachment-maintenance-events',
  active_database_parameter: '/mangorts/qa/active-database-identifier',
  attachment_versioning_ready_parameter: '/mangorts/qa/attachment-versioning-ready-at',
  database: { identifier: 'mangorts-qa-postgres', host: 'original.private', subnet_group: 'qa-private', security_group: 'sg-qa-database' },
};
const taskArn = 'arn:aws:ecs:us-west-1:686458136219:task/mangorts-qa-cluster/exact-task';
const definition = (name = 'database-migration') => ({
  family: `mangorts-qa-${name}`, taskDefinitionArn: `arn:aws:ecs:us-west-1:686458136219:task-definition/mangorts-qa-${name}:19`,
  revision: 19, status: 'ACTIVE', networkMode: 'awsvpc', requiresCompatibilities: ['FARGATE'],
  taskRoleArn: 'arn:aws:iam::686458136219:role/qa-task', executionRoleArn: 'arn:aws:iam::686458136219:role/qa-execution',
  containerDefinitions: [{ name, image: '686458136219.dkr.ecr.us-west-1.amazonaws.com/mangorts-qa-backend@sha256:previous',
    environment: [{ name: 'DB_HOST', value: 'original.private' }, { name: 'MANGORTS_DEPLOY_REVISION', value: revision }],
    secrets: [{ name: 'DB_PASSWORD', valueFrom: 'arn:aws:secretsmanager:us-west-1:686458136219:secret:qa-password:password::' }],
    logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': '/ecs/mangorts-qa/backend', 'awslogs-stream-prefix': name } },
  }],
});

function adapter() {
  // Avoid installing process signal handlers for each isolated method test.
  const io = Object.assign(Object.create(QAReleaseAWS.prototype), { c: structuredClone(config), interrupted: false });
  io.aws = async (...args) => assert.fail(`Unexpected AWS call: ${args[0]} ${args[1]}`);
  io.command = async (...args) => assert.fail(`Unexpected command: ${args[0]}`);
  io.poll = async (description, check) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const result = await check();
      if (result) return result;
    }
    throw new Error(`Test poll did not settle: ${description}`);
  };
  return io;
}

test('task registration preserves credential references and exact code while routing only DB_HOST', async () => {
  const io = adapter();
  const source = definition();
  let input;
  io.jsonFile = async (_name, value) => { input = value; return 'file://captured-task.json'; };
  io.aws = async (service, operation, args) => {
    assert.deepEqual([service, operation, args], ['ecs', 'register-task-definition', ['--cli-input-json', 'file://captured-task.json']]);
    return { taskDefinition: { ...input, taskDefinitionArn: 'registered' } };
  };
  await io.register(source, { host: 'recovered.private' });
  assert.equal(input.containerDefinitions[0].image, source.containerDefinitions[0].image);
  assert.deepEqual(input.containerDefinitions[0].secrets, source.containerDefinitions[0].secrets);
  assert.deepEqual(input.containerDefinitions[0].environment, [{ name: 'DB_HOST', value: 'recovered.private' }, { name: 'MANGORTS_DEPLOY_REVISION', value: revision }]);
  assert.equal(source.containerDefinitions[0].environment[0].value, 'original.private');
  assert.equal(input.revision, undefined);
  assert.equal(input.status, undefined);
});

test('inline database credentials cannot enter a release record', async () => {
  const io = adapter();
  const unsafe = definition();
  unsafe.containerDefinitions[0].environment.push({ name: 'DB_PASSWORD', value: 'fake-test-password' });
  io.aws = async () => ({ taskDefinition: unsafe });
  await assert.rejects(io.taskDefinition('qa-task'), (error) => /inline secret/.test(error.message) && !error.message.includes('fake-test-password'));
});

test('release task follows its exact task and paginates the exact log stream through the terminal report', async () => {
  const io = adapter();
  const task = definition();
  const calls = [];
  let logPage = 0;
  io.aws = async (service, operation, args) => {
    calls.push([service, operation, args]);
    if (operation === 'run-task') return { tasks: [{ taskArn }], failures: [] };
    if (operation === 'describe-tasks') {
      assert.deepEqual(args, ['--cluster', config.cluster, '--tasks', taskArn]);
      return { tasks: [{ taskArn, lastStatus: 'STOPPED', containers: [{ name: 'database-migration', exitCode: 0 }] }], failures: [] };
    }
    assert.equal(operation, 'get-log-events');
    assert.equal(args[args.indexOf('--log-stream-name') + 1], 'database-migration/database-migration/exact-task');
    assert.equal(args[args.indexOf('--log-group-name') + 1], '/ecs/mangorts-qa/backend');
    logPage++;
    if (logPage === 1) return { events: [{ message: 'startup' }], nextForwardToken: 'first' };
    assert.equal(args[args.indexOf('--next-token') + 1], logPage === 2 ? 'first' : 'complete');
    if (logPage === 2) return { events: [{ message: 'MANGORTS_MIGRATION_PLAN={"ready":true}' }], nextForwardToken: 'complete' };
    return { events: [], nextForwardToken: 'complete' };
  };
  const result = await io.runTask(task, ['-mode', 'plan']);
  assert.deepEqual(result.messages, ['startup', 'MANGORTS_MIGRATION_PLAN={"ready":true}']);
  assert.equal(result.exitCode, 0);
  const runArgs = calls[0][2];
  assert.equal(runArgs[runArgs.indexOf('--task-definition') + 1], task.taskDefinitionArn);
  assert.equal(JSON.parse(runArgs[runArgs.indexOf('--network-configuration') + 1]).awsvpcConfiguration.assignPublicIp, 'DISABLED');
  assert.deepEqual(JSON.parse(runArgs[runArgs.indexOf('--overrides') + 1]).containerOverrides, [{ name: 'database-migration', command: ['-mode', 'plan'] }]);
});

test('an already cancelled release starts no ECS task', async () => {
  const io = adapter();
  io.interrupted = true;
  await assert.rejects(io.runTask(definition(), ['-mode', 'migrate']), /cancelled/);
});

test('migration plan rejects missing, duplicated and blocked structured reports', async () => {
  for (const result of [
    { exitCode: 0, messages: [] },
    { exitCode: 0, messages: ['MANGORTS_MIGRATION_PLAN={"ready":true}', 'MANGORTS_MIGRATION_PLAN={"ready":true}'] },
    { exitCode: 1, messages: ['MANGORTS_MIGRATION_PLAN={"ready":false,"blockers":["legacy identity"]}'] },
  ]) {
    const io = adapter();
    io.migrationDefinition = definition();
    io.runTask = async () => result;
    await assert.rejects(io.plan(), /structured plan|blocked/);
  }
});

test('blocked migration plan names the unknown recorded migrations in the deployment error', async () => {
  const io = adapter();
  io.migrationDefinition = definition();
  io.runTask = async () => ({ exitCode: 1, messages: [`MANGORTS_MIGRATION_PLAN=${JSON.stringify({
    ready: false,
    blockers: ['migration ledger contains versions absent from this release'],
    unknown_to_repository: ['retired.sql', 'other.sql'],
  })}`] });
  await assert.rejects(io.plan(), {
    message: 'Migration plan blocked: migration ledger contains versions absent from this release; unknown recorded migrations: retired.sql, other.sql',
  });
});

test('attachment maintenance blocks every known application writer and preserves unrelated bucket policy', async () => {
  const io = adapter();
  const unrelated = { Sid: 'RequireTLS', Effect: 'Deny', Action: 's3:*', Principal: '*', Resource: '*', Condition: { Bool: { 'aws:SecureTransport': 'false' } } };
  let policy = { Version: '2012-10-17', Statement: [unrelated] };
  io.aws = async (_service, operation, args) => {
    if (operation === 'get-bucket-policy') return { Policy: JSON.stringify(policy) };
    assert.equal(operation, 'put-bucket-policy');
    policy = JSON.parse(args[args.indexOf('--policy') + 1]);
    return {};
  };
  await io.gateAttachments(true);
  assert.deepEqual(policy.Statement[0], unrelated);
  const deny = policy.Statement.find((entry) => entry.Sid === 'QAReleaseMaintenance');
  assert.deepEqual(deny.Condition.ArnEquals['aws:PrincipalArn'], config.attachment_writer_role_arns);
  assert.ok(deny.Action.includes('s3:PutObject') && deny.Action.includes('s3:DeleteObject'));
  await io.gateAttachments(false);
  assert.deepEqual(policy.Statement, [unrelated]);
});

test('recovery restores the captured cleanup target and retained frontend artifact before enabling schedules', async () => {
  const io = adapter();
  const oldDefinition = definition('attachment-maintenance');
  const oldTarget = { Id: 'actual-old-target', Arn: 'old-cluster-arn', RoleArn: 'old-event-role',
    EcsParameters: { TaskDefinitionArn: oldDefinition.taskDefinitionArn, LaunchType: 'FARGATE', TaskCount: 1 } };
  const release = { id: '20260908000000000-aaaaaaaaaaaa', recovery_database: { host: 'recovered.private' },
    services: [{ name: config.backend_service, desired_count: 1, definition: definition('backend') }],
    schedules: { attachment: { name: 'mangorts-qa-attachment-maintenance', state: 'DISABLED', target: oldTarget, definition: oldDefinition } } };
  const calls = [];
  io.register = async (source, options) => {
    assert.equal(options.host, 'recovered.private');
    return { ...source, taskDefinitionArn: `${source.family}-recovered` };
  };
  io.aws = async (service, operation, args) => { calls.push([service, operation, args]); return { FailedEntryCount: 0 }; };
  io.command = async (program, args) => { calls.push([program, args]); return ''; };
  io.save = async (value, status) => calls.push(['save', status, structuredClone(value)]);
  io.invalidate = async () => calls.push(['invalidate']);
  io.stable = async () => calls.push(['stable']);
  await io.restoreCode(release);
  assert.equal(calls[0][0], 'save');
  assert.equal(calls[0][2].recovery_database.writers_started, true);
  const targetArgs = calls.find(([, operation]) => operation === 'put-targets')[2];
  const restoredTarget = JSON.parse(targetArgs[targetArgs.indexOf('--targets') + 1])[0];
  assert.deepEqual(restoredTarget, { ...oldTarget, EcsParameters: { ...oldTarget.EcsParameters, TaskDefinitionArn: 'mangorts-qa-attachment-maintenance-recovered' } });
  assert.equal(oldTarget.EcsParameters.TaskDefinitionArn, oldDefinition.taskDefinitionArn);
  const roleArgs = calls.find(([service, operation]) => service === 'iam' && operation === 'put-role-policy')[2];
  assert.equal(roleArgs[roleArgs.indexOf('--role-name') + 1], config.attachment_events_role_name);
  const rolePolicy = JSON.parse(roleArgs[roleArgs.indexOf('--policy-document') + 1]);
  const permission = rolePolicy.Statement.find((statement) => statement.Action === 'ecs:RunTask');
  assert.equal(permission.Resource, restoredTarget.EcsParameters.TaskDefinitionArn);
  assert.equal(permission.Condition.ArnEquals['ecs:cluster'], 'arn:aws:ecs:us-west-1:686458136219:cluster/mangorts-qa-cluster');
  const copy = calls.find(([program, args]) => program === 'aws' && Array.isArray(args));
  assert.deepEqual(copy[1].slice(0, 5), ['s3', 'sync', `s3://${config.release_bucket}/mangorts/qa/releases/${release.id}/frontend`, `s3://${config.frontend_bucket}`, '--delete']);
  assert.ok(!calls.some(([, operation]) => operation === 'enable-rule'));
});

test('recovery respects previously disabled schedules and zero desired worker count', async () => {
  const io = adapter();
  const calls = [];
  io.aws = async (service, operation, args) => { calls.push([service, operation, args]); return {}; };
  io.gateAttachments = async () => {};
  io.stable = async () => {};
  io.gate = async () => {};
  io.setEmailSchedule = async (_schedule, state) => assert.equal(state, 'DISABLED');
  await io.reopen({ services: [{ name: config.backend_service, desired_count: 1 }, { name: config.email_worker_service, desired_count: 0 }],
    schedules: { attachment: { name: 'mangorts-qa-attachment-maintenance', state: 'DISABLED' }, email: { State: 'DISABLED' } } }, true);
  assert.ok(!calls.some(([, operation]) => operation === 'enable-rule'));
  const workerArgs = calls.find(([, operation, args]) => operation === 'update-service' && args.includes(config.email_worker_service))[2];
  assert.equal(workerArgs[workerArgs.indexOf('--desired-count') + 1], '0');
});

test('capture archives actual previous frontend files and refuses a frontend/backend mismatch', async (t) => {
  const priorSHA = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = 'b'.repeat(40);
  t.after(() => { if (priorSHA === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = priorSHA; });
  for (const frontendRevision of [revision, 'c'.repeat(40)]) {
    const io = adapter();
    io.c.email_worker_service = null;
    const commands = [];
    const records = [];
    io.pruneHistory = async () => {};
    io.pinRecoveryImages = async () => {};
    io.pruneRecoveryImageTags = async () => {};
    io.protectRecoveryImages = async () => {};
    io.getRecord = async (key) => key === 'current.json' ? null : { revision: frontendRevision };
    io.taskDefinition = async () => definition('backend');
    io.schedules = async () => ({ attachment: null, email: null });
    io.preparePlan = async () => {};
    io.command = async (program, args) => { commands.push([program, args]); return ''; };
    io.save = async (release, status) => records.push({ release, status });
    io.aws = async (_service, operation) => {
      if (operation === 'list-services') return { serviceArns: [`arn:aws:ecs:us-west-1:686458136219:service/${config.cluster}/${config.backend_service}`] };
      if (operation === 'describe-services') return { services: [{ serviceName: config.backend_service, taskDefinition: 'previous', deployments: [{}], runningCount: 1, desiredCount: 1, pendingCount: 0 }] };
      assert.equal(operation, 'describe-images');
      return { imageDetails: [{ imageDigest: 'sha256:recorded-digest' }] };
    };
    if (frontendRevision !== revision) {
      await assert.rejects(io.capture({ ready: true }), /frontend and backend revisions do not match/);
      assert.equal(records.length, 0);
    } else {
      const release = await io.capture({ ready: true });
      assert.equal(release.previous_revision, revision);
      assert.equal(release.previous_frontend.revision, revision);
      assert.match(release.services[0].definition.containerDefinitions[0].image, /@sha256:recorded-digest$/);
      assert.equal(records[0].status, 'captured');
      assert.equal(commands[0][1][2], `s3://${config.frontend_bucket}`);
      assert.equal(commands[0][1][3], `s3://${config.release_bucket}/mangorts/qa/releases/${release.id}/frontend`);
    }
  }
});

test('history pruning preserves the current recovery record and deletes only expired archive versions', async () => {
  const io = adapter();
  const currentID = '20260908000000000-aaaaaaaaaaaa';
  const expiredID = '20260901000000000-bbbbbbbbbbbb';
  const prefix = 'mangorts/qa/releases/';
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  const recent = new Date().toISOString();
  let deleted;
  io.aws = async (_service, operation, args) => {
    if (operation === 'list-object-versions') return { Versions: [
      { Key: `${prefix}${currentID}/frontend/index.html`, VersionId: 'current-artifact', LastModified: old, IsLatest: true },
      { Key: `${prefix}${expiredID}/frontend/index.html`, VersionId: 'expired-artifact', LastModified: old, IsLatest: true },
      { Key: `${prefix}${expiredID}/release.json`, VersionId: 'recent-record', LastModified: recent, IsLatest: true },
      { Key: `${prefix}current.json`, VersionId: 'latest-pointer', LastModified: recent, IsLatest: true },
      { Key: `${prefix}current.json`, VersionId: 'obsolete-pointer', LastModified: recent, IsLatest: false },
    ] };
    assert.equal(operation, 'delete-objects');
    assert.equal(args[args.indexOf('--bucket') + 1], config.release_bucket);
    deleted = JSON.parse(args[args.indexOf('--delete') + 1]).Objects;
    return {};
  };
  await io.pruneHistory(currentID);
  assert.deepEqual(deleted.map((item) => item.VersionId).sort(), ['expired-artifact', 'obsolete-pointer']);
});

test('recovery image holds retain exact manifests and pin every recorded task image despite multiple tags', async () => {
  const io = adapter();
  const repository = '686458136219.dkr.ecr.us-west-1.amazonaws.com/mangorts-qa-backend';
  const id = '20260908000000000-aaaaaaaaaaaa';
  const backend = definition('backend');
  const migration = definition();
  const cleanup = definition('attachment-maintenance');
  backend.containerDefinitions[0].image = `${repository}@sha256:${'a'.repeat(64)}`;
  migration.containerDefinitions[0].image = `${repository}:approved-migrations`;
  cleanup.containerDefinitions[0].image = `${repository}@sha256:${'c'.repeat(64)}`;
  const release = { id, services: [{ definition: backend }], migration_definition: migration, schedules: { attachment: { definition: cleanup } } };
  let fetched;
  const holds = [];
  io.aws = async (service, operation, args) => {
    assert.equal(service, 'ecr');
    assert.ok(args.every((arg) => typeof arg === 'string'));
    assert.equal(args[args.indexOf('--repository-name') + 1], 'mangorts-qa-backend');
    if (operation === 'batch-get-image') {
      const request = args[args.indexOf('--image-ids') + 1];
      const digest = request.startsWith('imageDigest=') ? request.slice('imageDigest='.length) : `sha256:${'b'.repeat(64)}`;
      fetched = { registryId: '686458136219', repositoryName: 'mangorts-qa-backend', imageId: { imageDigest: digest, imageTag: 'approved-migrations' },
        imageManifest: JSON.stringify({ schemaVersion: 2, config: { digest } }), imageManifestMediaType: 'application/vnd.docker.distribution.manifest.v2+json' };
      return { images: [fetched, { ...fetched, imageId: { ...fetched.imageId, imageTag: 'previous-recovery' } }], failures: [] };
    }
    assert.equal(operation, 'put-image');
    assert.equal(args[args.indexOf('--image-manifest') + 1], fetched.imageManifest);
    assert.equal(args[args.indexOf('--image-manifest-media-type') + 1], fetched.imageManifestMediaType);
    holds.push(args[args.indexOf('--image-tag') + 1]);
    return { image: { ...fetched, imageId: { ...fetched.imageId, imageTag: holds.at(-1) } } };
  };
  await io.pinRecoveryImages(release);
  assert.deepEqual(holds, [`qa-recovery-${id}-0`, `qa-recovery-${id}-1`, `qa-recovery-${id}-2`]);
  assert.equal(backend.containerDefinitions[0].image, `${repository}@sha256:${'a'.repeat(64)}`);
  assert.equal(migration.containerDefinitions[0].image, `${repository}@sha256:${'b'.repeat(64)}`);
  assert.equal(cleanup.containerDefinitions[0].image, `${repository}@sha256:${'c'.repeat(64)}`);
});

test('recovery image pinning rejects non-QA sources and missing immutable image references', async () => {
  for (const image of [
    '111111111111.dkr.ecr.us-west-1.amazonaws.com/mangorts-qa-backend:sha',
    '686458136219.dkr.ecr.us-west-1.amazonaws.com/mangorts-prod-backend:sha',
    '686458136219.dkr.ecr.us-west-1.amazonaws.com/mangorts-qa-backend',
  ]) {
    const io = adapter();
    const source = definition();
    source.containerDefinitions[0].image = image;
    await assert.rejects(io.pinRecoveryImages({ id: '20260908000000000-aaaaaaaaaaaa', services: [], migration_definition: source, schedules: {} }), /exact immutable QA repository/);
  }
});

test('missing or mismatched recovery image metadata never publishes a hold tag', async () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const valid = { imageId: { imageDigest: digest }, imageManifest: '{}', imageManifestMediaType: 'application/vnd.docker.distribution.manifest.v2+json' };
  for (const result of [
    { images: [], failures: [{ failureCode: 'ImageNotFound' }] },
    { images: [], failures: [] },
    { images: [{ imageId: { imageDigest: `sha256:${'b'.repeat(64)}` }, imageManifest: '{}', imageManifestMediaType: 'application/vnd.docker.distribution.manifest.v2+json' }] },
    { images: [{ imageId: { imageDigest: digest }, imageManifestMediaType: 'application/vnd.docker.distribution.manifest.v2+json' }] },
    { images: [valid, { ...valid, imageId: { imageDigest: `sha256:${'b'.repeat(64)}` } }] },
    { images: [valid, { ...valid, imageManifest: '{"schemaVersion":2}' }] },
    { images: [valid, { ...valid, imageManifestMediaType: 'application/vnd.oci.image.manifest.v1+json' }] },
    { images: [valid, valid], failures: [{ failureCode: 'ImageInaccessible' }] },
  ]) {
    const io = adapter();
    let published = 0;
    const source = definition();
    source.containerDefinitions[0].image = `686458136219.dkr.ecr.us-west-1.amazonaws.com/mangorts-qa-backend@${digest}`;
    io.aws = async (_service, operation) => {
      if (operation === 'batch-get-image') return result;
      published++;
      return {};
    };
    await assert.rejects(io.pinRecoveryImages({ id: '20260908000000000-aaaaaaaaaaaa', services: [], migration_definition: source, schedules: {} }));
    assert.equal(published, 0);
    assert.ok(source.containerDefinitions[0].image.endsWith(digest));
  }
});

test('image tag pruning removes only superseded recovery tags without deleting commit tags or digests', async () => {
  const io = adapter();
  const current = '20260908000000000-aaaaaaaaaaaa';
  const old = '20260901000000000-bbbbbbbbbbbb';
  const deleted = [];
  io.aws = async (service, operation, args) => {
    assert.equal(service, 'ecr');
    assert.equal(args[args.indexOf('--repository-name') + 1], 'mangorts-qa-backend');
    if (operation === 'list-images') return { imageIds: [
      { imageTag: `qa-recovery-${current}-0`, imageDigest: 'sha256:current' },
      { imageTag: `qa-recovery-${current}-1`, imageDigest: 'sha256:current-migrations' },
      { imageTag: `qa-recovery-${old}-0`, imageDigest: 'sha256:old' },
      { imageTag: `qa-recovery-${old}-1`, imageDigest: 'sha256:old-migrations' },
      { imageTag: revision }, { imageTag: `${revision}-migrations` }, { imageTag: 'qa-recovery-manual-investigation' },
      { imageDigest: 'sha256:untagged' },
    ] };
    assert.equal(operation, 'batch-delete-image');
    const images = args.slice(args.indexOf('--image-ids') + 1);
    assert.ok(images.every((image) => image.startsWith('imageTag=')));
    deleted.push(...images);
    return { imageIds: [], failures: [] };
  };
  await io.pruneRecoveryImageTags(current);
  assert.deepEqual(deleted, [`imageTag=qa-recovery-${old}-0`, `imageTag=qa-recovery-${old}-1`]);
});

test('an unconfirmed recovery image hold leaves the recorded source intact and exposes no manifest', async () => {
  const io = adapter();
  const source = definition();
  source.containerDefinitions[0].image = '686458136219.dkr.ecr.us-west-1.amazonaws.com/mangorts-qa-backend:previous-release';
  const original = source.containerDefinitions[0].image;
  const digest = `sha256:${'a'.repeat(64)}`;
  io.aws = async (_service, operation) => {
    if (operation === 'batch-get-image') return { images: [{ imageId: { imageDigest: digest }, imageManifest: '{"private-test-manifest":true}', imageManifestMediaType: 'application/vnd.docker.distribution.manifest.v2+json' }] };
    assert.equal(operation, 'put-image');
    return { image: { imageId: { imageDigest: `sha256:${'b'.repeat(64)}` } } };
  };
  await assert.rejects(io.pinRecoveryImages({ id: '20260908000000000-aaaaaaaaaaaa', services: [], migration_definition: source, schedules: {} }), (error) => {
    assert.ok(!error.message.includes('private-test-manifest'));
    return true;
  });
  assert.equal(source.containerDefinitions[0].image, original);
});

test('unknown scheduled writers stop readiness instead of being silently ignored', async () => {
  const io = adapter();
  io.aws = async (_service, operation) => {
    assert.equal(operation, 'list-rules');
    return { Rules: [{ Name: 'mangorts-qa-untracked-writer', ScheduleExpression: 'rate(1 minute)' }] };
  };
  await assert.rejects(io.schedules(), /Unknown QA scheduled writer/);
});

function approvedRevision(t) {
  const previous = { GITHUB_SHA: process.env.GITHUB_SHA, EXPECTED_GIT_COMMIT: process.env.EXPECTED_GIT_COMMIT };
  process.env.GITHUB_SHA = revision;
  process.env.EXPECTED_GIT_COMMIT = revision;
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
}

function selectedDatabase(identifier = 'mangorts-qa-recovery-existing-r1', overrides = {}) {
  return { DBInstanceIdentifier: identifier, DBInstanceArn: `arn:aws:rds:us-west-1:686458136219:db:${identifier}`,
    Engine: 'postgres', EngineVersion: '17.7', PubliclyAccessible: false, BackupRetentionPeriod: 1,
    DBSubnetGroup: { DBSubnetGroupName: 'qa-private' }, VpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-qa-database' }],
    Endpoint: { Address: 'selected-recovery.private', Port: 5432 }, ...overrides };
}

function preflightResponses(io, selected) {
  io.aws = async (service, operation, args) => {
    if (service === 'sts') return { Account: '686458136219' };
    if (service === 'ssm') {
      assert.ok(args.includes('--no-with-decryption'));
      return { Parameter: { Value: args.includes(config.active_database_parameter) ? selected.DBInstanceIdentifier : '2026-01-01T00:00:00Z' } };
    }
    if (service === 'rds') {
      assert.deepEqual(args, ['--db-instance-identifier', selected.DBInstanceIdentifier]);
      return { DBInstances: [selected] };
    }
    assert.deepEqual([service, operation], ['s3api', 'get-bucket-versioning']);
    return { Status: 'Enabled' };
  };
}

test('preflight resolves the durable recovery selection before registering the migration task', async (t) => {
  approvedRevision(t);
  const io = adapter();
  preflightResponses(io, selectedDatabase());
  await io.preflight();
  assert.equal(io.c.database.identifier, 'mangorts-qa-recovery-existing-r1');
  assert.equal(io.c.database.host, 'selected-recovery.private');
  assert.equal(io.c.database.port, 5432);
  io.taskDefinition = async () => definition();
  io.register = async (_definition, options) => {
    assert.equal(options.host, 'selected-recovery.private');
    return definition();
  };
  io.runTask = async () => ({ exitCode: 0, messages: ['MANGORTS_MIGRATION_PLAN={"ready":true}'] });
  assert.equal((await io.plan()).ready, true);
});

test('recovery host registration preserves the recorded migration image across newer workflow revisions', async (t) => {
  const previous = process.env.MIGRATION_IMAGE_URI;
  process.env.MIGRATION_IMAGE_URI = '686458136219.dkr.ecr.us-west-1.amazonaws.com/mangorts-qa-backend:newer-migrations';
  t.after(() => { if (previous === undefined) delete process.env.MIGRATION_IMAGE_URI; else process.env.MIGRATION_IMAGE_URI = previous; });
  const io = adapter();
  const savedDefinition = definition();
  io.migrationDefinition = savedDefinition;
  io.register = async (source, options) => {
    assert.equal(options.host, 'restored.private');
    assert.equal(options.image || source.containerDefinitions[0].image, savedDefinition.containerDefinitions[0].image);
    return source;
  };
  io.runTask = async () => ({ exitCode: 0, messages: ['MANGORTS_MIGRATION_PLAN={"ready":true}'] });
  await io.plan('restored.private');
});

test('ordinary polling stops after cancellation while maintenance polling can still finish', async () => {
  const io = adapter();
  io.interrupted = true;
  await assert.rejects(QAReleaseAWS.prototype.poll.call(io, 'service readiness', async () => assert.fail('cancelled release must stop')), /cancelled/);
  assert.equal(await QAReleaseAWS.prototype.poll.call(io, 'maintenance shutdown', async () => true, 1, true), true);
});

test('preflight rejects an active selection with incomplete or unsafe database metadata', async (t) => {
  approvedRevision(t);
  for (const override of [
    { PubliclyAccessible: true }, { PubliclyAccessible: undefined }, { BackupRetentionPeriod: 0 }, { BackupRetentionPeriod: undefined },
    { EngineVersion: '18.1' }, { DBSubnetGroup: { DBSubnetGroupName: 'other-vpc' } },
    { VpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-other' }] },
  ]) {
    const io = adapter();
    preflightResponses(io, selectedDatabase(undefined, override));
    await assert.rejects(io.preflight(), /private backed-up QA database contract/);
  }
});

test('scheduled cleanup is fenced by an exact-role deny until explicitly reopened', async () => {
  const io = adapter();
  const calls = [];
  io.aws = async (service, operation, args) => { calls.push([service, operation, args]); return {}; };
  await io.fenceScheduledCleanup(true);
  const [service, operation, args] = calls[0];
  assert.deepEqual([service, operation], ['iam', 'put-role-policy']);
  assert.equal(args[args.indexOf('--role-name') + 1], config.attachment_events_role_name);
  assert.equal(args[args.indexOf('--policy-name') + 1], 'qa-release-maintenance');
  const policy = JSON.parse(args[args.indexOf('--policy-document') + 1]);
  assert.deepEqual(policy.Statement, [{ Effect: 'Deny', Action: 'ecs:RunTask', Resource: '*' }]);
  await io.fenceScheduledCleanup(false);
  assert.deepEqual(calls[1], ['iam', 'delete-role-policy', ['--role-name', config.attachment_events_role_name, '--policy-name', 'qa-release-maintenance']]);
});

test('recovery to a release without cleanup retains the schedule fence', async () => {
  const io = adapter();
  io.gateAttachments = async () => {};
  io.gate = async () => {};
  io.setEmailSchedule = async () => {};
  io.fenceScheduledCleanup = async () => assert.fail('old release has no compatible cleanup schedule');
  await io.reopen({ services: [], schedules: { attachment: null, email: null } }, true);
});

test('recovery retries reuse an untouched restore but allocate a fresh instance after application writes', async () => {
  const releaseID = '20260908000000000-aaaaaaaaaaaa';
  for (const writersStarted of [false, true]) {
    const io = adapter();
    const oldTarget = `mangorts-qa-recovery-${releaseID}-r1`;
    const expectedTarget = writersStarted ? `mangorts-qa-recovery-${releaseID}-r2` : oldTarget;
    const release = { id: releaseID, restore_time: '2026-09-08T00:00:00Z', database: { identifier: 'mangorts-qa-postgres' },
      recovery_database: { identifier: oldTarget, host: 'old-recovery.private', writers_started: writersStarted } };
    const operations = [];
    let restored = false;
    io.save = async (value) => operations.push(['save', structuredClone(value)]);
    io.aws = async (_service, operation, args) => {
      operations.push([operation, args]);
      if (operation === 'describe-db-instances') {
        const requested = args[args.indexOf('--db-instance-identifier') + 1];
        if (requested === 'mangorts-qa-postgres') return { DBInstances: [{ DBInstanceClass: 'db.t4g.micro', DBSubnetGroup: { DBSubnetGroupName: 'qa-private' }, VpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-qa-database' }] }] };
        assert.equal(requested, expectedTarget);
        if (writersStarted && !restored) throw new Error('DBInstanceNotFound');
        return { DBInstances: [{ ...selectedDatabase(expectedTarget), DBInstanceStatus: 'available', DeletionProtection: true,
          TagList: [{ Key: 'release', Value: releaseID }] }] };
      }
      if (operation === 'restore-db-instance-to-point-in-time') {
        assert.equal(args[args.indexOf('--target-db-instance-identifier') + 1], expectedTarget);
        assert.equal(args[args.indexOf('--source-db-instance-identifier') + 1], 'mangorts-qa-postgres');
        assert.equal(args[args.indexOf('--restore-time') + 1], release.restore_time);
        assert.ok(args.includes('--deletion-protection') && args.includes('--no-publicly-accessible'));
        restored = true;
        return {};
      }
      assert.equal(operation, 'put-parameter');
      assert.equal(args[args.indexOf('--value') + 1], expectedTarget);
      return {};
    };
    await io.restoreDatabase(release);
    assert.equal(release.recovery_database.identifier, expectedTarget);
    assert.equal(operations.some(([operation]) => operation === 'restore-db-instance-to-point-in-time'), writersStarted);
    assert.ok(!operations.some(([operation]) => operation === 'delete-db-instance'));
    if (writersStarted) {
      assert.equal(release.previous_recovery_databases[0].identifier, oldTarget);
      assert.equal(operations[0][0], 'save', 'new target must be durable before issuing restore');
    }
  }
});

test('completed recovery cannot be repeated against subsequent QA data', async () => {
  const io = adapter();
  const id = '20260908000000000-aaaaaaaaaaaa';
  io.getRecord = async (key) => key === 'current.json' ? { id } : { id, status: 'recovered' };
  await assert.rejects(io.loadRecovery(id), /already recovered/);
});

test('recovery probe setup applies only a reviewed plan and refuses foundation changes', async () => {
  const probe = 'module.platform.aws_lb_listener_rule.qa_release_probe';
  const release = { services: [{}], previous_frontend: { revision }, previous_revision: revision };
  for (const change of [
    { address: `${probe}[0]`, type: 'aws_lb_listener_rule', mode: 'managed', change: { actions: ['update'] } },
    { address: 'aws_db_instance.qa', type: 'aws_db_instance', mode: 'managed', change: { actions: ['update'] } },
    { address: `${probe}[0]`, type: 'aws_lb_listener_rule', mode: 'managed', change: { actions: ['delete', 'create'] } },
  ]) {
    const io = adapter();
    const calls = [];
    io.command = async (program, args) => {
      assert.equal(program, 'terraform');
      calls.push(args);
      return args[0] === 'show' ? JSON.stringify({ resource_changes: [change] }) : '';
    };
    if (change.address === `${probe}[0]` && change.change.actions[0] === 'update') {
      await io.validateRecovery(release);
      assert.deepEqual(calls.at(-1), ['apply', '-no-color', 'qa-release-probe.tfplan']);
      assert.ok(calls[0].includes(`-target=${probe}`));
      assert.ok(calls[0].includes('-out=qa-release-probe.tfplan'));
    } else {
      await assert.rejects(io.validateRecovery(release), /foundation resource|would delete/);
      assert.ok(!calls.some((args) => args[0] === 'apply'));
    }
  }
});

test('bootstrap refuses plan variables that would activate the backend or claim schema readiness', async () => {
  for (const [desired, migrated] of [[1, false], [0, true], [0, false]]) {
    const io = adapter();
    let applied = false;
    io.preparePlan = async () => ({ variables: { backend_desired_count: { value: desired }, email_sqs_database_migration_complete: { value: migrated } } });
    io.command = async (_program, args) => { assert.deepEqual(args, ['apply', '-no-color', 'qa-release.tfplan']); applied = true; return ''; };
    if (desired || migrated) {
      await assert.rejects(io.bootstrap(), /backend count zero and schema confirmation false/);
      assert.equal(applied, false);
    } else {
      await io.bootstrap();
      assert.equal(applied, true);
    }
  }
});

test('verification rejects healthy old code, stale frontend and bypassed authentication', async (t) => {
  for (const defect of ['old-backend', 'old-frontend', 'auth-disabled']) {
    const io = adapter();
    t.mock.method(globalThis, 'fetch', async (url) => {
      const path = new URL(url).pathname;
      if (path === '/healthz') return new Response(JSON.stringify({ ok: true, app_env: 'qa', auth_mode: 'cognito', deploy_revision: defect === 'old-backend' ? 'b'.repeat(40) : revision }));
      if (path === '/deploy-info.json') return new Response(JSON.stringify({ revision: defect === 'old-frontend' ? 'b'.repeat(40) : revision, api_base_url: 'https://qa.mangorts.com' }));
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: defect === 'auth-disabled' ? 200 : 401 });
    });
    await assert.rejects(io.verify(revision, false), /did not settle|Frontend revision|Auth smoke/);
    t.mock.restoreAll();
  }
});

test('public verification reaches actual feature routes with no maintenance probe', async (t) => {
  const io = adapter();
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.deepEqual(options.headers, {});
    const parsed = new URL(url);
    paths.push(parsed.pathname);
    if (parsed.pathname === '/healthz') return new Response(JSON.stringify({ ok: true, app_env: 'qa', auth_mode: 'cognito', deploy_revision: revision }));
    if (parsed.pathname === '/deploy-info.json') return new Response(JSON.stringify({ revision, api_base_url: 'https://qa.mangorts.com' }));
    if (parsed.pathname === '/nylas/webhook') return new Response(parsed.searchParams.get('challenge'));
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  });
  await io.verify(revision, false);
  assert.ok(paths.includes('/v1/process-map/scene'));
  assert.ok(paths.includes('/v1/attachments'));
});

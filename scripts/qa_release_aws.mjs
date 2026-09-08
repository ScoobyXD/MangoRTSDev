import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { waitForRestorableTime, recoverAttachments } from './qa_release_storage.mjs';

const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const TF = 'infra/aws-qa';
const PREFIX = 'mangorts/qa/releases/';
const TERMINAL = new Set(['deployed', 'recovered']);

async function command(program, args, options = {}) {
  try { return (await exec(program, args, { maxBuffer: 32 * 1024 * 1024, ...options })).stdout; }
  catch (error) {
    // Do not print command arguments or Terraform JSON, which may contain runner secrets.
    throw new Error(`${program} ${args[0]} failed: ${(error.stderr || error.message).slice(0, 3000)}`);
  }
}

export class QAReleaseAWS {
  static async create() {
    const config = JSON.parse(await command('terraform', ['output', '-json', 'qa_release'], { cwd: TF }));
    return new QAReleaseAWS(config);
  }

  constructor(config, runCommand = command) {
    this.command = runCommand;
    this.c = config;
    this.interrupted = false;
    process.on('SIGINT', () => { this.interrupted = true; });
    process.on('SIGTERM', () => { this.interrupted = true; });
    this.aws = async (service, operation, args = []) => {
      const result = await this.command('aws', [service, operation, ...args, '--region', 'us-west-1', '--output', 'json', '--no-cli-pager']);
      return result.trim() ? JSON.parse(result) : {};
    };
  }

  cancelled() { return this.interrupted; }
  checkCancellation() { if (this.interrupted) throw new Error('Release cancelled'); }

  async poll(description, check, minutes = 20, allowCancelled = false) {
    const deadline = Date.now() + minutes * 60000;
    do {
      if (!allowCancelled) this.checkCancellation();
      const value = await check();
      if (value) return value;
      await sleep(15000);
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${description}`);
  }

  async jsonFile(name, value) {
    await mkdir('.qa-release', { recursive: true });
    const path = resolve('.qa-release', name);
    await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    return `file://${path}`;
  }

  async getRecord(key) {
    const path = resolve('.qa-release', 'read-record.json');
    await mkdir('.qa-release', { recursive: true });
    try {
      await this.aws('s3api', 'get-object', ['--bucket', this.c.release_bucket, '--key', `${PREFIX}${key}`, path]);
    } catch (error) {
      if (/NoSuchKey|Not Found|404/.test(error.message)) return null;
      throw error;
    }
    return JSON.parse(await readFile(path, 'utf8'));
  }

  async putRecord(key, value) {
    const file = await this.jsonFile('record.json', value);
    await this.aws('s3api', 'put-object', ['--bucket', this.c.release_bucket, '--key', `${PREFIX}${key}`, '--body', file.slice(7), '--server-side-encryption', 'AES256']);
  }

  async save(release, status) {
    release.status = status;
    release.updated_at = new Date().toISOString();
    await writeFile('.qa-release.json', JSON.stringify(release, null, 2), { mode: 0o600 });
    await this.putRecord(`${release.id}/release.json`, release);
    await this.putRecord('current.json', { id: release.id, status, revision: release.revision });
    console.log(`QA release ${release.id}: ${status}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await writeFile(process.env.GITHUB_STEP_SUMMARY, `QA release **${release.id}**: **${status}**. Revision: ${release.revision}.\n`, { flag: 'a' });
    }
  }

  async preflight() {
    const identity = await this.aws('sts', 'get-caller-identity');
    if (identity.Account !== '686458136219' || this.c.account_id !== identity.Account || this.c.region !== 'us-west-1') throw new Error('QA account/region mismatch');
    if (!/^mangorts-qa-cluster$/.test(this.c.cluster) || this.c.release_prefix !== PREFIX) throw new Error('QA resource scope mismatch');
    const route = await this.aws('ssm', 'get-parameter', ['--name', this.c.active_database_parameter, '--no-with-decryption']);
    const selectedID = route.Parameter.Value;
    if (!/^mangorts-qa-(postgres|recovery-[a-z0-9-]+)$/.test(selectedID)) throw new Error('Invalid active QA database selection');
    const { DBInstances } = await this.aws('rds', 'describe-db-instances', ['--db-instance-identifier', selectedID]);
    const selected = DBInstances[0];
    if (DBInstances.length !== 1 || selected.DBInstanceArn !== `arn:aws:rds:us-west-1:686458136219:db:${selectedID}` ||
        selected.Engine !== 'postgres' || !/^17\./.test(selected.EngineVersion) || selected.PubliclyAccessible !== false ||
        selected.DBSubnetGroup.DBSubnetGroupName !== this.c.database.subnet_group ||
        selected.VpcSecurityGroups.length !== 1 || selected.VpcSecurityGroups[0].VpcSecurityGroupId !== this.c.database.security_group ||
        !Number.isInteger(selected.BackupRetentionPeriod) || selected.BackupRetentionPeriod < 1) throw new Error('Active database does not match the private backed-up QA database contract');
    // Recovery updates SSM immediately; Terraform outputs can still describe the old release.
    this.c.database = { ...this.c.database, identifier: selectedID, host: selected.Endpoint.Address, port: selected.Endpoint.Port };
    const versioning = await this.aws('s3api', 'get-bucket-versioning', ['--bucket', this.c.attachment_bucket]);
    if (versioning.Status !== 'Enabled') throw new Error('QA attachments must have versioning enabled before release');
    // Foundation writes this nonsecret timestamp once after enabling versioning.
    const ready = await this.aws('ssm', 'get-parameter', ['--name', this.c.attachment_versioning_ready_parameter, '--no-with-decryption']);
    if (!Number.isFinite(Date.parse(ready.Parameter.Value)) || Date.now() < Date.parse(ready.Parameter.Value)) throw new Error('Attachment versioning has not completed its 15-minute propagation window');
    if (process.env.GITHUB_SHA !== process.env.EXPECTED_GIT_COMMIT || !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '')) throw new Error('Exact approved main revision is required');
    await mkdir('.qa-release', { recursive: true });
  }

  async taskDefinition(arn) {
    const { taskDefinition } = await this.aws('ecs', 'describe-task-definition', ['--task-definition', arn]);
    if (!taskDefinition.family.startsWith('mangorts-qa-')) throw new Error('Task family is outside QA');
    for (const c of taskDefinition.containerDefinitions) {
      if ((c.environment || []).some(e => /^(DB_PASSWORD|.*API_KEY|.*STATE_SECRET|.*WEBHOOK_SECRET|.*ORIGIN_VERIFY_SECRET)$/.test(e.name))) throw new Error('Task definition contains an inline secret; release records require ECS secret references');
    }
    return taskDefinition;
  }

  async register(definition, { image, host } = {}) {
    const allowed = ['family', 'taskRoleArn', 'executionRoleArn', 'networkMode', 'containerDefinitions', 'volumes', 'placementConstraints', 'requiresCompatibilities', 'cpu', 'memory', 'pidMode', 'ipcMode', 'proxyConfiguration', 'inferenceAccelerators', 'ephemeralStorage', 'runtimePlatform'];
    const input = Object.fromEntries(allowed.filter(k => definition[k] !== undefined).map(k => [k, structuredClone(definition[k])]));
    for (const container of input.containerDefinitions) {
      if (image) container.image = image;
      if (host) for (const env of container.environment || []) if (env.name === 'DB_HOST') env.value = host;
    }
    input.tags = [{ key: 'project', value: 'mangorts' }, { key: 'environment', value: 'qa' }];
    const result = await this.aws('ecs', 'register-task-definition', ['--cli-input-json', await this.jsonFile('task.json', input)]);
    return result.taskDefinition;
  }

  async plan(host) {
    this.checkCancellation();
    if (!this.migrationDefinition || host) {
      const source = this.migrationDefinition || await this.taskDefinition(this.c.migration_task_definition);
      const image = this.migrationDefinition ? undefined : process.env.MIGRATION_IMAGE_URI;
      this.migrationDefinition = await this.register(source, { image, host: host || this.c.database.host });
    }
    const result = await this.runTask(this.migrationDefinition, ['-mode', 'plan']);
    const reports = result.messages.filter(m => m.startsWith('MANGORTS_MIGRATION_PLAN='));
    if (reports.length !== 1) throw new Error('Migration task did not emit exactly one structured plan');
    const plan = JSON.parse(reports[0].slice('MANGORTS_MIGRATION_PLAN='.length));
    if (result.exitCode !== 0 || !plan.ready) throw new Error(`Migration plan blocked: ${(plan.blockers || []).join('; ')}`);
    return plan;
  }

  async runTask(definition, commandArgs) {
    this.checkCancellation();
    const container = definition.containerDefinitions[0];
    const run = await this.aws('ecs', 'run-task', [
      '--cluster', this.c.cluster, '--task-definition', definition.taskDefinitionArn,
      '--launch-type', 'FARGATE', '--count', '1', '--started-by', 'mangorts-qa-approved-release',
      '--network-configuration', JSON.stringify({ awsvpcConfiguration: { subnets: this.c.subnets, securityGroups: [this.c.security_group], assignPublicIp: 'DISABLED' } }),
      '--overrides', JSON.stringify({ containerOverrides: [{ name: container.name, command: commandArgs }] }),
    ]);
    if (run.failures?.length || run.tasks?.length !== 1) throw new Error('ECS did not start exactly one release task');
    const arn = run.tasks[0].taskArn;
    console.log(`QA task: ${arn}`);
    const task = await this.poll('release task to stop', async () => {
      this.checkCancellation();
      const { tasks, failures } = await this.aws('ecs', 'describe-tasks', ['--cluster', this.c.cluster, '--tasks', arn]);
      if (failures?.length || tasks.length !== 1) throw new Error('Release task disappeared');
      return tasks[0].lastStatus === 'STOPPED' ? tasks[0] : false;
    }, 25);
    const options = container.logConfiguration.options;
    const stream = `${options['awslogs-stream-prefix']}/${container.name}/${arn.split('/').at(-1)}`;
    let messages = [];
    let token;
    await this.poll('release task logs', async () => {
      try {
        const args = ['--log-group-name', options['awslogs-group'], '--log-stream-name', stream, '--start-from-head'];
        if (token) args.push('--next-token', token);
        const logs = await this.aws('logs', 'get-log-events', args);
        messages.push(...logs.events.map(e => e.message));
        const settled = token === logs.nextForwardToken;
        token = logs.nextForwardToken;
        const exitCode = task.containers.find(c => c.name === container.name)?.exitCode;
        const marker = commandArgs.includes('plan') ? messages.some(m => m.startsWith('MANGORTS_MIGRATION_PLAN='))
          : container.name === 'attachment-maintenance' ? messages.some(m => m.includes('attachment_maintenance status=finished')) : messages.length > 0;
        return settled && (exitCode !== 0 || marker);
      } catch (error) { if (/ResourceNotFound/.test(error.message)) return false; throw error; }
    }, 2);
    return { task, exitCode: task.containers.find(c => c.name === container.name)?.exitCode, messages };
  }

  async capture(before) {
    const current = await this.getRecord('current.json');
    if (current && !TERMINAL.has(current.status)) throw new Error(`QA release ${current.id} is ${current.status}; use recovery before another deployment`);
    await this.pruneHistory(current?.id);
    await this.pruneRecoveryImageTags(current?.id);
    const servicesResult = await this.aws('ecs', 'list-services', ['--cluster', this.c.cluster]);
    const names = [this.c.backend_service, this.c.email_worker_service].filter(Boolean);
    if (servicesResult.serviceArns.some(arn => !names.includes(arn.split('/').at(-1)))) throw new Error('Unknown QA service writer; inventory it before release');
    const { services } = await this.aws('ecs', 'describe-services', ['--cluster', this.c.cluster, '--services', ...names]);
    const previous = [];
    for (const service of services) {
      if (service.deployments.length !== 1 || service.runningCount !== service.desiredCount || service.pendingCount) throw new Error('QA services must be stable before release');
      const definition = await this.taskDefinition(service.taskDefinition);
      const image = definition.containerDefinitions[0].image;
      const repo = image.split('/').slice(1).join('/').split(/[:@]/)[0];
      const imageID = image.includes('@') ? `imageDigest=${image.split('@')[1]}` : `imageTag=${image.split(':').at(-1)}`;
      const detail = await this.aws('ecr', 'describe-images', ['--repository-name', repo, '--image-ids', imageID]);
      const digest = detail.imageDetails[0].imageDigest;
      // Keep the registry (which contains no colon) and repository, pinned by digest only.
      definition.containerDefinitions[0].image = `${image.split('@')[0].split(':')[0]}@${digest}`;
      previous.push({ name: service.serviceName, desired_count: service.desiredCount, definition });
    }
    const backend = previous.find(s => s.name === this.c.backend_service);
    const revision = backend.definition.containerDefinitions[0].environment.find(e => e.name === 'MANGORTS_DEPLOY_REVISION')?.value;
    if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error('Previous backend revision is unavailable');
    const id = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${process.env.GITHUB_SHA.slice(0, 12)}`;
    const release = { id, revision: process.env.GITHUB_SHA, previous_revision: revision, created_at: new Date().toISOString(), before, services: previous, database: this.c.database, database_writes_started: false, config: this.c, migration_definition: this.migrationDefinition, schedules: await this.schedules() };
    await this.command('aws', ['s3', 'sync', `s3://${this.c.frontend_bucket}`, `s3://${this.c.release_bucket}/${PREFIX}${id}/frontend`, '--region', 'us-west-1', '--only-show-errors']);
    const frontend = await this.getRecord(`${id}/frontend/deploy-info.json`);
    if (frontend?.revision !== revision) throw new Error('Previous frontend and backend revisions do not match');
    release.previous_frontend = frontend;
    await this.protectRecoveryImages();
    await this.pinRecoveryImages(release);
    await this.preparePlan();
    await this.save(release, 'captured');
    await this.pruneRecoveryImageTags(release.id);
    return release;
  }

  async schedules() {
    const result = { attachment: null, email: null };
    const rules = await this.aws('events', 'list-rules', ['--name-prefix', 'mangorts-qa-']);
    for (const rule of rules.Rules.filter(r => r.ScheduleExpression)) {
      if (rule.Name !== 'mangorts-qa-attachment-maintenance') throw new Error(`Unknown QA scheduled writer: ${rule.Name}`);
      const { Targets } = await this.aws('events', 'list-targets-by-rule', ['--rule', rule.Name]);
      if (Targets.length !== 1 || !Targets[0].EcsParameters?.TaskDefinitionArn) throw new Error('Unexpected attachment maintenance target');
      const definition = await this.taskDefinition(Targets[0].EcsParameters.TaskDefinitionArn);
      result.attachment = { name: rule.Name, state: rule.State, target: Targets[0], definition };
    }
    const schedules = await this.aws('scheduler', 'list-schedules', ['--name-prefix', 'mangorts-qa-']);
    for (const schedule of schedules.Schedules) {
      if (!this.c.email_reconciliation || schedule.Name !== this.c.email_reconciliation.name) throw new Error(`Unknown QA scheduler writer: ${schedule.Name}`);
      const value = await this.aws('scheduler', 'get-schedule', ['--name', schedule.Name, '--group-name', schedule.GroupName]);
      if (!value.Target?.Arn?.startsWith('arn:aws:sqs:us-west-1:686458136219:mangorts-qa-')) throw new Error('QA email scheduler must target its existing SQS queue');
      result.email = value;
    }
    return result;
  }

  async setEmailSchedule(schedule, state) {
    if (!schedule) return;
    const keys = ['Name', 'GroupName', 'ScheduleExpression', 'ScheduleExpressionTimezone', 'StartDate', 'EndDate', 'Description', 'KmsKeyArn', 'FlexibleTimeWindow', 'Target', 'ActionAfterCompletion'];
    const input = Object.fromEntries(keys.filter(k => schedule[k] !== undefined).map(k => [k, schedule[k]]));
    input.State = state;
    await this.aws('scheduler', 'update-schedule', ['--cli-input-json', await this.jsonFile('schedule.json', input)]);
  }

  async gate(closed) {
    const conditions = [{ Field: 'path-pattern', PathPatternConfig: { Values: [closed ? '/*' : '/.qa-maintenance-disabled'] } }];
    await this.aws('elbv2', 'modify-rule', ['--rule-arn', this.c.maintenance_rule_arn, '--conditions', JSON.stringify(conditions)]);
  }

  async gateAttachments(closed) {
    let policy = { Version: '2012-10-17', Statement: [] };
    try { policy = JSON.parse((await this.aws('s3api', 'get-bucket-policy', ['--bucket', this.c.attachment_bucket])).Policy); }
    catch (error) { if (!/NoSuchBucketPolicy/.test(error.message)) throw error; }
    policy.Statement = policy.Statement.filter(s => s.Sid !== 'QAReleaseMaintenance');
    if (closed) policy.Statement.push({ Sid: 'QAReleaseMaintenance', Effect: 'Deny', Principal: '*', Action: ['s3:PutObject', 's3:DeleteObject'], Resource: `arn:aws:s3:::${this.c.attachment_bucket}/*`, Condition: { ArnEquals: { 'aws:PrincipalArn': this.c.attachment_writer_role_arns } } });
    if (policy.Statement.length) await this.aws('s3api', 'put-bucket-policy', ['--bucket', this.c.attachment_bucket, '--policy', JSON.stringify(policy)]);
    else await this.aws('s3api', 'delete-bucket-policy', ['--bucket', this.c.attachment_bucket]);
  }

  async fenceScheduledCleanup(closed) {
    const args = ['--role-name', this.c.attachment_events_role_name, '--policy-name', 'qa-release-maintenance'];
    if (closed) {
      await this.aws('iam', 'put-role-policy', [...args, '--policy-document', JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Deny', Action: 'ecs:RunTask', Resource: '*' }] })]);
    } else {
      try { await this.aws('iam', 'delete-role-policy', args); }
      catch (error) { if (!/NoSuchEntity/.test(error.message)) throw error; }
    }
  }

  async quiesce(release) {
    await this.gate(true);
    await this.gateAttachments(true);
    await this.fenceScheduledCleanup(true);
    const schedules = await this.schedules();
    if (schedules.attachment) await this.aws('events', 'disable-rule', ['--name', schedules.attachment.name]);
    await this.setEmailSchedule(schedules.email, 'DISABLED');
    const { serviceArns } = await this.aws('ecs', 'list-services', ['--cluster', this.c.cluster]);
    for (const service of serviceArns) await this.aws('ecs', 'update-service', ['--cluster', this.c.cluster, '--service', service, '--desired-count', '0']);
    await this.poll('all QA writers to stop', async () => {
      const { taskArns } = await this.aws('ecs', 'list-tasks', ['--cluster', this.c.cluster, '--desired-status', 'RUNNING']);
      if (!taskArns.length) return true;
      const { tasks } = await this.aws('ecs', 'describe-tasks', ['--cluster', this.c.cluster, '--tasks', ...taskArns]);
      for (const task of tasks) if (!task.group?.startsWith('service:')) await this.aws('ecs', 'stop-task', ['--cluster', this.c.cluster, '--task', task.taskArn, '--reason', 'Approved QA release maintenance']);
      return false;
    }, 20, true);
    // Allow already accepted S3 requests and drained connections to settle before timestamping.
    await sleep(5000);
  }

  async boundary() {
    // Whole second after quiescence: no application writer resumes before restore coverage.
    await sleep(1100);
    return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  }

  async verifyRestorePoint(release) {
    const db = await waitForRestorableTime(this.aws, release.database.identifier, release.restore_time, { sleep });
    return { earliest: db.EarliestRestorableTime, latest: db.LatestRestorableTime, verified_at: new Date().toISOString() };
  }

  async migrate() {
    this.checkCancellation();
    const result = await this.runTask(this.migrationDefinition, ['-mode', 'migrate']);
    if (result.exitCode !== 0) throw new Error(`Migration task failed (exit ${result.exitCode}); earlier scripts may already be committed`);
  }

  async preparePlan(targets = this.c.release_terraform_targets, filename = 'qa-release.tfplan') {
    const args = ['plan', '-refresh=false', `-out=${filename}`, '-var', 'qa_maintenance_mode=true'];
    if (process.env.IMAGE_URI) args.push('-var', `backend_image_uri=${process.env.IMAGE_URI}`);
    if (process.env.MIGRATION_IMAGE_URI) args.push('-var', `migration_image_uri=${process.env.MIGRATION_IMAGE_URI}`);
    for (const target of targets) args.push(`-target=${target}`);
    await this.command('terraform', args, { cwd: TF });
    const plan = JSON.parse(await this.command('terraform', ['show', '-json', filename], { cwd: TF }));
    for (const change of plan.resource_changes || []) {
      if (change.mode !== 'managed' || change.change.actions.every(a => a === 'no-op' || a === 'read')) continue;
      const name = change.address.replace(/\[\d+\]/g, '');
      if (!targets.includes(name)) throw new Error(`Release plan would mutate foundation resource ${change.address}; bootstrap it through reviewed SSO first`);
      if (change.change.actions.includes('delete') && change.type !== 'aws_ecs_task_definition') throw new Error(`Release plan would delete ${change.address}`);
    }
    return plan;
  }

  async bootstrap() {
    const plan = await this.preparePlan();
    if (plan.variables.backend_desired_count.value !== 0 || plan.variables.email_sqs_database_migration_complete.value !== false) throw new Error('Bootstrap requires backend count zero and schema confirmation false');
    await this.command('terraform', ['apply', '-no-color', 'qa-release.tfplan'], { cwd: TF });
  }

  async rollout(release) {
    this.checkCancellation();
    await this.command('terraform', ['apply', '-no-color', 'qa-release.tfplan'], { cwd: TF });
    this.c = JSON.parse(await this.command('terraform', ['output', '-json', 'qa_release'], { cwd: TF }));
    await this.command('aws', ['s3', 'sync', 'frontend/dist', `s3://${this.c.frontend_bucket}`, '--delete', '--region', 'us-west-1', '--only-show-errors']);
    await this.invalidate();
    await this.aws('ecs', 'update-service', ['--cluster', this.c.cluster, '--service', this.c.backend_service, '--desired-count', String(this.c.desired_backend_count)]);
    await this.stable(this.c.backend_service);
    // New cleanup uses the new lock; no previous process can run beside it.
    await this.gateAttachments(false);
    const maintenance = await this.taskDefinition(this.c.attachment_maintenance.task_definition_arn);
    const result = await this.runTask(maintenance, []);
    if (result.exitCode !== 0 || !result.messages.some(m => /attachment_maintenance status=finished/.test(m) && /failures=0/.test(m) && /capped=false/.test(m))) throw new Error('Attachment maintenance did not finish successfully');
  }

  async invalidate() {
    const value = await this.aws('cloudfront', 'create-invalidation', ['--distribution-id', this.c.cloudfront_distribution_id, '--paths', '/*']);
    await this.poll('CloudFront invalidation', async () => (await this.aws('cloudfront', 'get-invalidation', ['--distribution-id', this.c.cloudfront_distribution_id, '--id', value.Invalidation.Id])).Invalidation.Status === 'Completed');
  }

  async stable(service) {
    await this.poll('QA service stability', async () => {
      const { services, failures } = await this.aws('ecs', 'describe-services', ['--cluster', this.c.cluster, '--services', service]);
      if (failures?.length || services.length !== 1) throw new Error('QA service missing');
      const s = services[0];
      return s.deployments.length === 1 && s.runningCount === s.desiredCount && !s.pendingCount;
    });
  }

  async verify(revision, probe = true) {
    this.checkCancellation();
    const headers = probe ? { 'X-Mangorts-QA-Release-Probe': process.env.TF_VAR_qa_release_probe } : {};
    const get = async path => {
      const response = await fetch(`https://qa.mangorts.com${path}`, { headers, signal: AbortSignal.timeout(15000) });
      return { status: response.status, text: await response.text() };
    };
    await this.poll('matching QA health revision', async () => {
      const result = await get('/healthz');
      if (result.status !== 200) return false;
      const health = JSON.parse(result.text);
      return health.ok === true && health.app_env === 'qa' && health.auth_mode === 'cognito' && health.deploy_revision === revision;
    }, 5);
    const front = await get('/deploy-info.json');
    const info = JSON.parse(front.text);
    if (front.status !== 200 || info.revision !== revision || info.api_base_url !== 'https://qa.mangorts.com') throw new Error('Frontend revision/origin mismatch');
    for (const path of ['/v1/me', '/v1/process-map/scene', '/v1/attachments']) {
      const result = await get(path);
      if (result.status !== 401 || JSON.parse(result.text).error !== 'unauthorized') throw new Error(`Auth smoke check failed at ${path}`);
    }
    const webhook = await get('/nylas/webhook?challenge=qa-deploy-smoke');
    if (webhook.status !== 200 || webhook.text !== 'qa-deploy-smoke') throw new Error('Nylas challenge smoke check failed');
    console.log(`QA frontend/backend/auth verified at ${revision}`);
  }

  async reopen(release, recovery) {
    this.checkCancellation();
    await this.gateAttachments(false);
    if (recovery) {
      for (const service of release.services) {
        await this.aws('ecs', 'update-service', ['--cluster', this.c.cluster, '--service', service.name, '--desired-count', String(service.desired_count)]);
        await this.stable(service.name);
      }
      if (release.schedules.attachment) await this.fenceScheduledCleanup(false);
      if (release.schedules.attachment?.state === 'ENABLED') await this.aws('events', 'enable-rule', ['--name', release.schedules.attachment.name]);
      await this.setEmailSchedule(release.schedules.email, release.schedules.email?.State);
    } else {
      if (this.c.email_worker_service && this.c.email_worker_enabled) {
        await this.aws('ecs', 'update-service', ['--cluster', this.c.cluster, '--service', this.c.email_worker_service, '--desired-count', '1']);
        await this.stable(this.c.email_worker_service);
      }
      await this.fenceScheduledCleanup(false);
      await this.aws('events', 'enable-rule', ['--name', this.c.attachment_maintenance.rule_name]);
      const schedules = await this.schedules();
      await this.setEmailSchedule(schedules.email, 'ENABLED');
    }
    await this.gate(false);
  }

  async loadRecovery(id) {
    if (!/^[0-9]{17}-[a-f0-9]{12}$/.test(id || '')) throw new Error('Recovery requires an exact retained release ID');
    const current = await this.getRecord('current.json');
    if (current?.id !== id) throw new Error('Recovery must target the current release; refusing to discard a later deployment');
    const release = await this.getRecord(`${id}/release.json`);
    if (!release) throw new Error('Recovery record not found');
    if (release.status === 'recovered') throw new Error('This release has already recovered; refusing to discard subsequent QA changes');
    return release;
  }

  async validateRecovery(release) {
    this.migrationDefinition = release.migration_definition;
    if (!release.services?.length || !release.previous_frontend || !release.previous_revision) throw new Error('Incomplete previous release record');
    if (release.database_writes_started || release.application_writes_started) await waitForRestorableTime(this.aws, release.database.identifier, release.restore_time, { sleep });
    // Preparing only the probe rule does not change the paused services or database.
    await this.preparePlan(['module.platform.aws_lb_listener_rule.qa_release_probe'], 'qa-release-probe.tfplan');
    await this.command('terraform', ['apply', '-no-color', 'qa-release-probe.tfplan'], { cwd: TF });
  }

  async restoreDatabase(release) {
    if (release.recovery_database?.writers_started) {
      release.previous_recovery_databases ||= [];
      release.previous_recovery_databases.push(release.recovery_database);
      release.recovery_database = null;
    }
    const attempt = (release.previous_recovery_databases?.length || 0) + 1;
    const target = release.recovery_database?.identifier || `mangorts-qa-recovery-${release.id}-r${attempt}`;
    if (!release.recovery_database) {
      release.recovery_database = { identifier: target };
      await this.save(release, 'recovering');
    }
    let database;
    try { database = (await this.aws('rds', 'describe-db-instances', ['--db-instance-identifier', target])).DBInstances[0]; }
    catch (error) { if (!/DBInstanceNotFound/.test(error.message)) throw error; }
    if (!database) {
      const source = (await this.aws('rds', 'describe-db-instances', ['--db-instance-identifier', release.database.identifier])).DBInstances[0];
      await this.aws('rds', 'restore-db-instance-to-point-in-time', [
        '--source-db-instance-identifier', release.database.identifier, '--target-db-instance-identifier', target,
        '--restore-time', release.restore_time, '--db-instance-class', source.DBInstanceClass,
        '--db-subnet-group-name', source.DBSubnetGroup.DBSubnetGroupName,
        '--vpc-security-group-ids', ...source.VpcSecurityGroups.map(s => s.VpcSecurityGroupId),
        '--no-publicly-accessible', '--no-multi-az', '--deletion-protection', '--copy-tags-to-snapshot',
        '--tags', JSON.stringify([{ Key: 'project', Value: 'mangorts' }, { Key: 'environment', Value: 'qa' }, { Key: 'managed_by', Value: 'qa-release-recovery' }, { Key: 'release', Value: release.id }]),
      ]);
    }
    database = await this.poll('recovered QA database', async () => {
      this.checkCancellation();
      const db = (await this.aws('rds', 'describe-db-instances', ['--db-instance-identifier', target])).DBInstances[0];
      return db.DBInstanceStatus === 'available' ? db : false;
    }, 60);
    if (database.PubliclyAccessible !== false || !database.DeletionProtection || !Number.isInteger(database.BackupRetentionPeriod) || database.BackupRetentionPeriod < 1 || !database.TagList?.some(t => t.Key === 'release' && t.Value === release.id)) throw new Error('Recovered instance identity/protection mismatch');
    release.recovery_database.host = database.Endpoint.Address;
    await this.aws('ssm', 'put-parameter', ['--name', this.c.active_database_parameter, '--type', 'String', '--value', target, '--overwrite']);
    await this.save(release, 'recovering');
  }

  async restoreAttachments(release) { release.recovered_attachments = await recoverAttachments(this.aws, this.c.attachment_bucket, release.restore_time); }

  async verifyRecoveredDatabase(release) {
    this.migrationDefinition = release.migration_definition;
    const restored = await this.plan(release.recovery_database.host);
    if (restored.schema_inventory_sha256 !== release.before.schema_inventory_sha256 || JSON.stringify(restored.applied) !== JSON.stringify(release.before.applied)) throw new Error('Recovered database does not match the pre-migration schema and ledger');
  }

  async restoreCode(release) {
    if (release.recovery_database) {
      release.recovery_database.writers_started = true;
      await this.save(release, 'recovering');
    }
    for (const service of release.services) {
      const definition = await this.register(service.definition, { host: release.recovery_database?.host });
      await this.aws('ecs', 'update-service', ['--cluster', this.c.cluster, '--service', service.name, '--task-definition', definition.taskDefinitionArn, '--desired-count', service.name === this.c.backend_service ? String(service.desired_count) : '0']);
    }
    // A prior cleanup schedule is restored only with its exact previous task target.
    if (release.schedules.attachment) {
      const definition = await this.register(release.schedules.attachment.definition, { host: release.recovery_database?.host });
      const target = structuredClone(release.schedules.attachment.target);
      target.EcsParameters.TaskDefinitionArn = definition.taskDefinitionArn;
      // The events role permits only the selected task revision, including after PITR.
      await this.aws('iam', 'put-role-policy', ['--role-name', this.c.attachment_events_role_name, '--policy-name', release.schedules.attachment.name,
        '--policy-document', JSON.stringify({ Version: '2012-10-17', Statement: [
          { Effect: 'Allow', Action: 'ecs:RunTask', Resource: definition.taskDefinitionArn, Condition: { ArnEquals: { 'ecs:cluster': `arn:aws:ecs:us-west-1:686458136219:cluster/${this.c.cluster}` } } },
          { Effect: 'Allow', Action: 'iam:PassRole', Resource: [definition.executionRoleArn, definition.taskRoleArn], Condition: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } } },
        ] })]);
      const result = await this.aws('events', 'put-targets', ['--rule', release.schedules.attachment.name, '--targets', JSON.stringify([target])]);
      if (result.FailedEntryCount) throw new Error('Failed to restore the previous attachment schedule target');
    }
    await this.command('aws', ['s3', 'sync', `s3://${this.c.release_bucket}/${PREFIX}${release.id}/frontend`, `s3://${this.c.frontend_bucket}`, '--delete', '--region', 'us-west-1', '--only-show-errors']);
    await this.invalidate();
    await this.stable(this.c.backend_service);
  }

  async protectRecoveryImages() {
    await this.preparePlan(['module.platform.aws_ecr_lifecycle_policy.backend'], 'qa-release-images.tfplan');
    await this.command('terraform', ['apply', '-no-color', 'qa-release-images.tfplan'], { cwd: TF });
  }

  async pinRecoveryImages(release) {
    const definitions = [...release.services.map(s => s.definition), release.migration_definition];
    if (release.schedules.attachment) definitions.push(release.schedules.attachment.definition);
    for (const [index, definition] of definitions.entries()) {
      const container = definition.containerDefinitions[0];
      const match = /^(686458136219\.dkr\.ecr\.us-west-1\.amazonaws\.com\/mangorts-qa-backend)(?::([^@]+))?(?:@(sha256:[a-f0-9]{64}))?$/.exec(container.image);
      if (!match || (!match[2] && !match[3])) throw new Error('Recovery image must be from the exact immutable QA repository');
      const imageID = match[3] ? `imageDigest=${match[3]}` : `imageTag=${match[2]}`;
      const result = await this.aws('ecr', 'batch-get-image', ['--repository-name', 'mangorts-qa-backend', '--image-ids', imageID]);
      if (result.failures?.length || result.images?.length !== 1) throw new Error('Required recovery image is unavailable');
      const image = result.images[0];
      const digest = image.imageId?.imageDigest;
      if (!/^sha256:[a-f0-9]{64}$/.test(digest || '') || (match[3] && digest !== match[3]) || !image.imageManifest || !image.imageManifestMediaType) throw new Error('Recovery image metadata or digest does not match the requested artifact');
      const pinned = await this.aws('ecr', 'put-image', ['--repository-name', 'mangorts-qa-backend', '--image-tag', `qa-recovery-${release.id}-${index}`,
        '--image-manifest', image.imageManifest, '--image-manifest-media-type', image.imageManifestMediaType]);
      if (pinned.image?.imageId?.imageDigest !== digest) throw new Error('ECR did not confirm the pinned recovery image digest');
      container.image = `${match[1]}@${digest}`;
    }
  }

  async pruneRecoveryImageTags(currentID) {
    const { imageIds } = await this.aws('ecr', 'list-images', ['--repository-name', 'mangorts-qa-backend', '--filter', 'tagStatus=TAGGED']);
    const obsolete = imageIds.filter(image => /^qa-recovery-[0-9]{17}-[a-f0-9]{12}-[0-9]+$/.test(image.imageTag || '') && !image.imageTag.startsWith(`qa-recovery-${currentID}-`));
    for (let offset = 0; offset < obsolete.length; offset += 100) {
      const result = await this.aws('ecr', 'batch-delete-image', ['--repository-name', 'mangorts-qa-backend', '--image-ids', ...obsolete.slice(offset, offset + 100).map(i => `imageTag=${i.imageTag}`)]);
      if (result.failures?.length) throw new Error('Failed to retire superseded QA recovery image tags');
    }
  }

  async pruneHistory(currentID) {
    const history = await this.aws('s3api', 'list-object-versions', ['--bucket', this.c.release_bucket, '--prefix', PREFIX]);
    const cutoff = Date.now() - this.c.release_retention_days * 86400000;
    const expired = [...(history.Versions || []), ...(history.DeleteMarkers || [])].filter(item => {
      const suffix = item.Key.slice(PREFIX.length);
      if (suffix === 'current.json') return !item.IsLatest;
      const id = suffix.split('/')[0];
      return /^[0-9]{17}-[a-f0-9]{12}$/.test(id) && id !== currentID && Date.parse(item.LastModified) < cutoff;
    });
    // Only disposable release history is pruned. RDS and attachment versions are never deleted here.
    for (let offset = 0; offset < expired.length; offset += 1000) {
      const result = await this.aws('s3api', 'delete-objects', ['--bucket', this.c.release_bucket, '--delete', JSON.stringify({ Objects: expired.slice(offset, offset + 1000).map(v => ({ Key: v.Key, VersionId: v.VersionId })), Quiet: true })]);
      if (result.Errors?.length) throw new Error('Failed to prune expired QA release history');
    }
  }
}

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const tf = args => execFileSync('terraform', args, {cwd:'infra/aws-qa',encoding:'utf8',maxBuffer:32*1024*1024});
const state = JSON.parse(tf(['state','pull']));
const policy = state.resources.filter(r=>r.module==='module.platform'&&r.type==='aws_ecr_lifecycle_policy'&&r.name==='backend');
console.log('State:',JSON.stringify(policy.map(r=>({module:r.module,type:r.type,name:r.name,instances:r.instances.map(i=>({status:i.status,id:i.attributes.id,repository:i.attributes.repository,policy:i.attributes.policy}))}))));
const live = execFileSync('aws',['ecr','get-lifecycle-policy','--repository-name','mangorts-qa-backend','--region','us-west-1','--output','json'],{encoding:'utf8'});
console.log('Live policy:',live);
tf(['plan','-refresh=false','-target=module.platform.aws_ecr_lifecycle_policy.backend','-out=qa-retention.tfplan']);
const plan=JSON.parse(tf(['show','-json','qa-retention.tfplan']));
console.log('Policy changes:',JSON.stringify(plan.resource_changes.filter(r=>r.type==='aws_ecr_lifecycle_policy')));
console.log('Other actions:',JSON.stringify(plan.resource_changes.filter(r=>r.type!=='aws_ecr_lifecycle_policy').map(r=>({address:r.address,actions:r.change.actions,reason:r.action_reason}))));
const changes=plan.resource_changes.filter(r=>r.mode==='managed'&&!r.change.actions.every(a=>a==='no-op'||a==='read'));
if(changes.length!==1||changes[0].address!=='module.platform.aws_ecr_lifecycle_policy.backend'||changes[0].change.after.repository!=='mangorts-qa-backend'||changes[0].action_reason!=='replace_because_cannot_update'||JSON.stringify(changes[0].change.replace_paths)!=='[["policy"]]')throw new Error('Unexpected plan; refusing repair');
const aws=args=>JSON.parse(execFileSync('aws',[...args,'--region','us-west-1','--output','json'],{encoding:'utf8'})||'{}');
if(aws(['sts','get-caller-identity']).Account!=='686458136219')throw new Error('Wrong account');
const desired=changes[0].change.after.policy;
const rules=JSON.parse(desired).rules;
if(rules.length!==2||rules[0].selection.tagPrefixList?.[0]!=='qa-recovery-'||rules[0].selection.countNumber!==100||rules[1].selection.countNumber!==50)throw new Error('Unexpected retention policy');
aws(['ecr','put-lifecycle-policy','--repository-name','mangorts-qa-backend','--lifecycle-policy-text',desired]);
const canonical=x=>{if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;};
const observed=aws(['ecr','get-lifecycle-policy','--repository-name','mangorts-qa-backend']);
if(JSON.stringify(canonical(JSON.parse(observed.lifecyclePolicyText)))!==JSON.stringify(canonical(JSON.parse(desired))))throw new Error('Live policy differs');
console.log('Updated existing QA retention policy in place.');
// Refresh only the verified ECR resource, without unrelated module-wide dependencies.
// This temporary configuration is never used to apply infrastructure changes.
const configPath='infra/aws-qa/main.tf';
const originalConfig=readFileSync(configPath,'utf8');
const dependency='  depends_on = [\n    aws_cloudwatch_log_group.ecs_container_insights_performance,\n    aws_s3_bucket.attachments,\n  ]';
if(!originalConfig.includes(dependency))throw new Error('Unexpected QA module dependencies');
try {
writeFileSync(configPath,originalConfig.replace(dependency,''));
tf(['plan','-refresh-only','-target=module.platform.aws_ecr_lifecycle_policy.backend','-out=qa-retention-refresh.tfplan']);
const refresh=JSON.parse(tf(['show','-json','qa-retention-refresh.tfplan']));
if((refresh.resource_changes||[]).some(r=>r.mode==='managed'&&!r.change.actions.every(a=>a==='no-op'||a==='read')))throw new Error('Refresh unexpectedly mutates resources');
tf(['apply','-no-color','qa-retention-refresh.tfplan']);
} finally { writeFileSync(configPath,originalConfig); }
tf(['plan','-refresh=false','-target=module.platform.aws_ecr_lifecycle_policy.backend','-out=qa-retention.tfplan']);
const verified=JSON.parse(tf(['show','-json','qa-retention.tfplan']));
if(verified.resource_changes.some(r=>r.mode==='managed'&&!r.change.actions.every(a=>a==='no-op'||a==='read')))throw new Error('Retention plan still changes resources');
console.log('Verified refreshed QA retention plan has no resource changes.');

import { writeFile } from 'node:fs/promises';
import { QAReleaseAWS } from './qa_release_aws.mjs';
const io = new QAReleaseAWS({cluster: 'mangorts-qa-cluster'});
const { Account } = await io.aws('sts', 'get-caller-identity');
if (Account !== '686458136219') throw new Error('Wrong QA account');
let messages = [], token;
for (;;) {
  const args = ['--log-group-name', '/ecs/mangorts-qa/database-migration', '--log-stream-name', 'ecs/database-migration/9800049e63ab4998944459c07cefda04', '--start-from-head'];
  if (token) args.push('--next-token', token);
  const page = await io.aws('logs', 'get-log-events', args);
  messages.push(...page.events.map(e => e.message));
  if (page.nextForwardToken === token) break;
  token = page.nextForwardToken;
}
const result = {messages};
const prefix = 'MANGORTS_SCHEMA_INVENTORY_ITEM=';
const items = result.messages.filter(m => m.startsWith(prefix)).map(m => m.slice(prefix.length));
if (items.length < 100) throw new Error('Incomplete catalog export');
await writeFile('qa-schema-inventory.json', '[' + items.join(',\n') + ']' );
console.log(`Exported ${items.length} catalog definitions; no database rows exported.`);
for (const m of result.messages.filter(m => m.includes('read-only migration audit'))) console.log(m);

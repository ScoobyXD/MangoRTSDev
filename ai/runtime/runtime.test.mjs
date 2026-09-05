import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { inspectable, LIMITS, runInteraction } from './runtime.mjs';
import { PROVIDER_RESPONSE_MAX_BYTES, validateResponse } from './response-validation.mjs';

const functionTool = name => ({ type: 'function', name, description: `Fixture ${name}`, parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } });
const toolItem = (name, args, id = 'call_1') => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args), status: 'completed' });
const textItem = text => ({ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const event = (response, type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
function reply(response, items) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  event(response, 'response.created', { response: { id: 'resp_1', status: 'in_progress' } });
  items.forEach((item, output_index) => {
    event(response, 'response.output_item.added', { output_index, item: item.type === 'function_call' ? { ...item, arguments: '' } : { ...item, content: [] } });
    if (item.type === 'message') event(response, 'response.output_text.delta', { output_index, content_index: 0, delta: item.content[0].text, item_id: item.id });
    event(response, 'response.output_item.done', { output_index, item });
  });
  event(response, 'response.completed', { response: { id: 'resp_1', status: 'completed', output: items, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 } } } });
  response.end();
}
async function fixture(t, handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    handler(response, requests.length, request);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const start = {
    api_key: 'fixture-credential-never-in-trace', model: 'test-model', reasoning_effort: 'medium',
    base_url: `http://127.0.0.1:${server.address().port}/v1`,
    messages: [{ role: 'user', content: 'Please discuss the supplied Process.' }],
    context: { identity: { name: 'Fixture User', company_id: 'fixture-company' }, process: { name: 'Cloud Bakery', sop: 'Prepare a written plan.', steps: ['Mix', 'Bake'] } },
    tools: [functionTool('fixture_write')], limits: LIMITS,
  };
  const captured = [];
  const dispatches = [];
  const emitted = [];
  const transport = {
    capture: async value => { captured.push(structuredClone(value)); },
    tool: async value => { dispatches.push(value); return { result: { saved: value.arguments.text } }; },
    emit: async value => { emitted.push(value); },
  };
  return { start, captured, requests, dispatches, emitted, transport };
}

test('unknown configured model stops the actual interaction before provider egress', async t => {
  const f = await fixture(t, response => reply(response, [textItem('Must not be requested.')]));
  f.start.model = 'not-a-real-model';
  await assert.rejects(runInteraction(f.start, f.transport));
  assert.equal(f.requests.length, 0);
  assert.equal(f.dispatches.length, 0);
});

test('real Pi captures exact initial and continuation HTTP bodies, complete native skill loads, and saved results', async t => {
  const f = await fixture(t, (response, call) => reply(response, call === 1
    ? [toolItem('read', { path: f.captured.find(e => e.kind === 'runtime').data.effective_system_prompt.match(/<location>([^<]+)<\/location>/)[1] })]
    : call === 2 ? [toolItem('fixture_write', { text: 'A saved written simulation.' }, 'call_2')]
    : [textItem('Saved a written simulation.')]));
  await runInteraction(f.start, f.transport);
  const requests = f.captured.filter(e => e.kind === 'provider_request' && e.status === 'prepared');
  assert.equal(f.requests.length, 3);
  assert.deepEqual(requests.map(e => e.data.body), f.requests);
  assert.equal(f.requests[0].parallel_tool_calls, false);
  assert.equal(f.requests[0].max_output_tokens, 4096);
  assert.equal(f.requests[0].store, false);
  assert.ok(f.requests.every(request => request.tools.every(tool => tool.type === 'function' && tool.strict === true)));
  assert.match(JSON.stringify(f.requests[0]), /Cloud Bakery/);
  assert.match(JSON.stringify(f.requests[0]), /available_skills/);
  assert.match(f.captured.find(e => e.kind === 'runtime').data.effective_system_prompt, /<location>skills\/mango-process\/SKILL\.md<\/location>/);
  assert.deepEqual(f.requests[0].tools.find(tool => tool.name === 'read').parameters.properties.path.enum, ['AGENTS.md', 'skills/mango-process/SKILL.md', 'skills/mango-node-chat/SKILL.md']);
  assert.equal(f.captured.filter(e => e.kind === 'skill_load').length, 1);
  assert.match(JSON.stringify(f.requests[1]), /Work with a saved Mango Process/);
  assert.match(JSON.stringify(f.requests[2]), /A saved written simulation/);
  assert.equal(f.dispatches.length, 1);
  assert.deepEqual(f.requests[0].tools.map(tool => tool.name).sort(), ['fixture_write', 'read']);
  assert.doesNotMatch(JSON.stringify(f.captured), /fixture-credential-never-in-trace|SACRED COMMANDMENTS|prod Route53/);
  assert.equal(f.emitted.map(e => e.text).join(''), 'Saved a written simulation.');
});

test('Pi loads the advertised Node chat skill before dispatching a message action', async t => {
  const f = await fixture(t, (response, call) => reply(response, call === 1
    ? [toolItem('read', { path: f.captured.find(e => e.kind === 'runtime').data.skills.find(skill => skill.name === 'mango-node-chat').filePath })]
    : call === 2 ? [toolItem('fixture_write', { text: 'The requested Node chat.' }, 'call_2')]
    : [textItem('Posted the requested Node chat.')]));
  await runInteraction(f.start, f.transport);
  const runtime = f.captured.find(e => e.kind === 'runtime').data;
  assert.match(runtime.effective_system_prompt, /<location>skills\/mango-node-chat\/SKILL\.md<\/location>/);
  assert.deepEqual(runtime.skills.map(skill => skill.name).sort(), ['mango-node-chat', 'mango-process']);
  const load = f.captured.find(e => e.kind === 'skill_load');
  assert.match(load.data.content, /send_process_node_chat/);
  assert.match(JSON.stringify(f.requests[1]), /urgent_user_ids/);
  assert.equal(f.dispatches.length, 1);
  assert.equal(f.captured.at(-1).status, 'completed');
});

test('discussion has no mutations and differently named/changed Process content reaches the provider', async t => {
  const f = await fixture(t, response => reply(response, [textItem('The Process has its current authored instructions.')]));
  for (const name of ['Paper Telescope', 'River Lantern']) {
    f.start.context.process = { name, sop: `New saved ${name} SOP`, steps: ['Outline', 'Review', 'Finish'] };
    await runInteraction(f.start, f.transport);
  }
  assert.equal(f.dispatches.length, 0);
  assert.match(JSON.stringify(f.requests[0]), /New saved Paper Telescope SOP/);
  assert.match(JSON.stringify(f.requests[1]), /New saved River Lantern SOP/);
});

test('capture acknowledgment failure prevents initial and continuation provider egress', async t => {
  for (const deniedInvocation of [1, 2]) {
    const f = await fixture(t, response => reply(response, [toolItem('fixture_write', { text: 'saved first' })]));
    const retain = f.transport.capture;
    f.transport.capture = async value => {
      if (value.kind === 'provider_request' && value.status === 'prepared' && value.data.invocation === deniedInvocation) throw new Error('retention rejected');
      await retain(value);
    };
    await assert.rejects(runInteraction(f.start, f.transport), /Chat stopped/);
    assert.equal(f.requests.length, deniedInvocation - 1);
    assert.equal(f.dispatches.length, deniedInvocation - 1);
  }
});

test('denied native read records failure and stops continuation', async t => {
  for (const path of ['../../AGENTS.md', 'C:\\Users\\Jonat\\MangoRTSDev\\a']) {
    const f = await fixture(t, response => reply(response, [toolItem('read', { path })]));
    await assert.rejects(runInteraction(f.start, f.transport));
    assert.equal(f.requests.length, 1);
    assert.equal(f.dispatches.length, 0);
    assert.equal(f.captured.filter(e => e.kind === 'skill_load').length, 0);
    assert.ok(f.captured.some(e => e.kind === 'tool_result' && e.status === 'failed'));
  }
});

test('Go failure stops continuation and records independent tool failure', async t => {
  const f = await fixture(t, response => reply(response, [toolItem('fixture_write', { text: 'first' })]));
  f.transport.tool = async value => { f.dispatches.push(value); throw new Error('Mango denied this action.'); };
  await assert.rejects(runInteraction(f.start, f.transport));
  assert.equal(f.dispatches.length, 1);
  assert.equal(f.requests.length, 1);
  assert.ok(f.captured.some(e => e.kind === 'tool_result' && e.status === 'failed'));
});

test('binding switches tools before continuation and cannot dispatch stale catalog tools', async t => {
  const f = await fixture(t, (response, call) => reply(response, call === 1
    ? [toolItem('bind_process', { text: 'saved-process-id' })]
    : [toolItem('create_process_node', { text: 'new Node' }, 'call_2')]));
  f.start.tools = [functionTool('bind_process')];
  f.transport.tool = async value => {
    f.dispatches.push(value);
    if (value.name === 'bind_process') return { result: { process: 'saved-process-id' }, tools: [functionTool('create_process_node')] };
    throw new Error('Stop after checking the switched catalog.');
  };
  await assert.rejects(runInteraction(f.start, f.transport));
  assert.deepEqual(f.requests[1].tools.map(tool => tool.name).sort(), ['create_process_node', 'read']);
  assert.deepEqual(f.dispatches.map(call => call.name), ['bind_process', 'create_process_node']);
});

test('Stop after one saved tool prevents continuation and retains its result', async t => {
  const f = await fixture(t, response => reply(response, [toolItem('fixture_write', { text: 'saved' })]));
  const controller = new AbortController();
  f.transport.tool = async value => { f.dispatches.push(value); controller.abort(); return { result: { saved: 'saved' } }; };
  await assert.rejects(runInteraction(f.start, f.transport, controller.signal));
  assert.equal(f.dispatches.length, 1);
  assert.ok(f.captured.some(e => e.kind === 'tool_result' && JSON.stringify(e).includes('saved')));
  assert.ok(f.captured.some(e => e.kind === 'interaction' && e.status === 'stopped'));
});

test('provider failures do not retry, redirect, or expose private errors', async t => {
  for (const status of [429, 500, 307]) {
    const f = await fixture(t, response => {
      response.writeHead(status, { 'content-type': 'application/json', location: 'http://127.0.0.1:1/secret' });
      response.end(JSON.stringify({ error: { message: 'SECRET_PROVIDER_INTERNAL' } }));
    });
    await assert.rejects(runInteraction(f.start, f.transport));
    assert.equal(f.requests.length, 1);
    if (status !== 307) {
      assert.deepEqual(f.captured.filter(event => event.kind === 'provider_http_response').map(event => event.data.http_status), [status]);
    }
    assert.doesNotMatch(JSON.stringify(f.captured), /SECRET_PROVIDER_INTERNAL/);
  }
});

test('native read counts against total tools and capture limit stops before egress', async t => {
  const f = await fixture(t, (response, call) => reply(response, call === 1 ? [toolItem('read', { path: 'skills/mango-process/SKILL.md' })] : [toolItem('fixture_write', { text: 'never' }, 'call_2')]));
  f.start.limits = { ...LIMITS, tools: 1 };
  await assert.rejects(runInteraction(f.start, f.transport));
  assert.equal(f.dispatches.length, 0);
  assert.ok(f.captured.some(e => e.kind === 'limit' && e.data.boundary === 'tool_calls'));
  const before = f.requests.length;
  f.start.limits = { ...LIMITS, trace_bytes: 1 };
  await assert.rejects(runInteraction(f.start, f.transport));
  assert.equal(f.requests.length, before);
});

test('slash skill syntax remains user text; unknown files are not discovered', async t => {
  const f = await fixture(t, response => reply(response, [textItem('Discussion only.')]));
  f.start.messages = [{ role: 'user', content: '/skill:mango-process literal customer text' }];
  await runInteraction(f.start, f.transport);
  assert.match(JSON.stringify(f.requests[0]), /\/skill:mango-process literal customer text/);
  assert.equal(f.captured.filter(e => e.kind === 'skill_load').length, 0);
  const runtime = f.captured.find(e => e.kind === 'runtime');
  assert.deepEqual(runtime.data.skills.map(skill => skill.filePath).sort(), ['skills/mango-node-chat/SKILL.md', 'skills/mango-process/SKILL.md']);
});

test('security omissions identify opaque reasoning; known credential cannot enter context or trace', () => {
  const original = { input: [{ type: 'reasoning', summary: [{ text: 'PRIVATE' }], content: [{ type: 'reasoning_text', text: 'PRIVATE' }], encrypted_content: 'OPAQUE' }] };
  const inspected = inspectable(original);
  assert.equal(inspected.omissions.length, 3);
  assert.doesNotMatch(JSON.stringify(inspected.value), /PRIVATE|OPAQUE/);
  assert.equal(original.input[0].encrypted_content, 'OPAQUE');
  assert.throws(() => inspectable({ text: 'key-value' }, 'key-value'));
});

test('multiple model calls are rejected before any tool dispatch', async t => {
  const f = await fixture(t, response => reply(response, [toolItem('fixture_write', { text: 'first' }), toolItem('fixture_write', { text: 'second' }, 'call_2')]));
  await assert.rejects(runInteraction(f.start, f.transport));
  assert.equal(f.dispatches.length, 0);
  assert.equal(f.requests.length, 1);
  assert.ok(f.captured.some(e => e.kind === 'tool_call' && e.status === 'denied' && e.data.calls.length === 2));
});

test('signed URLs are omitted before initial egress with a visible marker', async t => {
  const f = await fixture(t, response => reply(response, [textItem('The confidential link was omitted.')]));
  f.start.messages[0].content = 'Inspect https://example.invalid/file?X-Amz-Signature=PRIVATE_SIGNATURE';
  await runInteraction(f.start, f.transport);
  assert.doesNotMatch(JSON.stringify(f.requests), /PRIVATE_SIGNATURE/);
  assert.doesNotMatch(JSON.stringify(f.captured), /PRIVATE_SIGNATURE/);
  assert.match(JSON.stringify(f.requests), /secret URL omitted/);
  assert.equal(f.captured.find(e => e.kind === 'runtime').data.secret_url_omissions.length, 1);
});

test('in-flight Stop aborts provider work without follow-up calls', async t => {
  const controller = new AbortController();
  const f = await fixture(t, () => controller.abort());
  await assert.rejects(runInteraction(f.start, f.transport, controller.signal));
  assert.equal(f.requests.length, 1);
  assert.equal(f.dispatches.length, 0);
  assert.ok(f.captured.some(e => e.kind === 'interaction' && e.status === 'stopped'));
});

test('skill capture failure and undeclared shell calls never dispatch Mango tools', async t => {
  const f = await fixture(t, response => reply(response, [toolItem('read', { path: 'skills/mango-process/SKILL.md' })]));
  const retain = f.transport.capture;
  f.transport.capture = async value => {
    if (value.kind === 'skill_load') throw new Error('capture unavailable');
    await retain(value);
  };
  await assert.rejects(runInteraction(f.start, f.transport));
  assert.equal(f.requests.length, 1);
  assert.equal(f.dispatches.length, 0);
  const shell = await fixture(t, response => reply(response, [toolItem('bash', { command: 'not-executed' })]));
  await assert.rejects(runInteraction(shell.start, shell.transport));
  assert.equal(shell.dispatches.length, 0);
  assert.ok(shell.captured.some(e => e.kind === 'tool_result' && e.status === 'failed'));
});

test('selected max reaches supported provider unchanged; unsupported effort stops before egress', async t => {
  const f = await fixture(t, response => reply(response, [textItem('Discussion.')]));
  f.start.reasoning_effort = 'max';
  await runInteraction(f.start, f.transport);
  assert.equal(f.requests[0].reasoning.effort, 'max');
  f.start.model = 'gpt-5.4';
  await assert.rejects(runInteraction(f.start, f.transport));
  assert.equal(f.requests.length, 1);
  assert.ok(f.captured.some(e => e.kind === 'configuration' && e.status === 'denied'));
});

test('a repeated provider call ID with a different output item ID cannot dispatch again', async t => {
  const f = await fixture(t, (response, call) => reply(response, [{ ...toolItem('fixture_write', { text: String(call) }, 'same_call'), id: `different_item_${call}` }]));
  await assert.rejects(runInteraction(f.start, f.transport));
  assert.equal(f.requests.length, 2);
  assert.equal(f.dispatches.length, 1);
  assert.ok(f.captured.some(e => e.kind === 'limit' && e.data.boundary === 'duplicate_tool_call_id'));
});

test('malformed completed arguments, including malformed finals after valid deltas, never dispatch', async t => {
  for (const validDeltas of [false, true]) {
    const f = await fixture(t, response => {
      const item = { ...toolItem('fixture_write', { text: 'never saved' }), arguments: '{"text":"never saved"' };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      event(response, 'response.output_item.added', { output_index: 0, item: { ...item, arguments: '' } });
      if (validDeltas) {
        event(response, 'response.function_call_arguments.delta', { output_index: 0, item_id: item.id, delta: '{"text":"never saved"}' });
        event(response, 'response.function_call_arguments.done', { output_index: 0, item_id: item.id, arguments: '{"text":"never saved"}' });
      }
      event(response, 'response.output_item.done', { output_index: 0, item });
      event(response, 'response.completed', { response: { id: 'resp_bad', status: 'completed', output: [item] } });
      response.end();
    });
    await assert.rejects(runInteraction(f.start, f.transport));
    assert.equal(f.requests.length, 1);
    assert.equal(f.dispatches.length, 0);
    const denial = f.captured.find(e => e.kind === 'provider_validation' && e.status === 'denied');
    assert.equal(denial.data.raw_arguments, '{"text":"never saved"');
  }
});

test('missing terminal, incomplete response, and incomplete tool item stop before dispatch', async t => {
  for (const failure of ['missing-terminal', 'incomplete-response', 'incomplete-item']) {
    const f = await fixture(t, response => {
      const item = toolItem('fixture_write', { text: 'never saved' });
      if (failure === 'incomplete-item') item.status = 'in_progress';
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      event(response, 'response.output_item.done', { output_index: 0, item });
      if (failure !== 'missing-terminal') {
        const status = failure === 'incomplete-response' ? 'incomplete' : 'completed';
        event(response, `response.${status}`, { response: { id: 'resp_bad', status, output: [item], incomplete_details: { reason: 'max_output_tokens' } } });
      }
      response.end();
    });
    await assert.rejects(runInteraction(f.start, f.transport));
    assert.equal(f.dispatches.length, 0);
    assert.ok(f.captured.some(e => e.kind === 'provider_validation' && e.status === 'denied'));
  }
});

test('raw provider response and completed argument byte limits stop before dispatch', async t => {
  for (const mode of ['argument', 'response']) {
    const f = await fixture(t, response => {
      if (mode === 'response') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(':' + ' '.repeat(PROVIDER_RESPONSE_MAX_BYTES));
      } else reply(response, [toolItem('fixture_write', { text: 'x'.repeat(32769) })]);
    });
    await assert.rejects(runInteraction(f.start, f.transport));
    assert.equal(f.dispatches.length, 0);
    assert.ok(f.captured.some(e => e.kind === 'provider_validation' && e.status === 'denied'));
  }
});

test('Stop cancels the active response validation reader', async () => {
  const controller = new AbortController();
  let canceled = false;
  let startReading;
  const reading = new Promise(resolve => { startReading = resolve; });
  const body = new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode('data: {"type":"response.created","response":{"id":"pending"}}\n\n')); },
    pull() { startReading(); },
    cancel() { canceled = true; },
  });
  const validation = validateResponse(new Response(body), controller.signal, async () => {});
  validation.catch(() => {});
  await reading;
  controller.abort();
  await assert.rejects(validation);
  assert.equal(canceled, true);
});

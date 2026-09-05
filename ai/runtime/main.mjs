import { checkModel, runInteraction } from './runtime.mjs';

const ERROR = 'Chat stopped. Check Mango before repeating an action; completed changes may remain.';
const send = message => new Promise((resolve, reject) => {
  process.stdout.write(JSON.stringify(message) + '\n', error => error ? reject(error) : resolve());
});

if (process.argv[2] === '--check') {
  try {
    if (!await checkModel(process.argv[3])) throw new Error(ERROR);
    await send({ type: 'ready', pi_version: '0.85.0' });
  } catch { process.exitCode = 1; }
} else {
  const controller = new AbortController();
  const pending = new Map();
  let buffer = '';
  let started = false;
  let nextID = 0;
  const cancel = () => {
    controller.abort();
    for (const entry of pending.values()) entry.reject(new Error(ERROR));
    pending.clear();
  };
  const rpc = (type, data) => new Promise((resolve, reject) => {
    if (controller.signal.aborted) { reject(new Error(ERROR)); return; }
    const id = `rpc-${++nextID}`;
    pending.set(id, { resolve, reject, expected: type === 'capture' ? 'ack' : 'tool_result' });
    send({ type, ...data, id }).catch(error => { pending.delete(id); reject(error); cancel(); });
  });
  const receive = message => {
    if (!started) {
      if (message.type !== 'start') throw new Error(ERROR);
      started = true;
      runInteraction(message, {
        capture: event => rpc('capture', { event }),
        tool: call => rpc('tool', { ...call, call_id: call.id }),
        emit: send,
      }, controller.signal).then(() => send({ type: 'done' }), () => send({ type: 'error', message: ERROR }))
        .catch(() => {})
        .finally(() => { cancel(); process.stdin.destroy(); });
      return;
    }
    if (message.type === 'cancel') { cancel(); return; }
    const entry = pending.get(message.id);
    if (!entry || entry.expected !== message.type) throw new Error(ERROR);
    pending.delete(message.id);
    if (message.type === 'ack' && message.error) entry.reject(new Error(ERROR));
    else entry.resolve(message);
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    try {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 1048576) throw new Error(ERROR);
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        receive(JSON.parse(line));
      }
    } catch { cancel(); process.stdin.destroy(); }
  });
  process.stdin.on('end', cancel);
  process.stdin.on('error', cancel);
  process.stdout.on('error', cancel);
}

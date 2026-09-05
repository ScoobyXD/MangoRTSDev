import OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';

// This client supplies only the supported silent logger to the SSE parser; it never sends requests.
const parserClient = new OpenAI({ apiKey: 'validation-only-not-a-credential', logLevel: 'off' });
export const PROVIDER_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const SAFE_ERROR = 'The provider returned incomplete, malformed, or excessive tool arguments. No further tools were dispatched.';
const jsonArguments = raw => {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 32768) throw new Error(SAFE_ERROR);
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(SAFE_ERROR);
  return parsed;
};

// Validate a clone of this one HTTP response; Pi remains the sole model/tool loop.
// Its normalized tool events discard raw arguments and may repair invalid JSON.
export async function validateResponse(response, signal, capture) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let totalBytes = 0;
  const calls = new Map();
  let terminal = false;
  let terminalCallCount = 0;
  let invalidData;
  try {
    const limited = response.body.pipeThrough(new TransformStream({ transform(chunk, stream) {
      totalBytes += chunk.byteLength;
      if (totalBytes > PROVIDER_RESPONSE_MAX_BYTES) throw new Error(SAFE_ERROR);
      stream.enqueue(chunk);
    } }), { signal: controller.signal });
    const source = new Response(limited, { status: response.status, headers: response.headers });
    const validateItem = item => {
      if (item.type !== 'function_call') return;
      invalidData = { id: item.call_id, item_id: item.id, name: item.name,
        ...(typeof item.arguments === 'string' && Buffer.byteLength(item.arguments, 'utf8') <= 32768
          ? { raw_arguments: item.arguments } : { arguments_omitted: 'Missing or over the 32 KiB argument limit.' }) };
      if (item.status !== 'completed' || !item.call_id || !item.id || !item.name) throw new Error(SAFE_ERROR);
      const args = jsonArguments(item.arguments);
      const existing = calls.get(item.call_id);
      if (existing && (existing.item_id !== item.id || existing.name !== item.name || JSON.stringify(existing.arguments) !== JSON.stringify(args))) throw new Error(SAFE_ERROR);
      calls.set(item.call_id, { item_id: item.id, name: item.name, arguments: args });
      invalidData = undefined;
    };
    for await (const event of Stream.fromSSEResponse(source, controller, parserClient)) {
      if (event.type === 'response.function_call_arguments.done') {
        invalidData = { item_id: event.item_id,
          ...(typeof event.arguments === 'string' && Buffer.byteLength(event.arguments, 'utf8') <= 32768
            ? { raw_arguments: event.arguments } : { arguments_omitted: 'Missing or over the 32 KiB argument limit.' }) };
        jsonArguments(event.arguments);
        invalidData = undefined;
      } else if (event.type === 'response.output_item.done') {
        validateItem(event.item);
      } else if (event.type === 'response.completed') {
        if (event.response?.status !== 'completed') throw new Error(SAFE_ERROR);
        terminal = true;
        const output = event.response.output ?? [];
        terminalCallCount = output.filter(item => item.type === 'function_call').length;
        for (const item of output) validateItem(item);
      } else if (event.type === 'response.incomplete' || event.type === 'response.failed' || event.type === 'error') {
        throw new Error(SAFE_ERROR);
      }
    }
    if (!terminal || calls.size !== terminalCallCount || signal?.aborted) throw new Error(SAFE_ERROR);
    return calls;
  } catch {
    await capture('provider_validation', signal?.aborted ? 'stopped' : 'denied', {
      reason: SAFE_ERROR, response_bytes: totalBytes, response_byte_limit: PROVIDER_RESPONSE_MAX_BYTES, ...(invalidData ?? {}),
    });
    throw new Error(SAFE_ERROR);
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', abort);
  }
}

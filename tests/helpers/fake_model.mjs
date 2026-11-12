#!/usr/bin/env node
/**
 * A SCRIPTED MODEL ON LOOPBACK, for `tests/host_canary.mjs`: an OpenAI-compatible
 * `/v1/chat/completions` that never thinks. It asks the host to write the files it was given,
 * one tool call per turn, then says a word and stops. No real model, no credentials, no network
 * beyond 127.0.0.1.
 *
 *   node tests/helpers/fake_model.mjs --port-file <f> --requests <f> --writes <json> [--ttl <s>]
 *
 *   --port-file  written once the socket listens: the ephemeral port, as decimal text
 *   --requests   every request body, appended as one JSON line: what the host sent the "model",
 *                tool results included. This file is the canary's evidence
 *   --writes     `[{"path": "...", "content": "..."}, ...]`, one scripted write per turn
 *   --ttl        seconds until it exits by itself (default 600): a canary that crashed must not
 *                leave a listener behind
 *
 * ITS OWN PROCESS, because the canary drives its hosts with `spawnSync`, which blocks this
 * process's event loop: a server inside the canary would never answer.
 *
 * STATELESS BY DESIGN. Which turn a request belongs to is read from the request: the number of
 * `role: "tool"` messages it carries is the number of scripted writes already answered. A host
 * that retries a request, or asks twice in parallel, gets the same answer both times, where a
 * counter would skip a turn. A request with no `tools` (a title, a summary) gets plain text and
 * moves nothing.
 *
 * THE TOOL IS READ FROM THE REQUEST TOO. The write tool's name and its path argument differ
 * between hosts and majors (`filePath`, `path`, `file_path`), so the call is built from the tool
 * list the host itself sent: the tool named `write`, and whichever path key its schema declares.
 */
import fs from 'node:fs';
import http from 'node:http';

const PATH_KEYS = ['filePath', 'file_path', 'path', 'filepath'];

/** The write tool in an OpenAI `tools` array, and the argument that names the file. */
export function writeTool(tools) {
  for (const t of Array.isArray(tools) ? tools : []) {
    const fn = t?.function ?? t;
    if (String(fn?.name ?? '').toLowerCase() !== 'write') continue;
    const props = fn?.parameters?.properties ?? {};
    return { name: fn.name, pathKey: PATH_KEYS.find((k) => k in props) ?? 'filePath' };
  }
  return null;
}

/**
 * What the model "says" to one request body: `{ call: { name, args } }` or `{ text }`.
 * Turn n (0-based, the count of tool results so far) asks for `writes[n]`; past the script, or
 * with no write tool on offer, it is plain text.
 */
export function replyTo(body, writes) {
  const tool = writeTool(body?.tools);
  if (!tool) return { text: 'canary' };
  const turn = (body?.messages ?? []).filter((m) => m?.role === 'tool').length;
  const w = writes[turn];
  if (!w) return { text: 'done' };
  return { call: { id: `call_canary_${turn + 1}`, name: tool.name, args: { [tool.pathKey]: w.path, content: w.content } } };
}

const USAGE = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

function message(reply) {
  return reply.call
    ? { role: 'assistant', content: null, tool_calls: [{ id: reply.call.id, type: 'function', function: { name: reply.call.name, arguments: JSON.stringify(reply.call.args) } }] }
    : { role: 'assistant', content: reply.text };
}

/** The reply as chat-completion chunks, the last carrying `finish_reason` and `usage`. */
export function chunks(reply, model) {
  const base = { id: 'chatcmpl-canary', object: 'chat.completion.chunk', created: 0, model };
  const m = message(reply);
  const delta = reply.call
    ? { role: 'assistant', tool_calls: m.tool_calls.map((c) => ({ index: 0, ...c })) }
    : { role: 'assistant', content: reply.text };
  return [
    { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: reply.call ? 'tool_calls' : 'stop' }], usage: USAGE },
  ];
}

export function serve({ writes, requests }) {
  return http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const json = (status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'GET' && /\/models$/.test(req.url)) {
        return json(200, { object: 'list', data: [{ id: 'fake', object: 'model', owned_by: 'canary' }] });
      }
      if (req.method !== 'POST' || !/\/chat\/completions$/.test(req.url)) {
        if (requests) fs.appendFileSync(requests, `${JSON.stringify({ unhandled: `${req.method} ${req.url}` })}\n`);
        return json(404, { error: { message: `fake model: no route ${req.method} ${req.url}` } });
      }
      let body;
      try { body = JSON.parse(raw); } catch { return json(400, { error: { message: 'fake model: body is not JSON' } }); }
      if (requests) fs.appendFileSync(requests, `${JSON.stringify(body)}\n`);
      const reply = replyTo(body, writes);
      const model = body.model ?? 'fake';
      if (!body.stream) {
        return json(200, { id: 'chatcmpl-canary', object: 'chat.completion', created: 0, model,
          choices: [{ index: 0, message: message(reply), finish_reason: reply.call ? 'tool_calls' : 'stop' }], usage: USAGE });
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'close' });
      for (const c of chunks(reply, model)) res.write(`data: ${JSON.stringify(c)}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
}

// Run as a script, not imported: `process.argv[1]` is this file.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url))) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
  };
  const portFile = arg('--port-file');
  const requests = arg('--requests');
  if (!portFile || !requests) {
    console.error('usage: fake_model.mjs --port-file <f> --requests <f> --writes <json> [--ttl <s>]');
    process.exit(2);
  }
  const writes = JSON.parse(arg('--writes', '[]'));
  fs.writeFileSync(requests, '');
  const server = serve({ writes, requests });
  server.listen(0, '127.0.0.1', () => {
    // Written whole under another name, then renamed: a reader never sees half a port.
    fs.writeFileSync(`${portFile}.tmp`, String(server.address().port));
    fs.renameSync(`${portFile}.tmp`, portFile);
  });
  setTimeout(() => process.exit(0), Number(arg('--ttl', '600')) * 1000).unref();
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
}

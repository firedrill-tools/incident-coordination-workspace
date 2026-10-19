import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { createApp } from '../backend/dist/src/api.js';
const [encoded, workspace, directory, model] = process.argv.slice(2);
const input = JSON.parse(encoded), chat = input.action === 'chat', receipts = join(directory, 'receipts');
const app = createApp(workspace, undefined, { model: model || undefined, outputRoot: receipts }, chat);
const controller = new AbortController();
const stop = () => controller.abort(new Error('Incident target interrupted.'));
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(name, stop);
const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]);
const report = { executionKind: chat ? 'native_agui_http_request' : 'application_state_inspection', threadId: chat ? randomUUID() : null, runId: chat ? randomUUID() : null };
let server, failed = false;
const capture = async response => ({ status: response.status, body: await response.json() });
try {
  if (chat) await writeFile(join(directory, 'application-run.json'), JSON.stringify({ threadId: report.threadId, runId: report.runId }), { flag: 'wx', mode: 0o600, flush: true });
  server = await new Promise((resolve, reject) => { const owned = app.listen(0, '127.0.0.1', () => resolve(owned)); owned.once('error', reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  report.before = await capture(await fetch(origin + '/workspace', { signal }));
  if (report.before.status !== 200) throw new Error('Workspace unavailable before chat.');
  if (chat) {
    const response = await fetch(origin + '/agent', { method: 'POST', signal, headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({
      threadId: report.threadId, runId: report.runId, protocolVersion: '1.0', state: {}, messages: [{ id: randomUUID(), role: 'user', content: input.message }], tools: [], context: [], forwardedProps: {},
    }) });
    const raw = await response.text(), path = join(directory, 'ag-ui.sse');
    await writeFile(path, raw, { flag: 'wx', mode: 0o600, flush: true });
    report.http = { status: response.status, rawEventsFile: path };
    report.events = response.status === 200 ? raw.replaceAll('\r\n', '\n').split('\n\n').flatMap(block => {
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      return data && data !== '[DONE]' ? [JSON.parse(data)] : [];
    }) : [];
    failed = response.status !== 200 || report.events.some(event => event.type === 'RUN_ERROR') || !report.events.some(event => event.type === 'RUN_FINISHED' && event.threadId === report.threadId && event.runId === report.runId);
  }
  report.after = await capture(await fetch(origin + '/workspace', { signal }));
  if (report.after.status !== 200) failed = true;
} catch (error) { failed = true; report.error = error.message; }
finally {
  try { if (app.locals.runtime) { await app.locals.runtime.close(); report.runtimeClosed = app.locals.runtime.closed; } }
  catch (error) { failed = true; report.runtimeCleanupError = error.message; }
  try { if (server) { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); report.serverClosed = !server.listening; } }
  catch (error) { failed = true; report.serverCleanupError = error.message; }
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(name, stop);
}
if (chat) {
  try {
    const matches = [];
    for (const entry of await readdir(receipts, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Invalid private receipt directory.');
      const path = join(receipts, entry.name, 'receipt.json'), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new Error('Invalid private receipt file.');
      const body = JSON.parse(await readFile(path, 'utf8'));
      if (body.threadId === report.threadId && body.clientRunId === report.runId) matches.push({ path, body });
    }
    if (matches.length !== 1) throw new Error('Expected exactly one correlated application receipt.');
    report.evidence = matches[0];
    if (report.evidence.body.status !== 'completed' || report.evidence.body.cleanupConfirmed !== true || report.runtimeClosed !== true) failed = true;
  } catch (error) { failed = true; report.evidenceError = error.message; }
}
console.log(JSON.stringify(report));
if (failed || signal.aborted || report.serverClosed !== true) process.exitCode = 1;

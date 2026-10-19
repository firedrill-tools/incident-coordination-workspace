import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { ApplicationError, commandMain, invokeCLI, privateDirectory } from './adapter-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const cases = new Set(JSON.parse(readFileSync(new URL('../backend/data/index.json', import.meta.url))).cases.map(item => item.id));
export async function runApplication(input, parameters, signal, invocation) {
  if (Object.keys(input).some(key => !['caseId', 'action', 'message'].includes(key)) || !cases.has(input.caseId) || !['chat', 'inspect'].includes(input.action) ||
      (input.action === 'chat' ? typeof input.message !== 'string' || !input.message.trim() || input.message.length > 8000 || input.message.includes('\0') : input.message !== null)) throw new Error('Select a reviewed case and bounded chat message or inspection; commander decisions are separate.');
  const directory = await privateDirectory(root, invocation), state = join(directory, 'workspace.json');
  try {
    await invokeCLI([process.execPath, 'backend/dist/src/cli.js', 'init', '--case', input.caseId, '--workspace', state], { cwd: root, signal });
    const output = await invokeCLI([process.execPath, 'firedrill/request.mjs', JSON.stringify(input), state, directory, parameters.model ?? ''], { cwd: root, signal, timeoutMs: 210000 });
    return { application: output, localState: { directory, workspaceFile: state } };
  } catch (error) { if (error instanceof ApplicationError) error.evidence.runDirectory = directory; throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await commandMain(runApplication);

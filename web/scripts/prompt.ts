/**
 * Utilidades de entrada por consola para los scripts de gestión.
 * En modo TTY (interactivo) la contraseña no tiene eco.
 * En modo no-TTY (pipe, tests) se leen todas las líneas al inicio
 * en un buffer y se consumen una a una por cada pregunta.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

// Buffer de respuestas en modo no-TTY
let _buf: string[] | null = null;

async function loadBuffer(): Promise<void> {
  if (_buf !== null || process.stdin.isTTY) return;
  _buf = await new Promise<string[]>((resolve) => {
    const lines: string[] = [];
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.on('line', (l) => lines.push(l.trim()));
    rl.on('close', () => resolve(lines));
  });
}

/** Lee una línea. En modo TTY: prompt interactivo; en pipe: siguiente línea del buffer. */
export async function askLine(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    await loadBuffer();
    process.stdout.write(prompt);
    const answer = _buf!.shift() ?? '';
    process.stdout.write(answer + '\n');
    return answer;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (a) => { rl.close(); resolve(a.trim()); });
  });
}

/** Lee una contraseña sin eco (en TTY). En modo no-interactivo: igual que askLine. */
export async function askPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return askLine(prompt);
  }
  const muted = new Writable({ write(_c, _e, cb) { cb(); } });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    rl.question('', (password) => {
      process.stdout.write('\n');
      rl.close();
      resolve(password);
    });
  });
}

/** Finaliza con mensaje de error. */
export function die(msg: string): never {
  console.error('\nERROR:', msg);
  process.exit(1);
}

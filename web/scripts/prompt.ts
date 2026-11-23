/**
 * Utilidades de entrada por consola para los scripts de gestión.
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/** Lee una línea con eco normal. */
export function askLine(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

/** Lee una contraseña sin eco. */
export function askPassword(prompt: string): Promise<string> {
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

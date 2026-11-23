/**
 * Cambia la contraseña de un usuario: hashea con argon2id, resetea intentos
 * y bloqueo, invalida sesiones y dispositivos de confianza. Todo atómico.
 * Uso: npm run user:set-password <email>
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import * as schema from '../src/db/schema';
import { askPassword, die } from './prompt';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

async function main() {
  const emailArg = process.argv[2]?.trim().toLowerCase();
  if (!emailArg) die('Uso: npm run user:set-password <email>');

  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, emailArg),
  });
  if (!user) die(`No existe el usuario: ${emailArg}`);

  console.log(`\n── Cambiar contraseña: ${emailArg} ─────────────────────────\n`);

  const password = await askPassword('Nueva contraseña (sin eco): ');
  if (password.length < 12) die('La contraseña debe tener al menos 12 caracteres.');
  const confirm = await askPassword('Confirmar contraseña: ');
  if (password !== confirm) die('Las contraseñas no coinciden.');

  const passwordHash = await hash(password);

  let sessionsCount = 0;
  let devicesCount = 0;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({
        passwordHash,
        passwordAttempts:    0,
        passwordLockedUntil: null,
        updatedAt:           new Date(),
      })
      .where(eq(schema.users.id, user.id));

    const sessions = await tx
      .delete(schema.sessions)
      .where(eq(schema.sessions.userId, user.id))
      .returning({ id: schema.sessions.id });
    sessionsCount = sessions.length;

    const devices = await tx
      .delete(schema.trustedDevices)
      .where(eq(schema.trustedDevices.userId, user.id))
      .returning({ id: schema.trustedDevices.id });
    devicesCount = devices.length;

    await tx.insert(schema.auditLog).values({
      userId:   user.id,
      event:    'password_changed',
      metadata: { source: 'cli' },
    });
  });

  console.log(`\nOK  Contraseña actualizada para ${emailArg}`);
  console.log(`    Sesiones invalidadas:               ${sessionsCount}`);
  console.log(`    Dispositivos de confianza borrados: ${devicesCount}`);
  console.log('\n───────────────────────────────────────────────────────────\n');

  await client.end();
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });

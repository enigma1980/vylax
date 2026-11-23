/**
 * Cambia la contraseña de un usuario, invalida todas sus sesiones y
 * dispositivos de confianza, y registra el evento en audit_log.
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
  const email = process.argv[2]?.trim();
  if (!email) die('Uso: npm run user:set-password <email>');

  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!user) die(`No existe el usuario: ${email}`);

  console.log(`\n── Cambiar contraseña: ${email} ────────────────────────────\n`);

  const password = await askPassword('Nueva contraseña (sin eco): ');
  if (password.length < 8) die('La contraseña debe tener al menos 8 caracteres.');
  const confirm = await askPassword('Confirmar contraseña: ');
  if (password !== confirm) die('Las contraseñas no coinciden.');

  const passwordHash = await hash(password);

  await db
    .update(schema.users)
    .set({ passwordHash, passwordAttempts: 0, updatedAt: new Date() })
    .where(eq(schema.users.id, user.id));

  // Invalidar todas las sesiones y dispositivos de confianza
  const sessionsDeleted = await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, user.id))
    .returning({ id: schema.sessions.id });

  const devicesDeleted = await db
    .delete(schema.trustedDevices)
    .where(eq(schema.trustedDevices.userId, user.id))
    .returning({ id: schema.trustedDevices.id });

  await db.insert(schema.auditLog).values({
    userId: user.id,
    event:  'password_changed',
    metadata: { via: 'user:set-password' },
  });

  console.log(`\nOK  Contraseña actualizada para ${email}`);
  console.log(`    Sesiones invalidadas:            ${sessionsDeleted.length}`);
  console.log(`    Dispositivos de confianza borrados: ${devicesDeleted.length}`);
  console.log('\n───────────────────────────────────────────────────────────\n');

  await client.end();
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });

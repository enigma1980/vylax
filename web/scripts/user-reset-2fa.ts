/**
 * Resetea el 2FA de un usuario, invalida todas sus sesiones y
 * dispositivos de confianza, y registra el evento en audit_log.
 * El usuario deberá configurar el 2FA en el próximo inicio de sesión.
 * Uso: npm run user:reset-2fa <email>
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema';
import { askLine, die } from './prompt';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

async function main() {
  const email = process.argv[2]?.trim();
  if (!email) die('Uso: npm run user:reset-2fa <email>');

  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (!user) die(`No existe el usuario: ${email}`);

  console.log(`\n── Resetear 2FA: ${email} ──────────────────────────────────`);
  console.log(`   Método actual: ${user.twoFaMethod ?? 'no configurado'}\n`);

  const confirm = await askLine('¿Confirmar reset? Escribe "si" para continuar: ');
  if (confirm.toLowerCase() !== 'si') die('Cancelado.');

  await db
    .update(schema.users)
    .set({
      twoFaMethod:          null,
      totpVerified:         false,
      totpSecretEncrypted:  null,
      totpLastStep:         null,
      recoveryCodes:        null,
      emailCodeHash:        null,
      emailCodeExpiresAt:   null,
      emailCodeAttempts:    0,
      updatedAt:            new Date(),
    })
    .where(eq(schema.users.id, user.id));

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
    event:  '2fa_reset',
    metadata: { via: 'user:reset-2fa', previous_method: user.twoFaMethod },
  });

  console.log(`\nOK  2FA reseteado para ${email}`);
  console.log(`    El usuario deberá configurar 2FA en el próximo login.`);
  console.log(`    Sesiones invalidadas:            ${sessionsDeleted.length}`);
  console.log(`    Dispositivos de confianza borrados: ${devicesDeleted.length}`);
  console.log('\n───────────────────────────────────────────────────────────\n');

  await client.end();
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });

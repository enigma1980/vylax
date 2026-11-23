/**
 * Resetea el 2FA de un usuario: borra secreto, códigos y email_code_*.
 * Invalida sesiones y dispositivos de confianza. Todo atómico.
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
  const emailArg = process.argv[2]?.trim().toLowerCase();
  if (!emailArg) die('Uso: npm run user:reset-2fa <email>');

  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, emailArg),
  });
  if (!user) die(`No existe el usuario: ${emailArg}`);

  console.log(`\n── Resetear 2FA: ${emailArg} ───────────────────────────────`);
  console.log(`   Método actual: ${user.twoFaMethod ?? 'no configurado'}\n`);

  const confirm = await askLine('¿Confirmar reset? Escribe "si" para continuar: ');
  if (confirm.trim().toLowerCase() !== 'si') die('Cancelado.');

  let sessionsCount = 0;
  let devicesCount = 0;
  const previousMethod = user.twoFaMethod;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({
        twoFaMethod:         null,
        totpVerified:        false,
        totpSecretEncrypted: null,
        totpLastStep:        null,
        recoveryCodes:       null,
        emailCodeHash:       null,
        emailCodeExpiresAt:  null,
        emailCodeAttempts:   0,
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
      event:    '2fa_reset',
      metadata: { source: 'cli', previous_method: previousMethod },
    });
  });

  console.log(`\nOK  2FA reseteado para ${emailArg}`);
  console.log(`    El usuario deberá configurar 2FA en el próximo login.`);
  console.log(`    Sesiones invalidadas:               ${sessionsCount}`);
  console.log(`    Dispositivos de confianza borrados: ${devicesCount}`);
  console.log('\n───────────────────────────────────────────────────────────\n');

  await client.end();
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });

/**
 * Crea una sesión de demo autenticada para hacer capturas de pantalla del panel.
 * Uso: npm run demo:session
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema.js';
import { createHash } from 'crypto';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

async function main() {
  const user = await db.query.users.findFirst();
  const org  = await db.query.organizations.findFirst();

  if (!user || !org) {
    console.log('No hay usuarios ni organizaciones. Ejecuta npm run db:seed y npm run user:create primero.');
    await client.end();
    process.exit(1);
  }

  console.log('Usuario:', user.id, user.email);
  console.log('Org:', org.id, org.name);

  const token     = 'demo_screenshot_' + Date.now();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const now       = new Date();
  const exp       = new Date(now.getTime() + 2 * 3600_000);

  await db.insert(schema.sessions).values({
    tokenHash,
    userId: user.id,
    orgId: org.id,
    mfaVerifiedAt: now,
    lastActiveAt: now,
    expiresAt: exp,
  });

  console.log('\nSesión creada. Cookie:');
  console.log(`session_token=${token}`);
  await client.end();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

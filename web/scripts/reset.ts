/**
 * Script de desarrollo: destruye el esquema completo, aplica todas las
 * migraciones y vuelve a ejecutar el seed.
 * NO funciona si NODE_ENV=production.
 * Uso: npm run db:reset
 */
import path from 'path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../src/db/schema';
import {
  generateEnrollmentToken,
  sha256hex,
  tokenPrefix,
} from '../src/lib/crypto';

if (process.env.NODE_ENV === 'production') {
  console.error('db:reset no esta permitido en produccion (NODE_ENV=production)');
  process.exit(1);
}

const client = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
const db = drizzle(client, { schema });

async function main() {
  console.log('\n⚠  Destruyendo esquemas...\n');
  await client`DROP SCHEMA IF EXISTS public CASCADE`;
  await client`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await client`CREATE SCHEMA public`;
  console.log('OK  Esquemas vaciados.');

  console.log('\n▶  Aplicando migraciones...\n');
  await migrate(db, {
    migrationsFolder: path.join(__dirname, '../src/db/migrations'),
  });
  console.log('OK  Migraciones aplicadas.');

  // --- Seed -----------------------------------------------------------------
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Global-Link', slug: 'global-link' })
    .returning();
  console.log('OK  Organizacion:', org.name, org.id);

  const [client_] = await db
    .insert(schema.clients)
    .values({ organizationId: org.id, name: 'Cliente Demo' })
    .returning();
  console.log('OK  Cliente:     ', client_.name, client_.id);

  const [site] = await db
    .insert(schema.sites)
    .values({ organizationId: org.id, clientId: client_.id, name: 'Sede Principal' })
    .returning();
  console.log('OK  Sede:        ', site.name, site.id);

  const rawToken = generateEnrollmentToken();
  await db.insert(schema.enrollmentTokens).values({
    organizationId: org.id,
    clientId: client_.id,
    siteId: site.id,
    tokenHash: sha256hex(rawToken),
    tokenPrefix: tokenPrefix(rawToken),
    label: 'Token desarrollo',
  });

  console.log('OK  Sin usuario por defecto. Usa npm run user:create para crear uno.');

  console.log('\n' + '='.repeat(60));
  console.log('  TOKEN DE ALTA (solo se muestra ahora)');
  console.log('  Organizacion: ' + org.name);
  console.log('  Cliente:      ' + client_.name);
  console.log('  Sede:         ' + site.name);
  console.log('  Prefijo:      ' + tokenPrefix(rawToken));
  console.log('  Token:        ' + rawToken);
  console.log('='.repeat(60) + '\n');

  await client.end();
  console.log('OK  Reset y seed completados.\n');
}

main().catch((err) => {
  console.error('ERROR en db:reset:', err);
  process.exit(1);
});

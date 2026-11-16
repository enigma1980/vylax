/**
 * Script de desarrollo: vacía todas las tablas y vuelve a ejecutar el seed.
 * NO funciona si NODE_ENV=production.
 * Uso: npm run db:reset
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
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

// onnotice: suppress the TRUNCATE cascade NOTICEs
const client = postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
const db = drizzle(client, { schema });

async function main() {
  console.log('\n⚠  Vaciando todas las tablas...\n');

  // TRUNCATE + CASCADE borra en cascada todas las tablas dependientes.
  // Las UUIDs se generan con gen_random_uuid(), no con secuencias,
  // por lo que RESTART IDENTITY no tiene efecto aquí pero no daña.
  await client`TRUNCATE organizations, users RESTART IDENTITY CASCADE`;

  console.log('OK  Tablas vaciadas.');

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

  const passwordHash = sha256hex('Vylax_Dev_2026!');
  await db
    .insert(schema.users)
    .values({ email: 'admin@vylax.local', passwordHash, isPlatformAdmin: true })
    .onConflictDoNothing();
  console.log('OK  Admin:        admin@vylax.local');

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

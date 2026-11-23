/**
 * Script de semilla para desarrollo.
 * Crea: organización Global-Link, cliente Demo, sede Sede Principal y un token de alta.
 * Sin usuario por defecto; usar npm run user:create para crear el primer usuario.
 *
 * Uso: npm run db:seed
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import {
  generateEnrollmentToken,
  sha256hex,
  tokenPrefix,
} from '../src/lib/crypto';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

async function main() {
  console.log('▶  Iniciando seed...\n');

  // Organización
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: 'Global-Link', slug: 'global-link' })
    .onConflictDoNothing()
    .returning();

  if (!org) {
    // Ya existía; buscarla
    const existing = await db.query.organizations.findFirst({
      where: (o, { eq }) => eq(o.slug, 'global-link'),
    });
    if (!existing) throw new Error('No se pudo crear ni encontrar la organización');
    console.log('ℹ  Organización ya existente:', existing.id);
    await client.end();
    return;
  }
  console.log('✔  Organización:', org.name, org.id);

  // Cliente
  const [client_] = await db
    .insert(schema.clients)
    .values({ organizationId: org.id, name: 'Cliente Demo' })
    .returning();
  console.log('✔  Cliente:', client_.name, client_.id);

  // Sede
  const [site] = await db
    .insert(schema.sites)
    .values({ organizationId: org.id, clientId: client_.id, name: 'Sede Principal' })
    .returning();
  console.log('✔  Sede:', site.name, site.id);

  // Token de alta
  const rawToken = generateEnrollmentToken();
  const tokenHash_ = sha256hex(rawToken);
  const prefix = tokenPrefix(rawToken);

  await db.insert(schema.enrollmentTokens).values({
    organizationId: org.id,
    clientId: client_.id,
    siteId: site.id,
    tokenHash: tokenHash_,
    tokenPrefix: prefix,
    label: 'Token desarrollo',
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TOKEN DE ALTA (solo se muestra ahora)');
  console.log('  Organización:', org.name);
  console.log('  Cliente:     ', client_.name);
  console.log('  Sede:        ', site.name);
  console.log('  Prefijo:     ', prefix);
  console.log('  Token:       ', rawToken);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  await client.end();
  console.log('✔  Seed completado.');
}

main().catch((err) => {
  console.error('✖  Error en seed:', err);
  process.exit(1);
});

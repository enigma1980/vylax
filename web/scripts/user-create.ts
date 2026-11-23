/**
 * Crea un nuevo usuario de la plataforma o añade uno existente a otra
 * organización. No modifica la contraseña si el usuario ya existe.
 * Uso: npm run user:create
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import * as schema from '../src/db/schema';
import { askLine, askPassword, die } from './prompt';

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

async function askRole(): Promise<'admin' | 'technician'> {
  console.log('\nRol en la organización:');
  console.log('  1. admin');
  console.log('  2. technician');
  const choice = await askLine('Número de rol: ');
  if (choice === '1') return 'admin';
  if (choice === '2') return 'technician';
  die('Rol no válido (escribe 1 o 2).');
}

async function main() {
  console.log('\n── Crear / añadir usuario ─────────────────────────────────\n');

  // Cargar organizaciones antes de preguntar nada
  const orgs = await db.select().from(schema.organizations);
  if (orgs.length === 0) die('No hay organizaciones. Ejecuta npm run db:reset primero.');

  // Correo: trim + minúsculas
  const emailRaw = await askLine('Correo electrónico: ');
  const email = emailRaw.trim().toLowerCase();
  if (!email.includes('@')) die('Correo no válido.');

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  if (existing) {
    // ── Caso: usuario ya existe → ofrecer añadirlo a otra organización ──
    console.log(`\nEl usuario ${email} ya existe (contraseña no se toca).`);

    const memberships = await db
      .select({ orgId: schema.userOrganizations.orgId })
      .from(schema.userOrganizations)
      .where(eq(schema.userOrganizations.userId, existing.id));

    const memberOrgIds = new Set(memberships.map(m => m.orgId));
    const freeOrgs = orgs.filter(o => !memberOrgIds.has(o.id));

    if (freeOrgs.length === 0) {
      die(`${email} ya pertenece a todas las organizaciones disponibles.`);
    }

    console.log('\nOrganizaciones disponibles (aún no vinculado):');
    freeOrgs.forEach((o, i) => console.log(`  ${i + 1}. ${o.name} (${o.slug})`));

    const orgIdx = parseInt(await askLine('Número de organización (Enter = cancelar): '), 10) - 1;
    if (isNaN(orgIdx) || orgIdx < 0 || orgIdx >= freeOrgs.length) die('Cancelado.');
    const org = freeOrgs[orgIdx];
    const role = await askRole();

    await db.transaction(async (tx) => {
      await tx.insert(schema.userOrganizations).values({
        userId: existing.id,
        orgId:  org.id,
        role,
      });
      await tx.insert(schema.auditLog).values({
        userId:   existing.id,
        orgId:    org.id,
        event:    'membership_added',
        metadata: { source: 'cli' },
      });
    });

    console.log(`\nOK  ${email} añadido a ${org.name} como ${role}`);
  } else {
    // ── Caso: usuario nuevo ──
    const password = await askPassword('Contraseña (sin eco): ');
    if (password.length < 12) die('La contraseña debe tener al menos 12 caracteres.');
    const confirm = await askPassword('Confirmar contraseña: ');
    if (password !== confirm) die('Las contraseñas no coinciden.');

    console.log('\nOrganizaciones disponibles:');
    orgs.forEach((o, i) => console.log(`  ${i + 1}. ${o.name} (${o.slug})`));

    const orgIdx = parseInt(await askLine('Número de organización: '), 10) - 1;
    if (isNaN(orgIdx) || orgIdx < 0 || orgIdx >= orgs.length) die('Selección no válida.');
    const org = orgs[orgIdx];
    const role = await askRole();

    const passwordHash = await hash(password);

    await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(schema.users)
        .values({ email, passwordHash })
        .returning({ id: schema.users.id });

      await tx.insert(schema.userOrganizations).values({
        userId: user.id,
        orgId:  org.id,
        role,
      });

      await tx.insert(schema.auditLog).values([
        { userId: user.id, event: 'user_created',   metadata: { source: 'cli' } },
        { userId: user.id, orgId: org.id, event: 'membership_added', metadata: { source: 'cli' } },
      ]);
    });

    console.log(`\nOK  Usuario creado: ${email}`);
    console.log(`    Organización:   ${org.name} (${role})`);
  }

  console.log('\n───────────────────────────────────────────────────────────\n');
  await client.end();
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });

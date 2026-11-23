/**
 * Crea un nuevo usuario de la plataforma y lo vincula a una organización.
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

async function main() {
  console.log('\n── Crear usuario ──────────────────────────────────────────\n');

  // Correo
  const email = await askLine('Correo electrónico: ');
  if (!email.includes('@')) die('Correo no válido.');

  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (existing) die(`El usuario ${email} ya existe.`);

  // Contraseña
  const password = await askPassword('Contraseña (sin eco): ');
  if (password.length < 8) die('La contraseña debe tener al menos 8 caracteres.');
  const confirm = await askPassword('Confirmar contraseña: ');
  if (password !== confirm) die('Las contraseñas no coinciden.');

  // Organización
  const orgs = await db.select().from(schema.organizations);
  if (orgs.length === 0) die('No hay organizaciones. Ejecuta npm run db:reset primero.');

  console.log('\nOrganizaciones disponibles:');
  orgs.forEach((o, i) => console.log(`  ${i + 1}. ${o.name} (${o.slug})`));
  const orgIdx = parseInt(await askLine('Número de organización: '), 10) - 1;
  if (isNaN(orgIdx) || orgIdx < 0 || orgIdx >= orgs.length) die('Selección no válida.');
  const org = orgs[orgIdx];

  // Rol
  console.log('\nRol en la organización:');
  console.log('  1. admin');
  console.log('  2. technician');
  const rolChoice = await askLine('Número de rol: ');
  const role = rolChoice === '1' ? 'admin' : rolChoice === '2' ? 'technician' : null;
  if (!role) die('Rol no válido.');

  // Crear usuario
  const passwordHash = await hash(password);
  const [user] = await db
    .insert(schema.users)
    .values({ email, passwordHash })
    .returning({ id: schema.users.id });

  await db.insert(schema.userOrganizations).values({
    userId: user.id,
    orgId:  org.id,
    role,
  });

  console.log(`\nOK  Usuario creado: ${email}`);
  console.log(`    Organización:   ${org.name} (${role})`);
  console.log('\n───────────────────────────────────────────────────────────\n');

  await client.end();
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });

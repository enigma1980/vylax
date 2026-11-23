/**
 * Tests del endpoint GET /api/search
 * Requiere DATABASE_URL y servidor en localhost:3000 →
 *   npm run test:search
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { hash as argon2Hash } from '@node-rs/argon2';
import { createHash } from 'crypto';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const skip     = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:search)'
  : false;

const client = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null as never;
const db     = client ? drizzle(client, { schema }) : null as never;

const TEST_EMAIL = 'test_search_user@test.vylax';
const TEST_PW    = 'TestPassword2026!!';

let orgId1: string;
let orgId2: string;
let sessionCookie: string;

async function get(path: string, cookie = '') {
  return fetch(`${BASE_URL}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
  });
}

async function post(path: string, body: unknown, cookie = '') {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
}

function parseCookie(res: Response, name: string): string | null {
  const header = res.headers.get('set-cookie') ?? '';
  const match  = header.split(',').join(';').split(';').find(p => p.trim().startsWith(`${name}=`));
  return match ? match.trim().slice(name.length + 1) : null;
}

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

function randomToken() {
  return createHash('sha256').update(String(Math.random())).digest('hex');
}

before(async () => {
  if (skip) return;

  const pwHash = await argon2Hash(TEST_PW);

  // Limpiar datos previos
  const existing = await db.query.users.findFirst({ where: eq(schema.users.email, TEST_EMAIL) });
  if (existing) {
    await db.delete(schema.userOrganizations).where(eq(schema.userOrganizations.userId, existing.id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, existing.id));
    await db.delete(schema.users).where(eq(schema.users.id, existing.id));
  }
  // Limpiar orgs de test
  for (const slug of ['test-search-org1', 'test-search-org2']) {
    const orgs = await db.select().from(schema.organizations).where(eq(schema.organizations.slug, slug));
    for (const org of orgs) {
      await db.delete(schema.clients).where(eq(schema.clients.organizationId, org.id));
      await db.delete(schema.devices).where(eq(schema.devices.organizationId, org.id));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, org.id));
    }
  }

  // Crear orgs
  const [org1] = await db.insert(schema.organizations).values({ name: 'SearchOrg1', slug: 'test-search-org1' }).returning({ id: schema.organizations.id });
  const [org2] = await db.insert(schema.organizations).values({ name: 'SearchOrg2', slug: 'test-search-org2' }).returning({ id: schema.organizations.id });
  orgId1 = org1.id; orgId2 = org2.id;

  // Crear clientes en org1 y org2
  await db.insert(schema.clients).values([
    { organizationId: orgId1, name: 'Cliente Principal SL' },
    { organizationId: orgId1, name: 'Empresa de Prueba SA' },
    { organizationId: orgId2, name: 'OtraOrg Cliente Secreto' },
  ]);

  // Crear dispositivos en org1 y org2
  const credHash = sha256('devicesecret');
  await db.insert(schema.devices).values([
    { organizationId: orgId1, hostname: 'servidor-produccion', publicIp: '1.2.3.4', credentialHash: credHash, status: 'active' },
    { organizationId: orgId2, hostname: 'equipo-otra-org', publicIp: '9.9.9.9', credentialHash: credHash, status: 'active' },
  ]);

  // Crear usuario en org1 (con 2FA ya configurado por email para facilitar test)
  const [user] = await db.insert(schema.users).values({
    email: TEST_EMAIL,
    passwordHash: pwHash,
    twoFaMethod: 'email',
  }).returning({ id: schema.users.id });

  await db.insert(schema.userOrganizations).values({ userId: user.id, orgId: orgId1, role: 'admin' });

  // Crear sesión completamente verificada (mfaVerifiedAt seteado)
  const token = randomToken();
  const tokenHash = sha256(token);
  const now   = new Date();
  const exp   = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  await db.insert(schema.sessions).values({
    tokenHash,
    userId: user.id,
    orgId: orgId1,
    mfaVerifiedAt: now,
    lastActiveAt: now,
    expiresAt: exp,
  });

  sessionCookie = `session_token=${token}`;
});

after(async () => {
  if (skip) return;
  // Limpiar todo lo creado
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, TEST_EMAIL) });
  if (user) {
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    await db.delete(schema.userOrganizations).where(eq(schema.userOrganizations.userId, user.id));
    await db.delete(schema.users).where(eq(schema.users.id, user.id));
  }
  for (const slug of ['test-search-org1', 'test-search-org2']) {
    const orgs = await db.select().from(schema.organizations).where(eq(schema.organizations.slug, slug));
    for (const org of orgs) {
      await db.delete(schema.devices).where(eq(schema.devices.organizationId, org.id));
      await db.delete(schema.clients).where(eq(schema.clients.organizationId, org.id));
      await db.delete(schema.organizations).where(eq(schema.organizations.id, org.id));
    }
  }
  await client.end();
});

describe('GET /api/search', { skip }, () => {
  test('devuelve 401 sin sesión', async () => {
    const res = await get('/api/search?q=cliente');
    assert.equal(res.status, 401);
  });

  test('devuelve 401 con sesión inválida', async () => {
    const res = await get('/api/search?q=cliente', 'session_token=invalido');
    assert.equal(res.status, 401);
  });

  test('devuelve arrays vacíos con q menor de 2 caracteres', async () => {
    const res = await get('/api/search?q=a', sessionCookie);
    assert.equal(res.status, 200);
    const data = await res.json() as { clients: unknown[]; devices: unknown[] };
    assert.equal(data.clients.length, 0);
    assert.equal(data.devices.length, 0);
  });

  test('encuentra clientes de la org activa', async () => {
    const res = await get('/api/search?q=Principal', sessionCookie);
    assert.equal(res.status, 200);
    const data = await res.json() as { clients: { name: string }[]; devices: unknown[] };
    assert.ok(data.clients.some(c => c.name === 'Cliente Principal SL'), 'debe encontrar Cliente Principal SL');
  });

  test('no devuelve datos de otra organización', async () => {
    const res = await get('/api/search?q=Secreto', sessionCookie);
    assert.equal(res.status, 200);
    const data = await res.json() as { clients: unknown[]; devices: unknown[] };
    assert.equal(data.clients.length, 0, 'no debe devolver clientes de otra org');
    assert.equal(data.devices.length, 0, 'no debe devolver equipos de otra org');
  });

  test('no devuelve equipos de otra organización', async () => {
    const res = await get('/api/search?q=otra', sessionCookie);
    assert.equal(res.status, 200);
    const data = await res.json() as { clients: unknown[]; devices: { hostname: string }[] };
    assert.ok(!data.devices.some(d => d.hostname === 'equipo-otra-org'), 'no debe devolver equipos de otra org');
  });

  test('encuentra equipo por hostname', async () => {
    const res = await get('/api/search?q=servidor', sessionCookie);
    assert.equal(res.status, 200);
    const data = await res.json() as { clients: unknown[]; devices: { hostname: string }[] };
    assert.ok(data.devices.some(d => d.hostname === 'servidor-produccion'));
  });

  test('encuentra equipo por IP pública', async () => {
    const res = await get('/api/search?q=1.2.3', sessionCookie);
    assert.equal(res.status, 200);
    const data = await res.json() as { clients: unknown[]; devices: { hostname: string }[] };
    assert.ok(data.devices.some(d => d.hostname === 'servidor-produccion'));
  });

  test('% no rompe la consulta ni devuelve todo', async () => {
    const res = await get('/api/search?q=%25', sessionCookie);
    assert.equal(res.status, 200);
    const data = await res.json() as { clients: unknown[]; devices: unknown[] };
    assert.equal(data.clients.length, 0, '% solo no debe devolver resultados');
    assert.equal(data.devices.length, 0);
  });

  test('_ no devuelve todo', async () => {
    const res = await get('/api/search?q=__', sessionCookie);
    assert.equal(res.status, 200);
    const data = await res.json() as { clients: unknown[]; devices: unknown[] };
    // _ solo no debería coincidir con nuestros datos de prueba específicos
    // (es un comodín si no se escapa, devolvería TODO; con escape no devuelve nada relevante)
    const clientNames  = (data.clients as { name: string }[]).map(c => c.name);
    const deviceNames  = (data.devices as { hostname: string }[]).map(d => d.hostname);
    const allNames     = [...clientNames, ...deviceNames];
    const hasSecretData = allNames.some(n => n.includes('Secreto') || n.includes('otra-org'));
    assert.ok(!hasSecretData, '_ no debe devolver datos de otra org');
  });

  test('comillas simples no rompen la consulta', async () => {
    const res = await get(`/api/search?q=${encodeURIComponent("O'Reilly")}`, sessionCookie);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(typeof data === 'object');
  });

  test('devuelve máximo 5 resultados por grupo', async () => {
    // Con 2 clientes en org1 que coinciden con "Empresa" y "Principal", max 5 no se supera
    const res = await get('/api/search?q=le', sessionCookie);
    assert.equal(res.status, 200);
    const data = await res.json() as { clients: unknown[]; devices: unknown[] };
    assert.ok(data.clients.length <= 5, 'máximo 5 clientes');
    assert.ok(data.devices.length <= 5, 'máximo 5 equipos');
  });
});

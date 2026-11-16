/**
 * Tests de idempotencia: enviar el mismo JSON dos veces no debe duplicar filas.
 * Requiere DATABASE_URL en el entorno → ejecutar con:
 *   npm run test:integration
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { randomBytes } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { count, eq, and, desc } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { sha256hex, generateDeviceSecret, generateEnrollmentToken, tokenPrefix } from '../src/lib/crypto.js';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

const skip = !process.env.DATABASE_URL
  ? 'requiere DATABASE_URL (ejecuta con npm run test:integration)'
  : false;

// ---------------------------------------------------------------------------
// Fixture: reproduce el lote real del agente
// ---------------------------------------------------------------------------
const PERIOD_START  = '2026-11-16T14:52:35Z';
const PERIOD_END    = '2026-11-16T14:52:54Z';
const COLLECTED_AT  = '2026-11-16T14:52:54Z';
const INVENTORY_HASH = 'sha256:cc3e3ce7751097c5475b87b452de737ec39d32b1f43921f28045e477b75f44c8';

// ---------------------------------------------------------------------------
// Estado del test (creado en before, destruido en after)
// ---------------------------------------------------------------------------
let client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let orgId: string;
let deviceId: string;

before(async () => {
  if (skip) return;
  client = postgres(process.env.DATABASE_URL!);
  db = drizzle(client, { schema });

  // Crear organización de prueba aislada
  const [org] = await db.insert(schema.organizations).values({
    name: 'Test-Idempotency',
    slug: `test-idempotency-${randomUUID().slice(0, 8)}`,
  }).returning();
  orgId = org.id;

  // Crear dispositivo de prueba
  const secret = generateDeviceSecret();
  const [dev] = await db.insert(schema.devices).values({
    organizationId: orgId,
    hostname:        'test-host',
    credentialHash:  sha256hex(secret),
  }).returning();
  deviceId = dev.id;

  // Crear fila inicial en device_current_state
  await db.insert(schema.deviceCurrentState).values({
    deviceId,
    organizationId: orgId,
  });
});

after(async () => {
  if (skip || !orgId) return;
  try {
    // Limpiar en orden inverso a las FK (las tablas hoja primero)
    await db.delete(schema.agentEvents)       .where(eq(schema.agentEvents.organizationId, orgId));
    await db.delete(schema.metrics5min)       .where(eq(schema.metrics5min.organizationId, orgId));
    await db.delete(schema.dailyReports)      .where(eq(schema.dailyReports.organizationId, orgId));
    await db.delete(schema.inventorySnapshots).where(eq(schema.inventorySnapshots.organizationId, orgId));
    await db.delete(schema.deviceCurrentState).where(eq(schema.deviceCurrentState.organizationId, orgId));
    await db.delete(schema.devices)           .where(eq(schema.devices.organizationId, orgId));
    await db.delete(schema.enrollmentTokens)  .where(eq(schema.enrollmentTokens.organizationId, orgId));
    await db.delete(schema.organizations)     .where(eq(schema.organizations.id, orgId));
  } finally {
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// Helpers: insertar igual que el handler de reports
// ---------------------------------------------------------------------------
async function insertMetrics() {
  return db.insert(schema.metrics5min).values({
    deviceId,
    organizationId: orgId,
    periodStart:  new Date(PERIOD_START),
    periodEnd:    new Date(PERIOD_END),
    samples:      10,
    cpuAvgPct:    18.6,
    cpuMaxPct:    40.6,
  }).onConflictDoNothing();
}

async function insertDaily() {
  return db.insert(schema.dailyReports).values({
    deviceId,
    organizationId: orgId,
    collectedAt:  new Date(COLLECTED_AT),
    physicalDisks: [{ serial: 'TEST-001', health: 'Healthy' }],
  }).onConflictDoNothing();
}

// Replica la lógica del handler: solo inserta si el hash difiere del último guardado
async function insertInventory(hash: string) {
  const latest = await db
    .select({ hash: schema.inventorySnapshots.hash })
    .from(schema.inventorySnapshots)
    .where(eq(schema.inventorySnapshots.deviceId, deviceId))
    .orderBy(desc(schema.inventorySnapshots.createdAt))
    .limit(1);

  if (!latest.length || latest[0].hash !== hash) {
    await db.insert(schema.inventorySnapshots).values({
      deviceId,
      organizationId: orgId,
      collectedAt:    new Date(),
      hash,
    });
  }
}

async function countRows(table: 'metrics' | 'daily') {
  if (table === 'metrics') {
    const rows = await db.select({ n: count() }).from(schema.metrics5min)
      .where(and(eq(schema.metrics5min.deviceId, deviceId), eq(schema.metrics5min.periodStart, new Date(PERIOD_START))));
    return rows[0].n;
  }
  const rows = await db.select({ n: count() }).from(schema.dailyReports)
    .where(and(eq(schema.dailyReports.deviceId, deviceId), eq(schema.dailyReports.collectedAt, new Date(COLLECTED_AT))));
  return rows[0].n;
}

async function countInventory() {
  const rows = await db.select({ n: count() }).from(schema.inventorySnapshots)
    .where(eq(schema.inventorySnapshots.deviceId, deviceId));
  return rows[0].n;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test('metrics_5min: el reenvío no duplica filas', { skip }, async () => {
  await insertMetrics();
  await insertMetrics();
  assert.equal(await countRows('metrics'), 1, 'debe haber exactamente 1 fila en metrics_5min');
});

test('daily_reports: el reenvío no duplica filas', { skip }, async () => {
  await insertDaily();
  await insertDaily();
  assert.equal(await countRows('daily'), 1, 'debe haber exactamente 1 fila en daily_reports');
});

test('inventory_snapshots: mismo hash consecutivo no duplica; hash distinto sí guarda', { skip }, async () => {
  await insertInventory('hash-A');
  await insertInventory('hash-A'); // igual que el último → se omite
  const afterAA = await countInventory();
  assert.equal(afterAA, 1, 'A→A debe producir 1 fila');

  await insertInventory('hash-B'); // distinto → se guarda
  const afterB = await countInventory();
  assert.equal(afterB, 2, 'A→B debe producir 2 filas');
});

test('inventory_snapshots: vuelta a hash anterior sí guarda (A→B→A)', { skip }, async () => {
  // La tabla ya tiene las 2 filas del test anterior (A, B)
  await insertInventory('hash-A'); // distinto del último (B) → se guarda
  const afterABA = await countInventory();
  assert.equal(afterABA, 3, 'A→B→A debe producir 3 filas (no rechazar la vuelta a A)');
});

// ---------------------------------------------------------------------------
// Test de reinstalación (requiere el servidor Next.js en localhost:3000)
// ---------------------------------------------------------------------------

test('enroll: reinstalación reutiliza device_id, genera nuevo secreto e invalida el anterior', { skip }, async () => {
  // 1. Crear token de alta para la organización de prueba
  const tokenRaw = generateEnrollmentToken();
  const [token] = await db.insert(schema.enrollmentTokens).values({
    organizationId: orgId,
    tokenHash:   sha256hex(tokenRaw),
    tokenPrefix: tokenPrefix(tokenRaw),
    label:       'test-reinstalacion',
  }).returning();

  // 2. Crear dispositivo existente con smbios_uuid (simula alta manual o agente anterior)
  const oldSecret = generateDeviceSecret();
  const smbiosUuid = randomUUID();
  const [existingDevice] = await db.insert(schema.devices).values({
    organizationId:      orgId,
    hostname:            'hostname-anterior',
    credentialHash:      sha256hex(oldSecret),
    hardwareSmbiousUuid: smbiosUuid,
  }).returning();

  // 3. Llamar al endpoint de alta con el mismo smbios_uuid
  const resp = await fetch(`${BASE_URL}/v1/enroll`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schema_version:   1,
      enrollment_token: tokenRaw,
      agent_version:    '0.1.0',
      hostname:         'hostname-nuevo',
      hardware_id:      { smbios_uuid: smbiosUuid },
    }),
  });

  assert.equal(resp.status, 200, `enroll debe responder 200, recibió ${resp.status}`);
  const data = await resp.json() as {
    device_id: string;
    device_secret: string;
    status: string;
    config: unknown;
  };

  // 4. Verificar que se reutilizó el device_id
  assert.equal(data.device_id, existingDevice.id, 'debe reutilizar el device_id del dispositivo existente');
  assert.ok(data.device_secret, 'debe devolver un nuevo device_secret');
  assert.notEqual(data.device_secret, oldSecret, 'el nuevo secret debe ser distinto del anterior');

  // 5. Verificar en la BD que el hash cambió y el hostname se actualizó
  const [updated] = await db
    .select({ credentialHash: schema.devices.credentialHash, hostname: schema.devices.hostname })
    .from(schema.devices)
    .where(eq(schema.devices.id, existingDevice.id));

  assert.equal(updated.hostname, 'hostname-nuevo', 'debe actualizar el hostname');
  assert.notEqual(updated.credentialHash, sha256hex(oldSecret), 'el hash del secreto anterior debe haber sido reemplazado');
  assert.equal(updated.credentialHash, sha256hex(data.device_secret), 'el hash del nuevo secreto debe coincidir con la BD');

  // 6. Verificar que el secreto anterior ya no sirve para autenticarse
  const authResp = await fetch(`${BASE_URL}/v1/config`, {
    headers: {
      'Authorization': `Bearer ${oldSecret}`,
      'X-Device-Id':   existingDevice.id,
    },
  });
  assert.equal(authResp.status, 401, 'el secreto anterior debe devolver 401');

  // 7. Verificar que el nuevo secreto sí funciona
  const authRespNew = await fetch(`${BASE_URL}/v1/config`, {
    headers: {
      'Authorization': `Bearer ${data.device_secret}`,
      'X-Device-Id':   data.device_id,
    },
  });
  assert.equal(authRespNew.status, 200, 'el nuevo secreto debe devolver 200');

  // Limpiar: el token y el dispositivo se borrarán en after() junto con la org
  void token; // referenciado para evitar lint warning
});

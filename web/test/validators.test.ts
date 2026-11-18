import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fixture = require('./fixtures/agent-report.json');

// Importamos con ruta relativa porque el test se ejecuta fuera del contexto Next.js
import { reportEnvelopeSchema } from '../src/validators/reports.js';

// ---------------------------------------------------------------------------
// Prueba principal: el fixture del agente real supera la validación
// ---------------------------------------------------------------------------
test('agent-report.json pasa la validación del contrato v1.1', () => {
  const result = reportEnvelopeSchema.safeParse(fixture);

  if (!result.success) {
    // Detallar los errores para facilitar el diagnóstico
    const issues = result.error.issues
      .map((i) => `  [${i.path.join('.')}] ${i.message}`)
      .join('\n');
    assert.fail(`Errores de validación:\n${issues}`);
  }

  assert.equal(result.data.schema_version, 1,  'schema_version debe ser 1');
  assert.equal(result.data.reports.length, 4,  'debe haber 4 informes');
});

// ---------------------------------------------------------------------------
// Pruebas por tipo de informe
// ---------------------------------------------------------------------------
test('metrics: campos obligatorios y nombres correctos', () => {
  const metrics = fixture.reports.find((r: { type: string }) => r.type === 'metrics');
  assert.ok(metrics, 'debe existir un informe metrics');

  const result = reportEnvelopeSchema.shape.reports.element.safeParse(metrics);
  assert.ok(result.success, `metrics no pasa: ${JSON.stringify(result.error?.issues)}`);

  if (result.success && result.data.type === 'metrics') {
    assert.ok('uptime_seconds' in result.data, 'uptime_seconds debe estar presente');
    assert.ok(result.data.agent?.cpu_avg_pct !== undefined, 'agent.cpu_avg_pct debe estar presente');
    assert.ok(!('collected_at' in result.data), 'metrics no debe tener collected_at');
  }
});

test('inventory: sin collected_at, con system/cpu/os', () => {
  const inv = fixture.reports.find((r: { type: string }) => r.type === 'inventory');
  assert.ok(inv, 'debe existir un informe inventory');

  const result = reportEnvelopeSchema.shape.reports.element.safeParse(inv);
  assert.ok(result.success, `inventory no pasa: ${JSON.stringify(result.error?.issues)}`);

  if (result.success && result.data.type === 'inventory') {
    assert.ok(!('collected_at' in result.data), 'inventory no debe tener collected_at');
    assert.ok(result.data.system !== undefined, 'inventory debe tener system');
    assert.ok(result.data.cpu    !== undefined, 'inventory debe tener cpu');
    assert.ok(result.data.os     !== undefined, 'inventory debe tener os');
  }
});

test('status: campos opcionales presentes en fixture', () => {
  const status = fixture.reports.find((r: { type: string }) => r.type === 'status');
  assert.ok(status, 'debe existir un informe status');

  const result = reportEnvelopeSchema.shape.reports.element.safeParse(status);
  assert.ok(result.success, `status no pasa: ${JSON.stringify(result.error?.issues)}`);
});

test('daily: physical_disks con campos opcionales (temperature_c, wear_pct)', () => {
  const daily = fixture.reports.find((r: { type: string }) => r.type === 'daily');
  assert.ok(daily, 'debe existir un informe daily');

  const result = reportEnvelopeSchema.shape.reports.element.safeParse(daily);
  assert.ok(result.success, `daily no pasa: ${JSON.stringify(result.error?.issues)}`);
});

test('schema_version como entero, no string', () => {
  const wrongVersion = { ...fixture, schema_version: '1.0' };
  const result = reportEnvelopeSchema.safeParse(wrongVersion);
  assert.ok(!result.success, 'schema_version string debe fallar la validación');
});

// ---------------------------------------------------------------------------
// Contrato v1.2: eventos de suspensión y reanudación
// ---------------------------------------------------------------------------
test('evento suspend pasa la validación', () => {
  const env = {
    schema_version: 1,
    agent_version: '0.1.0',
    sent_at: '2026-11-18T10:00:00Z',
    reports: [{
      type: 'event',
      event: 'suspend',
      occurred_at: '2026-11-18T10:00:00Z',
    }],
  };
  const result = reportEnvelopeSchema.safeParse(env);
  assert.ok(result.success, `evento suspend no pasa: ${JSON.stringify(result.error?.issues)}`);
  if (result.success) {
    const ev = result.data.reports[0];
    assert.equal(ev.type, 'event');
    if (ev.type === 'event') assert.equal(ev.event, 'suspend');
  }
});

test('evento resume pasa la validación', () => {
  const env = {
    schema_version: 1,
    agent_version: '0.1.0',
    sent_at: '2026-11-18T10:05:00Z',
    reports: [{
      type: 'event',
      event: 'resume',
      occurred_at: '2026-11-18T10:05:00Z',
    }],
  };
  const result = reportEnvelopeSchema.safeParse(env);
  assert.ok(result.success, `evento resume no pasa: ${JSON.stringify(result.error?.issues)}`);
  if (result.success) {
    const ev = result.data.reports[0];
    assert.equal(ev.type, 'event');
    if (ev.type === 'event') assert.equal(ev.event, 'resume');
  }
});

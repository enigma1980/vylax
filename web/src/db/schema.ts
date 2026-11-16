import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  real,
  jsonb,
  timestamp,
  bigint,
  date,
  varchar,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Timestamps UTC
// ---------------------------------------------------------------------------
const tstz = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// Organizaciones (inquilinos del SaaS)
// ---------------------------------------------------------------------------
export const organizations = pgTable('organizations', {
  id:        uuid('id').primaryKey().defaultRandom(),
  name:      text('name').notNull(),
  slug:      text('slug').notNull().unique(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Usuarios de la plataforma
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id:              uuid('id').primaryKey().defaultRandom(),
  email:           text('email').notNull().unique(),
  passwordHash:    text('password_hash').notNull(),
  totpSecret:      text('totp_secret'),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  createdAt:       tstz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Pertenencia de usuarios a organizaciones
// ---------------------------------------------------------------------------
export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    userId:         uuid('user_id').notNull().references(() => users.id),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    role:           text('role').notNull(), // 'admin' | 'tech'
    createdAt:      tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.organizationId] })],
);

// ---------------------------------------------------------------------------
// Clientes (empresas gestionadas por la organización)
// ---------------------------------------------------------------------------
export const clients = pgTable('clients', {
  id:             uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name:           text('name').notNull(),
  createdAt:      tstz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Sedes
// ---------------------------------------------------------------------------
export const sites = pgTable('sites', {
  id:             uuid('id').primaryKey().defaultRandom(),
  clientId:       uuid('client_id').notNull().references(() => clients.id),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  name:           text('name').notNull(),
  publicIps:      text('public_ips').array().notNull().default([]),
  createdAt:      tstz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Tokens de alta
// Solo se guarda el hash SHA-256 y los 8 primeros caracteres del token completo.
// El token completo solo se muestra en el momento de creación.
// ---------------------------------------------------------------------------
export const enrollmentTokens = pgTable(
  'enrollment_tokens',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    clientId:       uuid('client_id').references(() => clients.id),   // null → token de org (bandeja)
    siteId:         uuid('site_id').references(() => sites.id),       // null → sin sede asignada
    tokenHash:      text('token_hash').notNull(),                      // SHA-256 hex del token completo
    tokenPrefix:    varchar('token_prefix', { length: 8 }).notNull(), // primeros 8 chars (visualización)
    label:          text('label').notNull(),
    revokedAt:      tstz('revoked_at'),
    createdAt:      tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('enrollment_tokens_prefix_idx').on(t.tokenPrefix)],
);

// ---------------------------------------------------------------------------
// Dispositivos
// ---------------------------------------------------------------------------
export const devices = pgTable(
  'devices',
  {
    id:                 uuid('id').primaryKey().defaultRandom(),
    organizationId:     uuid('organization_id').notNull().references(() => organizations.id),
    clientId:           uuid('client_id').references(() => clients.id),
    siteId:             uuid('site_id').references(() => sites.id),
    origin:             text('origin').notNull().default('agent'), // 'agent' | 'probe'
    status:             text('status').notNull().default('pending_assignment'),
    // 'active' | 'pending_assignment' | 'pending_approval' | 'uninstalled'
    hostname:           text('hostname').notNull(),
    deviceTypeHint:     text('device_type_hint'),
    hardwareSmbiousUuid: text('hardware_smbios_uuid'), // null si es placeholder o no disponible
    hardwareSerial:     text('hardware_serial'),
    publicIp:           text('public_ip'),
    credentialHash:     text('credential_hash').notNull(), // SHA-256 hex del device_secret
    configVersion:      integer('config_version').notNull().default(1),
    enrollmentTokenId:  uuid('enrollment_token_id').references(() => enrollmentTokens.id),
    agentVersion:       text('agent_version'),
    createdAt:          tstz('created_at').notNull().defaultNow(),
    uninstalledAt:      tstz('uninstalled_at'),
  },
  (t) => [
    index('devices_org_idx').on(t.organizationId),
    index('devices_smbios_idx').on(t.organizationId, t.hardwareSmbiousUuid),
  ],
);

// ---------------------------------------------------------------------------
// Estado actual del dispositivo (una fila por dispositivo, se sobrescribe)
// ---------------------------------------------------------------------------
export const deviceCurrentState = pgTable('device_current_state', {
  deviceId:       uuid('device_id').primaryKey().references(() => devices.id),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),

  // De metrics
  cpuAvgPct:          real('cpu_avg_pct'),
  cpuMaxPct:          real('cpu_max_pct'),
  memoryUsedAvgPct:   real('memory_used_avg_pct'),
  memoryUsedMaxPct:   real('memory_used_max_pct'),
  ramTotalBytes:      bigint('ram_total_bytes', { mode: 'number' }),
  volumes:            jsonb('volumes'),
  services:           jsonb('services'),
  uptimeSecs:         integer('uptime_secs'),
  agentCpuPct:        real('agent_cpu_pct'),
  agentMemBytes:      bigint('agent_mem_bytes', { mode: 'number' }),

  // De status
  lastBootAt:            tstz('last_boot_at'),
  rebootPending:         boolean('reboot_pending'),
  rebootPendingReasons:  jsonb('reboot_pending_reasons'),
  antivirus:             jsonb('antivirus'),
  loggedOnUser:          text('logged_on_user'),
  network:               jsonb('network'),
  meteredConnection:     boolean('metered_connection'),
  onBattery:             boolean('on_battery'),
  inventoryHash:         text('inventory_hash'),

  // De daily
  physicalDisks:   jsonb('physical_disks'),
  windowsUpdate:   jsonb('windows_update'),

  // De inventory
  osInfo:          jsonb('os_info'),

  // Meta
  lastReportAt:    tstz('last_report_at'),
  lastMetricsAt:   tstz('last_metrics_at'),
  lastStatusAt:    tstz('last_status_at'),
  lastDailyAt:     tstz('last_daily_at'),
  lastInventoryAt: tstz('last_inventory_at'),
  publicIp:        text('public_ip'),
  agentVersion:    text('agent_version'),
  updatedAt:       tstz('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Métricas de 5 minutos (retención 7 días)
// ---------------------------------------------------------------------------
export const metrics5min = pgTable(
  'metrics_5min',
  {
    id:                 uuid('id').primaryKey().defaultRandom(),
    deviceId:           uuid('device_id').notNull().references(() => devices.id),
    organizationId:     uuid('organization_id').notNull().references(() => organizations.id),
    periodStart:        tstz('period_start').notNull(),
    periodEnd:          tstz('period_end').notNull(),
    samples:            integer('samples').notNull(),
    cpuAvgPct:          real('cpu_avg_pct'),
    cpuMaxPct:          real('cpu_max_pct'),
    memoryUsedAvgPct:   real('memory_used_avg_pct'),
    memoryUsedMaxPct:   real('memory_used_max_pct'),
    ramTotalBytes:      bigint('ram_total_bytes', { mode: 'number' }),
    volumes:            jsonb('volumes'),
    services:           jsonb('services'),
    uptimeSecs:         integer('uptime_secs'),
    agentCpuPct:        real('agent_cpu_pct'),
    agentMemBytes:      bigint('agent_mem_bytes', { mode: 'number' }),
    createdAt:          tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('metrics_5min_device_period_idx').on(t.deviceId, t.periodStart),
    index('metrics_5min_org_idx').on(t.organizationId),
  ],
);

// ---------------------------------------------------------------------------
// Informes diarios SMART + Windows Update (retención 13 meses)
// ---------------------------------------------------------------------------
export const dailyReports = pgTable(
  'daily_reports',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    deviceId:       uuid('device_id').notNull().references(() => devices.id),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    collectedAt:    tstz('collected_at').notNull(),
    physicalDisks:  jsonb('physical_disks'),
    windowsUpdate:  jsonb('windows_update'),
    createdAt:      tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('daily_reports_device_idx').on(t.deviceId),
    uniqueIndex('daily_reports_device_collected_at_idx').on(t.deviceId, t.collectedAt),
  ],
);

// ---------------------------------------------------------------------------
// Resumen diario de métricas — se llenará por proceso separado (reservado V1)
// ---------------------------------------------------------------------------
export const metricsDaily = pgTable(
  'metrics_daily',
  {
    deviceId:         uuid('device_id').notNull().references(() => devices.id),
    organizationId:   uuid('organization_id').notNull().references(() => organizations.id),
    day:              date('day').notNull(), // 'YYYY-MM-DD'
    cpuAvgPct:        real('cpu_avg_pct'),
    cpuMaxPct:        real('cpu_max_pct'),
    memoryUsedAvgPct: real('memory_used_avg_pct'),
    memoryUsedMaxPct: real('memory_used_max_pct'),
    volumesMinFree:   jsonb('volumes_min_free'), // { "C:": bytes_libres_mínimos }
    createdAt:        tstz('created_at').notNull().defaultNow(),
    updatedAt:        tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.day] })],
);

// ---------------------------------------------------------------------------
// Instantáneas de inventario
// ---------------------------------------------------------------------------
export const inventorySnapshots = pgTable(
  'inventory_snapshots',
  {
    id:               uuid('id').primaryKey().defaultRandom(),
    deviceId:         uuid('device_id').notNull().references(() => devices.id),
    organizationId:   uuid('organization_id').notNull().references(() => organizations.id),
    collectedAt:      tstz('collected_at').notNull(),
    hash:             text('hash').notNull(),
    systemInfo:       jsonb('system_info'),
    cpuInfo:          jsonb('cpu_info'),
    memoryTotalBytes: bigint('memory_total_bytes', { mode: 'number' }),
    osInfo:           jsonb('os_info'),
    physicalDisks:    jsonb('physical_disks'),
    createdAt:        tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('inventory_snapshots_device_hash_idx').on(t.deviceId, t.hash)],
);

// ---------------------------------------------------------------------------
// Eventos del ciclo de vida del agente (auditoría indefinida)
// ---------------------------------------------------------------------------
export const agentEvents = pgTable(
  'agent_events',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    deviceId:       uuid('device_id').notNull().references(() => devices.id),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    eventType:      text('event_type').notNull(),
    occurredAt:     tstz('occurred_at').notNull(),
    data:           jsonb('data'),
    receivedAt:     tstz('received_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_events_unique_idx').on(t.deviceId, t.eventType, t.occurredAt),
    index('agent_events_org_idx').on(t.organizationId),
  ],
);

// ---------------------------------------------------------------------------
// Hallazgos — reservado para Vylax Probe V3
// ---------------------------------------------------------------------------
export const findings = pgTable(
  'findings',
  {
    id:             uuid('id').primaryKey().defaultRandom(),
    deviceId:       uuid('device_id').notNull().references(() => devices.id),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    severity:       text('severity').notNull(), // 'info' | 'warning' | 'critical'
    state:          text('state').notNull(),    // 'new' | 'false_positive' | 'accepted' | 'resolved'
    firstSeenAt:    tstz('first_seen_at').notNull(),
    lastSeenAt:     tstz('last_seen_at').notNull(),
    createdAt:      tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('findings_device_idx').on(t.deviceId)],
);

// ---------------------------------------------------------------------------
// Relaciones (necesarias para db.query.xxx)
// ---------------------------------------------------------------------------
export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(organizationMemberships),
  clients:     many(clients),
  tokens:      many(enrollmentTokens),
  devices:     many(devices),
}));

export const devicesRelations = relations(devices, ({ one, many }) => ({
  organization:  one(organizations,       { fields: [devices.organizationId], references: [organizations.id] }),
  client:        one(clients,             { fields: [devices.clientId],       references: [clients.id] }),
  site:          one(sites,               { fields: [devices.siteId],         references: [sites.id] }),
  currentState:  one(deviceCurrentState,  { fields: [devices.id],             references: [deviceCurrentState.deviceId] }),
  metrics:       many(metrics5min),
  events:        many(agentEvents),
}));

export const deviceCurrentStateRelations = relations(deviceCurrentState, ({ one }) => ({
  device: one(devices, { fields: [deviceCurrentState.deviceId], references: [devices.id] }),
}));

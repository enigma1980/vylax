import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tipos individuales de informe
// ---------------------------------------------------------------------------

export const metricsReportSchema = z.object({
  type: z.literal('metrics'),
  collected_at: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  samples: z.number(),
  cpu: z.object({
    avg_pct: z.number(),
    max_pct: z.number(),
  }),
  memory: z.object({
    total_bytes: z.number(),
    used_avg_pct: z.number(),
    used_max_pct: z.number(),
  }),
  volumes: z.array(z.any()).optional(),
  services: z.any().optional(),
  uptime_secs: z.number().optional(),
  agent: z.object({
    cpu_pct: z.number(),
    mem_bytes: z.number(),
  }).optional(),
});

export const statusReportSchema = z.object({
  type: z.literal('status'),
  collected_at: z.string(),
  last_boot_at: z.string().optional(),
  reboot_pending: z.boolean().optional(),
  reboot_pending_reasons: z.array(z.string()).optional(),
  antivirus: z.any().optional(),
  logged_on_user: z.string().optional(),
  network: z.any().optional(),
  metered_connection: z.boolean().optional(),
  on_battery: z.boolean().optional(),
  inventory_hash: z.string().optional(),
});

export const dailyReportSchema = z.object({
  type: z.literal('daily'),
  collected_at: z.string(),
  physical_disks: z.array(z.any()).optional(),
  windows_update: z.any().optional(),
});

export const inventoryReportSchema = z.object({
  type: z.literal('inventory'),
  collected_at: z.string(),
  hash: z.string(),
  system_info: z.any().optional(),
  cpu_info: z.any().optional(),
  memory_total_bytes: z.number().optional(),
  os_info: z.any().optional(),
  physical_disks: z.array(z.any()).optional(),
  software: z.array(z.any()).optional(),
  network_adapters: z.array(z.any()).optional(),
});

export const eventReportSchema = z.object({
  type: z.literal('event'),
  event: z.string(),
  occurred_at: z.string(),
  data: z.record(z.string(), z.any()).optional(),
});

export const reportUnionSchema = z.discriminatedUnion('type', [
  metricsReportSchema,
  statusReportSchema,
  dailyReportSchema,
  inventoryReportSchema,
  eventReportSchema,
]);

// ---------------------------------------------------------------------------
// Envolvente del lote de informes
// ---------------------------------------------------------------------------
export const reportEnvelopeSchema = z.object({
  schema_version: z.string(),
  agent_version: z.string().optional(),
  sent_at: z.string(),
  reports: z.array(reportUnionSchema),
});

export type ReportEnvelope = z.infer<typeof reportEnvelopeSchema>;
export type MetricsReport  = z.infer<typeof metricsReportSchema>;
export type StatusReport   = z.infer<typeof statusReportSchema>;
export type DailyReport    = z.infer<typeof dailyReportSchema>;
export type InventoryReport = z.infer<typeof inventoryReportSchema>;
export type EventReport    = z.infer<typeof eventReportSchema>;

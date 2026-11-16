import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tipos individuales de informe  (contrato v1.1)
// ---------------------------------------------------------------------------

export const metricsReportSchema = z.object({
  type:         z.literal('metrics'),
  period_start: z.string(),
  period_end:   z.string(),
  samples:      z.number(),
  cpu: z.object({
    avg_pct: z.number(),
    max_pct: z.number(),
  }),
  memory: z.object({
    total_bytes:  z.number(),
    used_avg_pct: z.number(),
    used_max_pct: z.number(),
  }),
  volumes: z.array(z.object({
    mount:       z.string(),
    label:       z.string().optional(),
    fs:          z.string(),
    total_bytes: z.number(),
    free_bytes:  z.number(),
  })).optional(),
  services: z.object({
    critical:        z.array(z.any()).optional(),
    auto_not_running: z.array(z.object({
      name:         z.string(),
      display_name: z.string(),
      start:        z.string(),
      exit_code:    z.number(),
    })).optional(),
  }).optional(),
  uptime_seconds: z.number().optional(), // campo real del agente
  agent: z.object({
    cpu_avg_pct: z.number(), // campo real del agente
    mem_bytes:   z.number(),
  }).optional(),
});

export const statusReportSchema = z.object({
  type:                    z.literal('status'),
  collected_at:            z.string(),
  last_boot_at:            z.string().optional(),
  reboot_pending:          z.boolean().optional(),
  reboot_pending_reasons:  z.array(z.string()).optional(),
  antivirus:               z.array(z.any()).optional(),
  logged_on_user:          z.string().optional(),
  network: z.object({
    adapters: z.array(z.object({
      name:           z.string(),
      ipv4:           z.array(z.string()).optional(),
      ipv6:           z.array(z.string()).optional(),
      gateway:        z.string().optional(),
      dns:            z.array(z.string()).optional(),
      link_speed_mbps: z.number().optional(),
    })).optional(),
  }).optional(),
  metered_connection: z.boolean().optional(),
  on_battery:         z.boolean().optional(),
  inventory_hash:     z.string().optional(),
});

export const dailyReportSchema = z.object({
  type:         z.literal('daily'),
  collected_at: z.string(),
  physical_disks: z.array(z.object({
    serial:          z.string().optional(),
    health:          z.string().optional(),
    predict_failure: z.boolean().optional(),
    temperature_c:   z.number().optional(),
    wear_pct:        z.number().optional(),
  })).optional(),
  windows_update: z.object({
    last_installed_at: z.string().optional(),
    last_kb:           z.string().optional(),
  }).optional(),
});

// inventory NO lleva collected_at; se usa sent_at del sobre como fecha
export const inventoryReportSchema = z.object({
  type:               z.literal('inventory'),
  hash:               z.string(),
  system:             z.any().optional(), // { manufacturer, model, serial_number, bios_version, chassis, smbios_uuid }
  cpu:                z.any().optional(), // { model, cores, threads }
  memory_total_bytes: z.number().optional(),
  os:                 z.any().optional(), // { name, version, build, display_version, install_date }
  physical_disks:     z.array(z.any()).optional(),
  software:           z.array(z.any()).optional(),
  network_adapters:   z.array(z.any()).optional(),
});

export const eventReportSchema = z.object({
  type:        z.literal('event'),
  event:       z.string(),
  occurred_at: z.string(),
  data:        z.record(z.string(), z.any()).optional(),
});

export const reportUnionSchema = z.discriminatedUnion('type', [
  metricsReportSchema,
  statusReportSchema,
  dailyReportSchema,
  inventoryReportSchema,
  eventReportSchema,
]);

// ---------------------------------------------------------------------------
// Envolvente del lote de informes  (schema_version es entero en el contrato)
// ---------------------------------------------------------------------------
export const reportEnvelopeSchema = z.object({
  schema_version: z.number(),
  agent_version:  z.string().optional(),
  sent_at:        z.string(),
  reports:        z.array(reportUnionSchema),
});

export type ReportEnvelope  = z.infer<typeof reportEnvelopeSchema>;
export type MetricsReport   = z.infer<typeof metricsReportSchema>;
export type StatusReport    = z.infer<typeof statusReportSchema>;
export type DailyReport     = z.infer<typeof dailyReportSchema>;
export type InventoryReport = z.infer<typeof inventoryReportSchema>;
export type EventReport     = z.infer<typeof eventReportSchema>;

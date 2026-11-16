/** Configuración por defecto que recibe el agente en GET /v1/config */
export const DEFAULT_CONFIG = {
  schema_version: '1.0',
  metrics_interval_secs: 300,     // cada 5 min
  status_interval_secs: 300,
  daily_hour_utc: 2,              // informe diario a las 2:00 UTC
  inventory_on_enroll: true,
  inventory_interval_hours: 24,
  events_buffer_size: 100,
  log_level: 'info',
} as const;

export type AgentConfig = typeof DEFAULT_CONFIG;

/** Configuración por defecto que recibe el agente en GET /v1/config (contrato v1.1) */
export const DEFAULT_CONFIG = {
  config_version: 1,
  intervals: {
    sample_s:  30,
    metrics_s: 300,
    status_s:  3600,
    daily_s:   86400,
  },
  jitter_s: 60,
  metered_interval_multiplier: 3,
  critical_services: [] as string[],
  self_limits: {
    cpu_avg_pct: 1.0,
    mem_mb: 40,
  },
  offline_cache_max_mb: 10,
};

export type AgentConfig = typeof DEFAULT_CONFIG;

# Guaitiq – Instrucciones para Claude Code

Guaitiq es un RMM propio (monitorización proactiva) para empresas de servicios informáticos:
un agente en cada equipo Windows envía métricas por HTTPS a un servidor central, con un portal
multiempresa (organización → cliente → sede → equipo), alertas e informes.

## Antes de trabajar

1. Lee **`docs/GUAITIQ_SPEC.md`**: es la especificación completa y la fuente de verdad.
   Las decisiones que contiene son firmes; solo se cambian si Pepe lo pide, y entonces se actualiza la especificación.
2. Mira el apartado **"Plan de trabajo"** de la especificación para saber en qué paso estamos.

## Forma de trabajar

- Idioma: castellano (o catalán). Comentarios de código y mensajes de commit en castellano.
- Paso a paso: termina cada paso, explica qué has hecho y **espera confirmación** antes del siguiente.
- Al explicar cambios, muestra solo los fragmentos modificados, no archivos completos.
- No añadas funciones fuera del alcance de la V1 sin preguntar.
- Desarrollo en Windows (PowerShell). Los comandos que propongas deben funcionar ahí.
- Tras cada cambio en `agent/`, recompila con: `go build -o guaitiq-agent.exe .`

## Estructura del repositorio

```
agent/   Agente en Go (servicio de Windows, un único .exe)
web/     API + panel en Next.js (TypeScript) + PostgreSQL
docs/    Especificación y documentación
```

## Reglas técnicas clave (ver especificación para el detalle)

- Agente en Go con `gopsutil`; llamadas nativas de Windows. **Nunca lanzar PowerShell en los ciclos frecuentes.**
- **Nunca usar `Win32_Product`** (software instalado: leer del registro).
- Consumo del agente: CPU < 1 % de media, RAM < 40 MB, red < 1 MB/día. Prioridad "por debajo de lo normal".
- El agente solo recoge y envía; **las alertas se evalúan en el servidor**.
- Contrato de datos v1.0: `POST /v1/enroll`, `POST /v1/reports` (tipos metrics, status, daily, inventory, event), `GET /v1/config`.
- Multiempresa: cada organización es privada; nunca mezclar datos entre organizaciones.
- Antivirus genérico (no solo ESET): Centro de Seguridad de Windows en PCs, detectores por producto en servidores.
- Nombre del producto en un único sitio de configuración (puede cambiar).

## Estado actual

- Renombrado Vylax → Guaitiq completado (26/11/2026).
- Siguiente: paso 7 (instalador MSI guaitiq-agent.msi) — plan en docs/plan-paso7.md.

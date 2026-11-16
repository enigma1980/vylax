# Vylax

RMM propio para empresas de servicios informáticos.

Un agente en cada equipo Windows recoge métricas y las envía por HTTPS a un servidor
central. El portal multiempresa (organización → cliente → sede → equipo) muestra el
estado de todos los equipos, lanza alertas y genera informes.

## Estructura

```
agent/   Agente en Go (servicio de Windows, un único .exe)
web/     API + panel en Next.js (TypeScript) + PostgreSQL
docs/    Especificación y documentación
```

## Documentación

Ver `docs/VYLAX_SPEC.md` para la especificación completa y el contrato de datos.

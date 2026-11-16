# Vylax – Especificación del proyecto

Nov 13, 2026 · @Pepe

## Cómo usar este documento

Este documento es la fuente de verdad del proyecto: recoge todo lo analizado y decidido el 13/11/2026, antes de escribir código. Al empezar cualquier sesión nueva (con Claude o con Claude Code), hay que compartirlo y decir en qué paso del plan estamos.

**Estado actual:** diseño cerrado. Siguiente paso: definir el formato JSON que envía el agente (paso 0 del plan).

**Reglas de trabajo para Claude / Claude Code:**

- Las decisiones de este documento son firmes. Solo se cambian si Pepe lo pide explícitamente, y en ese caso se actualiza el documento.
- Se trabaja paso a paso: cada fase se confirma antes de pasar a la siguiente.
- Al modificar código, entregar solo el fragmento que cambia, no el archivo completo.
- Idioma de trabajo: castellano o catalán.
- Al cerrar cada paso, actualizar el plan de trabajo y la sección de decisiones pendientes.

## Resumen y objetivo

Global-Link desarrollará su propio RMM (monitorización remota) para hacer mantenimiento proactivo de los equipos de sus clientes: PCs, portátiles, servidores Windows, NAS y SAI.

- Un **agente propio** en cada equipo Windows recoge métricas y las envía por internet a un servidor de Global-Link, esté el equipo en la oficina o en casa.
- Un **portal web multicliente, tipo UniFi Site Manager**: con el login de Global-Link se ven todos los clientes, y dentro de cada cliente sus sedes y dispositivos.
- **Alertas** configurables (disco a punto de llenarse, disco que falla, antivirus parado, equipo que deja de reportar, etc.) enviadas por correo, Telegram o n8n.
- Objetivo: detectar y resolver los problemas antes de que el cliente llame.

## Requisitos y decisiones clave

La decisión principal es construir agente y panel desde cero, sin depender de ninguna herramienta de terceros.

| # | Requisito / decisión | Detalle |
| --- | --- | --- |
| 1 | Desarrollo 100 % propio | Agente y panel propios. Nada de usar una herramienta existente como base. |
| 2 | Coste cero mientras no se venda | Sin licencias de pago. La firma de código solo se paga si la solución se comercializa. |
| 3 | Sin depender del dominio | Equipos en dominio, en Entra ID o en grupo de trabajo. El cliente lo determina el token de alta, no el dominio. |
| 4 | Portátiles en remoto | Los equipos fuera de la oficina se monitorizan igual. El agente envía sus datos por internet (HTTPS saliente), sin VPN ni puertos abiertos. |
| 5 | Portal tipo UniFi | Login Global-Link, luego clientes, sedes, dispositivos. |
| 6 | Arranque automático | Servicio de Windows que arranca con el equipo, aunque nadie inicie sesión. |
| 7 | Desinstalable en cualquier momento | Pero la desinstalación genera alerta y queda registrada. |
| 8 | Bajo consumo | No debe afectar a la CPU, al rendimiento del PC ni a la red (ver límites). |
| 9 | Antivirus ESET | Mientras no haya firma de código, se usan exclusiones desplegadas desde ESET PROTECT. |

**Modelo de negocio (13/11/2026)**

El producto es de Pepe (creador). Global-Link será la primera empresa que lo use, y la idea es ofrecerlo también a otras empresas de servicios informáticos a cambio de una cuota.

- **Plataforma multiempresa desde el principio:** cada empresa de servicios es una organización aislada con sus propios clientes, técnicos, tokens y alertas. Una empresa nunca ve datos de otra.
- **Servicio en la nube (SaaS)** gestionado por Pepe, no instalaciones separadas en cada empresa: control de facturación, actualizaciones y seguridad en un solo sitio.
- **Precio orientativo:** unos 1 € por equipo y mes (pendiente de validar).
- **Equipo facturable:** el que ha reportado durante el mes. No cuentan los desinstalados ni los que están en "Pendientes de asignar".
- **Marca:** cada empresa de servicios podrá poner su logo y colores en el panel (V2).
- **Firma de código:** al venderse, pasa a ser necesaria; se pagará con los ingresos.

## Alternativas analizadas y descartadas

Se evaluaron soluciones existentes; ninguna cumple a la vez "coste cero" y "modificable a nuestro gusto", o no encajan con la decisión de desarrollo propio.

| Opción | Por qué se descartó |
| --- | --- |
| Equipo central que lee a los demás (WMI/WinRM) | Necesita credenciales de administrador del dominio (riesgo, choca con el ENS). No ve portátiles fuera de la red ni equipos sin dominio. Punto único de fallo. Solo se reutiliza la idea para SNMP (NAS, SAI). |
| Tactical RMM | Licencia propia que no es open source. Agentes firmados, Linux/Mac e informes solo con patrocinio (mínimo 50 $/mes). Modificarlo y ponerle marca propia está limitado. |
| Zabbix + MeshCentral | Gratuito y libre (AGPL / Apache 2.0), pero supone depender de una herramienta ajena. Queda como referencia de funciones, no como base. |
| NetLock RMM | Modelo open core: no todo el código es abierto. Proyecto joven. |
| Checkmk, Prometheus + Grafana | La edición gratuita de Checkmk tiene limitaciones. Prometheus no está pensado para servicios gestionados multicliente. |

Wazuh (ya en uso) no sustituye este proyecto: cubre la seguridad y el inventario, no las métricas de rendimiento ni las alertas de capacidad.

## Arquitectura y stack

Cada agente envía sus datos por HTTPS saliente a un único servidor de Global-Link, que los guarda, evalúa las alertas y los muestra en el panel.

```
[Vylax Agent en cada equipo]  --HTTPS saliente-->  [Servidor Vylax (VPS, Docker)]
 PCs y servidores Windows                            API (registro y recepción)
 Portátiles en oficina o casa                          -> PostgreSQL (métricas y alertas)
                                                           -> Motor de alertas -> Avisos (correo, webhook n8n)
[Agente colector / Vylax Probe] (V2)  --HTTPS-->           -> Panel web Next.js (global -> cliente -> equipo)
   └─ SNMP -> NAS y SAI                                        <- Técnicos (login con 2FA)
```

La comunicación va siempre del agente al servidor: no hay puertos abiertos en los clientes ni VPN, y funciona igual desde casa.

| Pieza | Tecnología | Notas |
| --- | --- | --- |
| Agente | Go, librería `gopsutil` | Un único `.exe` sin dependencias, servicio de Windows; compila también para Linux |
| Instalador | MSI con WiX Toolset | Parámetro `TOKEN`, desinstalación con aviso |
| API y panel | Next.js + TypeScript | Si crece mucho, la recepción de datos se separa en un servicio aparte |
| Base de datos | PostgreSQL | Series temporales; TimescaleDB si hiciera falta más adelante |
| Alertas | Motor propio | Correo y webhook hacia n8n (Telegram, Teams, tickets) |
| Despliegue | Docker en VPS o servidor propio | Pendiente de decidir |
| Repositorio | Monorepo | `agent/` y `web/` |

## Portal multicliente y modelo de datos

El portal funciona como UniFi Site Manager: un único login de Global-Link da acceso a todos los clientes, y se navega por niveles.

```
Login Global-Link (usuario + 2FA)
│
├── Vista global: todos los clientes (semáforo, alertas abiertas, nº de equipos)
│
├── Cliente: COVB
│     ├── Sede: Oficina central
│     │     ├── SRV-01 (servidor)     🟢
│     │     ├── NAS Synology          🟡 disco al 85 %
│     │     └── PC-RECEPCION          🟢
│     └── Remotos / sin sede
│           └── Portátil Marta        ⚪ último contacto hace 2 días
│
└── Cliente: Hackney Shop …
```

**Qué muestra cada nivel**

1. **Global:** semáforo por cliente, alertas recientes de todos, equipos que no reportan.
2. **Cliente:** sus sedes y dispositivos, resumen de salud (discos, backups, parches).
3. **Dispositivo:** gráficas de CPU, RAM y disco, inventario de hardware y software, historial de alertas y eventos del agente.

**Usuarios y roles**

- **Administrador Global-Link:** todo, incluida la configuración.
- **Técnico:** todos los clientes o solo los asignados.
- **Usuario de cliente** (futuro): solo ve su empresa, útil para informes y como argumento comercial.

**Entidades principales**

| Entidad | Contenido clave |
| --- | --- |
| Organización | Empresa de servicios cliente de la plataforma (inquilino). Multiempresa desde el día 1; Global-Link es la primera. Datos aislados por organización. |
| Cliente | Nombre, token de alta, contactos, configuración de alertas |
| Sede | Nombre, dirección, equipo que hace de colector SNMP |
| Dispositivo | Tipo (servidor, PC, portátil, NAS, SAI), huella de hardware, estado (activo, desinstalado), credencial del agente, intervalos |
| Métrica | Serie temporal por dispositivo (CPU, RAM, discos…) |
| Inventario | Última foto de hardware y software + hash para detectar cambios |
| Regla de alerta | Por tipo de dispositivo, con posibilidad de ajuste por cliente o equipo |
| Alerta | Gravedad, estado (abierta, reconocida, resuelta), fechas |
| Evento del agente | Instalación, actualización, parada, desinstalación (auditoría) |
| Usuario | Rol, 2FA, clientes asignados |

**Privacidad entre organizaciones (decidido 13/11/2026)**

- Cada organización (empresa de servicios) es privada. No existe un superusuario que vea todo en el panel.
- Un usuario puede pertenecer a varias organizaciones (p. ej. Pepe en Global-Link y Tecinfo) y elige con cuál trabaja.
- Pepe no ve en el panel clientes ni equipos de organizaciones de las que no es miembro (p. ej. la de Jose).
- **Consola de plataforma** (solo Pepe): lista de organizaciones, número de equipos activos por organización (para facturar) y estado del servicio. Sin datos de clientes ni equipos.
- Pepe mantiene acceso técnico al código y la base de datos para incidencias y seguridad. Recogerlo en las condiciones del servicio (encargado del tratamiento, RGPD). Futuro: botón "dar acceso de soporte" temporal y auditado.
- **V1:** Pepe crea las organizaciones a mano y cobra fuera de la plataforma. **Futuro:** registro libre con verificación de correo y cobro integrado.

**Preparado desde la V1 para la sonda de red:** cada dispositivo guarda su **origen** (`agent` o `probe`). Se reserva la entidad **Hallazgo** (gravedad, estado nuevo / falso positivo / aceptado / resuelto, primera y última vez visto), aunque no se use hasta la V3.

**Retención de datos**

| Qué | Cuánto tiempo | Para qué |
| --- | --- | --- |
| Estado actual de cada equipo | Siempre (se sobrescribe) | Panel y semáforo |
| Detalle de 5 minutos | 7 días | Alertas sostenidas y diagnóstico reciente |
| Resumen diario (mínimo, media, máximo, espacio en disco) | 13 meses | Días hasta llenarse, tendencias, informes mensuales |
| Alertas e incidencias | Indefinido | Historial de equipo y cliente |
| Eventos del agente y auditoría | Indefinido | Desinstalaciones, cambios, accesos |

El envío de métricas cada 5 minutos (con muestras cada 30 s) se mantiene: es configurable desde el servidor.

## Agente: servicio, instalación y ciclo de vida

El agente es un servicio de Windows escrito en Go que arranca con el equipo y se instala y desinstala con un MSI normal.

**Servicio de Windows**

- Inicio **Automático (retrasado)**: arranca 1-2 minutos después del sistema, aunque nadie inicie sesión.
- **Recuperación automática**: si falla, Windows lo reinicia al cabo de 1 minuto.
- Corre como **SYSTEM** (necesario para SMART, visor de eventos y servicios). **No abre ningún puerto**: solo conexiones salientes.

**Instalador MSI** (WiX Toolset, libre y gratuito)

- Instalación silenciosa: `msiexec /i agente.msi TOKEN=xxxx /qn`, válida para Intune, script o a mano.
- Desinstalación desde Configuración → Aplicaciones o con `msiexec /x`. Windows ya exige permisos de administrador.

**Alta del equipo y asignación a cliente**

El agente sabe a qué cliente pertenece por el **token de alta** con el que se instala. Después, quien lo sabe es el servidor: el agente nunca dice "soy del cliente X", solo presenta su credencial.

1. **Primero se crea el cliente en el panel** (nombre y sedes). Al crearlo se genera su token de alta; opcionalmente, un token por sede. El token solo sirve para dar de alta equipos.
2. **El token viaja con el instalador**, de una de estas formas:
   - parámetro: `msiexec /i agente.msi TOKEN=… /qn` (Intune: una app por cliente, o script);
   - botón "Copiar comando de instalación" en la ficha del cliente;
   - botón "Descargar agente para \<cliente>" con el token ya incluido.
3. **Registro en el primer arranque:** el agente envía token + huella de hardware (UUID de placa + número de serie) + nombre del equipo.
4. El servidor valida el token, identifica cliente y sede, y crea el dispositivo. Si la huella ya existía (reinstalación), recupera su ficha e historial.
5. El servidor devuelve una **credencial propia del equipo** (ID + clave secreta). El agente la guarda cifrada con DPAPI y ya no vuelve a usar el token.
6. Cada envío posterior va autenticado con esa credencial. Un agente manipulado no puede hacerse pasar por otro cliente.

**Sede y ubicación**

- Con token de sede, el equipo queda en esa sede.
- Con token de cliente, el servidor lo asigna por IP pública (IP de la oficina → esa sede; si no, "Remotos / sin sede").
- La ficha muestra por separado la **sede asignada** y la **ubicación actual** (oficina o remoto).

**Bandeja de entrada (plan B)**

- Existe un token general de Global-Link no ligado a ningún cliente.
- Los equipos instalados con él aparecen en **"Pendientes de asignar"**, envían métricas pero **no generan alertas**.
- Un técnico los asigna a cliente y sede desde el panel (el cliente se puede crear en ese momento).

**Control**

- Mover un equipo de sede o cliente desde el panel, conservando su historial.
- Rotar o revocar el token de un cliente si se filtra. Los equipos ya registrados no se ven afectados.
- Opcional: aprobación manual de equipos nuevos antes de que entren en un cliente.

**Desinstalación con aviso**

1. Antes de borrar archivos, el MSI ejecuta el agente en modo `--notify-uninstall`.
2. El agente envía: fecha y hora, usuario conectado o que lanzó la desinstalación, versión y motivo (manual o por actualización). Reintenta durante 15-30 s si no hay red.
3. El servidor marca el equipo como **Desinstalado** (no lo borra, conserva el historial), genera una alerta, registra el evento en la auditoría y deja de lanzar alertas de "sin reportar".
4. Si no pudo avisar (sin conexión), el equipo salta igualmente por "sin reportar" según su tipo. Ninguna desinstalación pasa desapercibida.

**Eventos del ciclo de vida**

| Evento | ¿Alerta? |
| --- | --- |
| Instalación / alta | Informativo |
| Actualización del agente | Informativo |
| Apagado normal de Windows | No (evita falsas alarmas) |
| Servicio parado manualmente | Sí, aviso |
| Desinstalación | Sí, alerta |
| Reinstalación en el mismo equipo | Informativo, recupera el historial |

El agente distingue apagado de Windows y parada manual porque Windows le notifica qué está pasando.

**Opcional (futuro):** desinstalación protegida por clave por cliente, como ESET. Desactivada por defecto; pensada para clientes con ENS.

## Catálogo de métricas

Solo se mide lo que anticipa un problema o permite actuar antes de que el cliente llame; se priorizan tendencias y señales de deterioro. V1 = MVP, V2 = siguiente versión.

**1. Almacenamiento**

| Métrica | Por qué | Alerta sugerida | Fase |
| --- | --- | --- | --- |
| Espacio libre por volumen (% y GB) | Disco lleno tumba servidores, BBDD y backups | <15 % aviso, <5 % crítico (en discos grandes, en GB) | V1 |
| Días hasta llenarse (tendencia) | Permite planificar | <30 d aviso, <7 d crítico | V1 |
| Salud del disco (SMART / Get-PhysicalDisk) | Detecta fallos semanas antes | Distinto de Healthy = crítico | V1 |
| Sectores reasignados, errores de lectura, temperatura | Fallo físico temprano | Contadores al alza = aviso | V2 |
| Desgaste SSD (% vida usada) | Vida limitada de escrituras | >80 % aviso | V2 |
| Latencia de disco (ms/operación) | HDD degradado; explica "va lento" | >50 ms sostenido aviso | V2 |
| Errores de disco en eventos (IDs 7, 51, 153; NTFS 55) | Corrupción o controladora | Cualquiera = aviso | V2 |
| Estado de BitLocker | Cumplimiento ENS, portátiles | Portátil sin cifrar = aviso | V2 |

Con RAID por hardware, Windows no ve el SMART de cada disco: habrá que leer la herramienta del fabricante (HPE, Dell) en una fase posterior.

**2. Rendimiento**

| Métrica | Por qué | Alerta sugerida | Fase |
| --- | --- | --- | --- |
| CPU % (media y máximo) | Procesos descontrolados, equipo corto | >90 % sostenido 15 min | V1 |
| RAM % en uso | Lentitud, candidato a ampliar | >90 % sostenido 15 min | V1 |
| Memoria comprometida y paginación | Fugas de memoria en servidores | >90 % del límite | V2 |
| Top 5 procesos por consumo | Saber qué causa el problema | Contexto en ficha y alertas | V2 |

**3. Estabilidad**

| Métrica | Por qué | Alerta sugerida | Fase |
| --- | --- | --- | --- |
| Uptime / último arranque | Muy alto = sin parches; muy bajo y repetido = reinicios | Servidor >45 d aviso | V1 |
| Reinicio pendiente | Actualizaciones a medias | Pendiente >7 d aviso | V1 |
| Apagados inesperados (Kernel-Power 41, 6008) | Eléctrico, SAI, hardware | Cualquiera en servidor = aviso | V2 |
| Pantallazos azules (BugCheck 1001) | Drivers o hardware | 1 = aviso; >2 en 30 d = crítico | V2 |
| Cuelgues de aplicaciones (evento 1000) | Software problemático | Informativo y tendencia | V2 |

**4. Seguridad y actualizaciones**

| Métrica | Por qué | Alerta sugerida | Fase |
| --- | --- | --- | --- |
| Días desde la última actualización instalada | Equipo sin parchear | >45 d aviso | V1 |
| Versión y build del SO | SO sin soporte (Windows 10 desde oct. 2025) | Sin soporte = aviso permanente | V1 |
| Antivirus del cliente (ESET, Defender u otro): instalado, activo, firmas al día | Que el antivirus funcione de verdad | Desactivado o firmas >3 d = crítico | V1 |
| Actualizaciones pendientes (nº, críticas) | Priorizar intervenciones | Críticas >15 d | V2 |
| Firewall de Windows activo | Cumplimiento básico | Desactivado = aviso | V2 |
| Inicios de sesión fallidos (4625) en servidores | Fuerza bruta | >50 en 1 h = crítico | V2 |
| Administradores locales | Cuentas no autorizadas (ENS) | Cambio = aviso | V2 |

**5. Hardware e inventario**

| Métrica | Por qué | Alerta sugerida | Fase |
| --- | --- | --- | --- |
| Fabricante, modelo, nº de serie, BIOS | Garantías, renovaciones | — | V1 |
| CPU, RAM total, discos, SO | Inventario sin desplazarse | — | V1 |
| Usuario conectado y último inicio de sesión | Quién usa cada equipo | — | V1 |
| Salud de batería (capacidad actual / diseño) | Anticipar cambio de batería | <60 % aviso | V2 |
| Software instalado (del registro) | Licencias, no autorizado, vulnerable | Cambios = registro | V2 |

**6. Servicios y roles (servidores)**

| Métrica | Por qué | Alerta sugerida | Fase |
| --- | --- | --- | --- |
| Servicios automáticos parados | SQL, backup, ERP… | Servicio crítico parado = crítico | V1 |
| Lista de servicios críticos configurable por equipo | Cada servidor tiene los suyos | — | V1 |
| Certificados del equipo que caducan | Webs internas, RDS, VPN | <30 d aviso | V2 |
| Salud del controlador de dominio (replicación, DNS) | Corazón de la oficina | Errores = crítico | V2 |
| Instantáneas (shadow copies) | Última línea antes del backup | Desactivadas o antiguas = aviso | V2 |

**7. Copias de seguridad**

| Métrica | Por qué | Alerta sugerida | Fase |
| --- | --- | --- | --- |
| Resultado del último backup (Windows Server Backup, Veeam) | El fallo silencioso es lo peor | Fallo = crítico | V2 |
| Antigüedad del último archivo en una carpeta | Funciona con cualquier software de backup | >26 h = crítico | V2 |

**8. Red**

| Métrica | Por qué | Alerta sugerida | Fase |
| --- | --- | --- | --- |
| IP local, puerta de enlace, DNS, IP pública | Oficina o casa; asignación de sede | — | V1 |
| Velocidad del enlace | 100 Mbps en vez de 1 Gbps = cable o roseta | Servidor <1 Gbps = aviso | V2 |
| Latencia a la puerta de enlace e internet | Red local o línea | Alta sostenida = aviso | V2 |
| Señal wifi (portátiles) | Quejas de lentitud en remoto | Informativo | V2 |

**9. NAS por SNMP (Synology, QNAP)** — todo V2

| Métrica | Alerta sugerida |
| --- | --- |
| Estado general del sistema | Distinto de Normal = crítico |
| Estado del RAID | Degradado = crítico |
| Estado y temperatura de cada disco | Fallo o >55 °C = aviso |
| Uso de volúmenes y tendencia | Como en los equipos |
| Ventiladores y fuentes | Fallo = aviso |
| Actualización de DSM / QTS disponible | Informativo |

**10. SAI (SNMP o NUT)** — todo V2

| Métrica | Alerta sugerida |
| --- | --- |
| Funcionando con batería | Crítico inmediato |
| Carga y autonomía restante | <10 min = crítico |
| Batería a sustituir | Aviso |

## Perfiles por tipo de dispositivo

Cada dispositivo tiene un tipo, y el tipo decide qué se mide y cuándo se considera que "no reporta".

| Ámbito | Servidor | PC sobremesa | Portátil | NAS | SAI |
| --- | --- | --- | --- | --- | --- |
| Disco, CPU, RAM | Sí | Sí | Sí | Sí | — |
| SMART y estabilidad | Sí | Sí | Sí | Sí | — |
| Actualizaciones y ESET | Sí | Sí | Sí | — | — |
| Servicios críticos | Sí | — | — | — | — |
| Backups | Sí | — | — | Sí | — |
| Batería | — | — | Sí | — | Sí |
| Alerta "sin reportar" | 10 min | 3 días | 15 días | 10 min | 10 min |

Un portátil apagado de noche o en vacaciones es normal; 15 días sin reportar indica equipo perdido, robado o abandonado. Los umbrales se pueden ajustar por cliente o por equipo.

## Bajo consumo del agente

El agente no debe notarse: es un requisito de diseño con límites medibles, que se verificarán en el piloto.

| Recurso | Límite objetivo |
| --- | --- |
| CPU | <1 % de media, sin picos apreciables |
| RAM | <40 MB |
| Disco | Solo caché local sin conexión, tope 10 MB |
| Red | <1 MB/día por equipo |

**Reglas de implementación**

1. **APIs nativas desde Go, sin lanzar PowerShell** en las comprobaciones frecuentes (cada `powershell.exe` cuesta \~100-200 ms de CPU y \~50 MB).
2. **Software instalado desde el registro, nunca con `Win32_Product`** (lentísimo y fuerza la revisión de todos los MSI).
3. **Visor de eventos:** solo eventos nuevos desde la última lectura, filtrados por ID.
4. **Actualizaciones de Windows:** leer el historial una vez al día, sin forzar búsquedas.
5. **Prioridad de CPU y disco "por debajo de lo normal".**
6. **Tareas pesadas** (inventario, SMART): no en los primeros 10-15 min tras arrancar, con CPU <30 %, con plazo máximo; aplazadas si el portátil va con batería.
7. **Desfase aleatorio** en los envíos para no saturar la línea ni el servidor.
8. **Autovigilancia:** el agente mide su consumo, espacia tareas si se pasa del límite y envía su consumo como métrica visible en el panel.
9. **Intervalos configurables desde el panel**, no fijados en el agente.

**Frecuencias**

| Qué | Frecuencia |
| --- | --- |
| CPU, RAM, disco, servicios | Muestras cada 30 s; envío de media y máximo cada 5 min |
| Eventos, ESET, reinicio pendiente | Cada hora |
| Inventario, SMART, actualizaciones, batería, software, certificados | Una vez al día |

**Tráfico estimado**

| Envío | Tamaño comprimido | Frecuencia | Al día |
| --- | --- | --- | --- |
| Métricas | \~1 KB | 5 min | \~300 KB |
| Estado | \~1 KB | 1 h | \~25 KB |
| Inventario | 50-100 KB | Solo si cambia (por hash) | Casi siempre 0 |
| **Total** |  |  | **<0,5 MB por equipo** |

Una oficina de 30 equipos genera unos 15 MB al día. Si Windows marca la conexión como de uso medido (4G, tethering), se reduce la frecuencia.

## Alertas, notificaciones y puntuación de salud

Las alertas deben ser pocas y fiables: condiciones sostenidas, gravedades claras y nada de ruido por picos puntuales.

**Funcionamiento**

- **Reglas por tipo de dispositivo**, ajustables por cliente o por equipo.
- **Gravedades:** informativo, aviso, crítico.
- **Estados:** abierta → reconocida → resuelta. Se resuelve sola cuando la condición desaparece.
- **Condiciones sostenidas** (p. ej. CPU >90 % durante 15 min) para evitar falsos positivos.
- **Sin duplicados:** una condición activa = una sola alerta abierta.
- Los equipos en "Pendientes de asignar" no generan alertas.

**Canales de notificación**

- Correo electrónico (V1).
- Webhook hacia n8n (V1), que permite Telegram, Teams o crear tickets.
- Telegram directo (V2).

**Puntuación de salud (0-100)**

- Cada equipo tiene una puntuación calculada con disco, SMART, actualizaciones, antivirus, estabilidad y alertas abiertas.
- Alimenta el semáforo del panel: verde, amarillo, rojo; gris si no reporta.
- La puntuación del cliente es la media de sus equipos (o la peor, a decidir).
- Se usa también en los informes mensuales al cliente.

## Seguridad

Un RMM comprometido da acceso a todos los clientes a la vez, así que la seguridad es requisito desde el primer día y encaja con el ENS.

- **Comunicación:** siempre HTTPS (TLS). El agente no abre puertos; solo conexiones salientes.
- **Identidad del agente:** token de alta solo para registrarse; después, credencial propia por equipo, guardada con DPAPI y **revocable** (equipo perdido o robado).
- **Aislamiento entre clientes:** el servidor deduce el cliente de la credencial; el agente nunca lo declara.
- **Tokens de alta:** rotables y revocables; aprobación manual opcional de equipos nuevos.
- **Panel:** login con 2FA obligatorio, roles, y si es posible acceso restringido por IP.
- **Auditoría:** registro de accesos al panel, cambios de configuración y eventos de agentes (alta, parada, desinstalación).
- **Servidor:** expuesto a internet; mantenerlo actualizado, con copias de seguridad y monitorizado.
- **V1 sin ejecución remota:** el agente solo lee y envía. Ejecutar scripts o acceso remoto llegará más tarde y con controles adicionales.

## Despliegue, firma de código y antivirus

Mientras la solución no se venda, el agente irá sin firmar y se resolverá con exclusiones en ESET.

**Despliegue del agente**

- **Intune** (clientes con M365 Business Premium): MSI publicado como aplicación, una por cliente con su token, desde la consola de administración.
- **Manual o por script:** comando o instalador descargado desde el panel.
- **Actualizaciones del agente:** automáticas desde el servidor (V2).

**Firma de código**

- Sin firma, los antivirus pueden marcar el agente como desconocido.
- Firmar cuesta dinero (certificado o servicio de firma): **solo se hará si la solución se comercializa.**

**Antivirus ESET**

- Exclusiones del ejecutable y la carpeta del agente desplegadas como política desde **ESET PROTECT**, de forma centralizada, sin ir equipo por equipo.

**Servidor**

- Alojamiento pendiente de decidir: VPS (Hetzner, OVH…) o servidor propio de Global-Link.
- Despliegue previsto con contenedores (Docker) para simplificar instalación y copias.

## Alcance V1 y V2

La V1 cubre la mayoría de incidencias evitables con un agente que solo lee y envía; la V2 amplía cobertura y funciones.

**V1 (MVP)**

- **Agente:** espacio y días hasta llenarse, SMART básico, CPU, RAM, uptime, reinicio pendiente, última actualización, versión del SO, estado del antivirus (el que tenga cada cliente: Centro de Seguridad de Windows en PCs, detectores por producto en servidores), servicios críticos, inventario básico (hardware, usuario), red básica (IPs). Servicio Windows, MSI con token, caché sin conexión, eventos de ciclo de vida (incluida la desinstalación).
- **Servidor y panel:** registro por token, bandeja "Pendientes de asignar", login con 2FA, vistas global → cliente → dispositivo con gráficas, alertas por umbral y "sin reportar" por tipo, avisos por correo y webhook (n8n), auditoría.

**V2**

- SNMP para NAS y SAI (agente en modo colector en un servidor de la oficina).
- Métricas V2 del catálogo: eventos (BSOD, apagados, disco), latencia de disco, desgaste SSD, BitLocker, firewall, inicios fallidos, certificados, backups, batería, software instalado, red avanzada.
- Actualización automática del agente.
- Acceso para usuarios de cliente e informes mensuales automáticos.
- Telegram directo, protección de desinstalación por clave.

**Más adelante:** acceso remoto, ejecución de scripts, agente Linux, RAID por hardware (HPE, Dell).

## Evolución: Vylax Probe (sonda de red)

Vylax incorporará más adelante una sonda de red, inspirada en la propuesta "Sonda de seguretat permanent", dentro del mismo producto: mismo servidor, portal, alertas, semáforo e informe. **Decisión (13/11/2026): primero se hace la V1 del agente**; la sonda viene después.

- **Vylax Agent:** salud de cada equipo Windows, esté donde esté.
- **Vylax Probe:** mini PC en cada oficina del cliente. Descubre aparatos, lee NAS y SAI por SNMP (sustituye al "agente en modo colector"), revisa TLS, vulnerabilidades, tráfico y wifi.
- **Desarrollo propio** del servicio de la sonda (Go), la gestión de hallazgos y los paneles. **Se reutilizan como motores** nmap, Nuclei, Greenbone, Suricata y Kismet, sin DefectDojo ni Grafana.
- **Cruces de datos:** PC en la red sin agente Vylax, aparato desconocido, NAS con firmware vulnerable.
- **Comercial:** Vylax Endpoint (por equipo y mes) y Vylax Network (por sonda y mes).

| Fase | Contenido |
| --- | --- |
| V1 | Agente (este documento). Modelo de datos ya preparado para la sonda |
| V2 | Sonda básica: descubrimiento de aparatos, SNMP de NAS y SAI, certificados TLS, escaneo externo de IP públicas, "equipo sin agente" |
| V3 | Vulnerabilidades (Nuclei, quizá Greenbone) y gestión de hallazgos con filtrado de falsos positivos |
| V4 | Detección de tráfico (Suricata) y wifi (Kismet) |

**Riesgos de la sonda a revisar antes de la V2:** licencia del feed gratuito de Greenbone para uso comercial; aparatos delicados que se cuelgan con escaneos (perfiles suaves, exclusiones, horarios pactados); seguridad del propio mini PC (disco cifrado con TPM, sin puertos de entrada); autorización de escaneo y acuerdo de encargado del tratamiento (RGPD) en el contrato; coste del hardware por cliente.

## Contrato de datos agente ↔ servidor (borrador v0.1)

El agente solo recoge y envía; **todas las alertas se evalúan en el servidor**, así que cambiar umbrales o reglas nunca obliga a actualizar el agente. La API tiene tres puntos de entrada.

| Endpoint | Para qué | Autenticación |
| --- | --- | --- |
| `POST /v1/enroll` | Alta del equipo (una sola vez) | Token de alta en el cuerpo |
| `POST /v1/reports` | Todos los envíos: métricas, estado, diario, inventario y eventos. Admite varios a la vez (vaciado de la caché sin conexión) | `Authorization: Bearer <device_secret>` + cabecera `X-Device-Id` |
| `GET /v1/config` | Configuración del agente (intervalos, servicios críticos…) | Igual que `/reports` |

**Convenciones**

- HTTPS, JSON en UTF-8 comprimido con gzip.
- Fechas en ISO 8601 UTC; tamaños en bytes; porcentajes de 0 a 100 con decimales.
- Cada envío lleva `schema_version` para poder evolucionar el formato sin romper agentes antiguos.
- La **IP pública no la envía el agente**: el servidor la toma de la propia conexión (sirve para asignar sede y ver si está en remoto).

### 1. Alta: `POST /v1/enroll`

```json
{
  "schema_version": 1,
  "enrollment_token": "vx_enr_7Fq2…",
  "agent_version": "0.1.0",
  "hardware_id": { "smbios_uuid": "4C4C4544-0042-…", "serial_number": "7XK2LM3" },
  "hostname": "PC-RECEPCION",
  "os": { "name": "Windows 11 Pro", "version": "10.0.26100", "build": "26100.2314", "arch": "amd64" },
  "device_type_hint": "laptop"
}
```

`device_type_hint` lo deduce el agente (tipo de chasis, batería, SO servidor); el técnico puede cambiarlo en el panel.

Respuesta:

```json
{
  "device_id": "dev_01JD8Q…",
  "device_secret": "vx_sec_…",
  "status": "active",
  "config": { "…": "igual que GET /v1/config" }
}
```

`status`: `active` (asignado a cliente), `pending_assignment` (bandeja de entrada) o `pending_approval`. En los dos últimos el agente envía datos igualmente.

### 2. Envíos: `POST /v1/reports`

Un sobre común y una lista de informes de distintos tipos:

```json
{
  "schema_version": 1,
  "agent_version": "0.1.0",
  "sent_at": "2026-11-13T12:05:00Z",
  "reports": [ { "type": "metrics", "…": "…" }, { "type": "status", "…": "…" } ]
}
```

| Tipo | Frecuencia | Contenido |
| --- | --- | --- |
| `metrics` | 5 min | CPU, RAM, volúmenes, servicios, uptime, consumo del propio agente |
| `status` | 1 h | Reinicio pendiente, antivirus, usuario conectado, red, hash del inventario |
| `daily` | 24 h | Salud de discos (SMART), actualizaciones de Windows |
| `inventory` | Solo si cambia | Hardware, SO, discos físicos |
| `event` | Al momento | Ciclo de vida del agente |

**`metrics`**

```json
{
  "type": "metrics",
  "period_start": "2026-11-13T12:00:00Z",
  "period_end": "2026-11-13T12:05:00Z",
  "samples": 10,
  "cpu": { "avg_pct": 12.4, "max_pct": 67.0 },
  "memory": { "total_bytes": 17179869184, "used_avg_pct": 58.2, "used_max_pct": 71.5 },
  "volumes": [
    { "mount": "C:", "label": "Sistema", "fs": "NTFS", "total_bytes": 511101108224, "free_bytes": 98213412864 }
  ],
  "services": {
    "critical": [ { "name": "MSSQLSERVER", "state": "running" } ],
    "auto_not_running": [ "gupdate" ]
  },
  "uptime_seconds": 384213,
  "agent": { "cpu_avg_pct": 0.2, "mem_bytes": 21495808 }
}
```

**`status`**

```json
{
  "type": "status",
  "collected_at": "2026-11-13T12:00:00Z",
  "last_boot_at": "2026-11-09T07:12:31Z",
  "reboot_pending": true,
  "reboot_pending_reasons": [ "windows_update" ],
  "antivirus": [
    { "product": "ESET Endpoint Security", "enabled": true, "up_to_date": true }
  ],
  "logged_on_user": "EMPRESA\\marta",
  "network": {
    "adapters": [ { "name": "Wi-Fi", "ipv4": [ "192.168.1.34" ], "gateway": "192.168.1.1", "dns": [ "192.168.1.1" ], "link_speed_mbps": 866 } ]
  },
  "metered_connection": false,
  "on_battery": false,
  "inventory_hash": "sha256:9f2c…"
}
```

**`daily`**

```json
{
  "type": "daily",
  "collected_at": "2026-11-13T09:40:00Z",
  "physical_disks": [
    { "serial": "S6P7NG0R", "health": "Healthy", "predict_failure": false, "temperature_c": 38, "wear_pct": 4 }
  ],
  "windows_update": { "last_installed_at": "2026-11-12T03:10:00Z", "last_kb": "KB5046617" }
}
```

`temperature_c` y `wear_pct` son opcionales: se envían solo si el disco los expone.

**`inventory`** (solo cuando el servidor lo pide porque el hash ha cambiado)

```json
{
  "type": "inventory",
  "hash": "sha256:9f2c…",
  "system": { "manufacturer": "Dell Inc.", "model": "Latitude 5440", "serial_number": "7XK2LM3", "bios_version": "1.12.0", "chassis": "laptop" },
  "cpu": { "model": "Intel Core i5-1345U", "cores": 10, "threads": 12 },
  "memory_total_bytes": 17179869184,
  "os": { "name": "Windows 11 Pro", "version": "10.0.26100", "build": "26100.2314", "install_date": "2024-03-02" },
  "physical_disks": [ { "model": "Samsung PM9A1", "serial": "S6P7NG0R", "media": "SSD", "bus": "NVMe", "size_bytes": 512110190592 } ]
}
```

El software instalado se añadirá aquí en la V2.

**`event`**

```json
{
  "type": "event",
  "event": "uninstall",
  "occurred_at": "2026-11-13T12:30:11Z",
  "data": { "reason": "manual", "initiated_by": "EMPRESA\\admin", "logged_on_user": "EMPRESA\\marta" }
}
```

Valores de `event`: `installed`, `started`, `upgraded`, `service_stopped`, `shutdown`, `uninstall`. En `uninstall`, `reason` es `manual` o `upgrade` (esta última no genera alerta).

**Respuesta de `/v1/reports`**

```json
{ "accepted": 2, "config_version": 7, "request_inventory": false }
```

Si `config_version` es mayor que la que tiene, el agente pide `GET /v1/config`. Si `request_inventory` es `true`, envía el inventario completo.

### 3. Configuración: `GET /v1/config`

```json
{
  "config_version": 7,
  "intervals": { "sample_s": 30, "metrics_s": 300, "status_s": 3600, "daily_s": 86400 },
  "jitter_s": 60,
  "metered_interval_multiplier": 3,
  "critical_services": [ "MSSQLSERVER", "VeeamBackupSvc" ],
  "self_limits": { "cpu_avg_pct": 1, "mem_mb": 40 },
  "offline_cache_max_mb": 10
}
```

### 4. Errores y comportamiento del agente

| Respuesta | Qué hace el agente |
| --- | --- |
| `2xx` | Borra de la caché lo enviado |
| `401` | Credencial revocada: deja de enviar, lo registra en el log local y reintenta cada 6 h por si se reactiva |
| `410` | Equipo eliminado en el panel: deja de enviar |
| `429` | Espera lo que indique `Retry-After` |
| `5xx` o sin red | Guarda en la caché (máx. 10 MB, descarta lo más antiguo) y reintenta con espera creciente |

## Plan de trabajo

Se avanza un paso cada vez y cada paso se confirma antes del siguiente. Marcar cada uno al terminarlo.

- [ ] **Paso 0 – Contrato de datos:** formato JSON de registro, métricas, estado, inventario y eventos del ciclo de vida.
- [ ] **Paso 1 – Estructura del proyecto:** monorepo (`agent/`, `web/`), base de datos PostgreSQL y esquema inicial.
- [ ] **Paso 2 – Agente mínimo:** lee CPU, RAM, discos, uptime e inventario básico y los muestra por consola.
- [ ] **Paso 3 – API:** registro por token (con bandeja de pendientes) y recepción de métricas autenticada por credencial del equipo.
- [ ] **Paso 4 – Agente completo:** envío real, caché sin conexión, servicio de Windows, eventos de ciclo de vida, límites de consumo.
- [ ] **Paso 5 – Panel:** login con 2FA, clientes y sedes, vista global → cliente → dispositivo, asignación de pendientes.
- [ ] **Paso 6 – Alertas:** motor de reglas por tipo, "sin reportar", correo y webhook n8n, puntuación de salud.
- [ ] **Paso 7 – Instalador MSI:** WiX, parámetro TOKEN, aviso de desinstalación, exclusiones ESET.
- [ ] **Paso 8 – Piloto:** un cliente con oficina, un portátil en remoto y (para V2) un NAS. Medir el consumo real del agente.

El código se desarrollará con Claude Code sobre el repositorio; el diseño y las revisiones, en el chat.

## Decisiones pendientes y próximo paso

Próximo paso: Paso 0, el formato JSON que envía el agente.

- [ ] Confirmar el stack: agente en Go; panel y API en Next.js (TypeScript) con PostgreSQL.
- [ ] Alojamiento del servidor: VPS (Hetzner, OVH…) o servidor propio.
- [ ] Dominio del portal y de la API (independiente de Global-Link, al ser un producto propio).
- [ ] Nombre del producto: Vylax (decidido el 13/11/2026). Agente: "Vylax Agent", vylax-agent.exe. vylax.com está en venta en un marketplace; se usará otro dominio. Pendiente: buscar la marca en TMview.
- [ ] Puntuación del cliente: media de sus equipos o la del peor equipo.
- [ ] Cliente para el piloto (con oficina, portátil en remoto y NAS).
- [ ] Plan de precios definitivo (orientativo: 1 € por equipo y mes) y forma de cobro.

# Plan del paso 5b — Cliente, ficha del equipo y gestión

## A. Tablas nuevas y migraciones

### Campos nuevos en `devices` (`0005_paso5b_devices.sql`)

```sql
ALTER TABLE devices
  ADD COLUMN device_type          text,   -- 'server'|'desktop'|'laptop'|'nas'|'ups'|null (null = sin confirmar)
  ADD COLUMN critical_services    jsonb,  -- ["MSSQLSERVER","VeeamBackupSvc"] — nombres internos de servicio
  ADD COLUMN credential_revoked_at timestamptz;  -- non-null → el agente recibe 401
```

`config_version` ya existe por equipo en `devices` (confirmado). No requiere cambio.

### Comportamiento de `credential_revoked_at`

- `lib/device-auth.ts`: si `credential_revoked_at IS NOT NULL` → devuelve `null` → las rutas `/v1/*` responden 401.
- Nuevo enroll con token válido del mismo hardware (smbios_uuid): limpia `credential_revoked_at`, genera nueva credencial, conserva historial; registra `device_reenrolled` en `audit_log` y en `agent_events`.

### Eventos nuevos en `audit_log`

No requiere migración; `event` es texto libre. Nuevos valores:

| Categoría | Eventos |
|---|---|
| Clientes | `client_created`, `client_updated`, `client_deleted` |
| Sedes | `site_created`, `site_updated`, `site_deleted` |
| Tokens | `token_created`, `token_rotated`, `token_revoked` |
| Dispositivos | `device_type_changed`, `device_moved`, `device_services_updated`, `device_credential_revoked`, `device_assigned`, `device_reenrolled` |

---

## B. Rutas y API

### Páginas (App Router, `(panel)/`)

| Ruta | Tipo | Rol mínimo |
|---|---|---|
| `/clientes` | Server Component | technician |
| `/clientes/[clientId]` | Client Component (tabs) | technician |
| `/equipos/[deviceId]` | Server Component | technician |
| `/equipos` | Server Component | technician |
| `/pendientes` | Server Component | technician |

### API Routes (mutaciones — todas requieren `role === 'admin'`)

```
POST   /api/clientes                                       crear cliente + sede inicial
PATCH  /api/clientes/[clientId]                            renombrar cliente
DELETE /api/clientes/[clientId]                            borrar cliente sin equipos

POST   /api/clientes/[clientId]/sites                      crear sede
PATCH  /api/clientes/[clientId]/sites/[siteId]             editar sede
DELETE /api/clientes/[clientId]/sites/[siteId]             borrar sede sin equipos

POST   /api/clientes/[clientId]/tokens                     crear token
POST   /api/clientes/[clientId]/tokens/[tokenId]/revoke    revocar token
POST   /api/clientes/[clientId]/tokens/[tokenId]/rotate    rotar token

PATCH  /api/equipos/[deviceId]/type                        cambiar tipo
POST   /api/equipos/[deviceId]/move                        mover cliente/sede
PATCH  /api/equipos/[deviceId]/services                    editar servicios críticos
POST   /api/equipos/[deviceId]/revoke-credential           revocar credencial

POST   /api/pendientes/[deviceId]/assign                   asignar equipo
```

---

## C. Quién puede hacer qué

| Acción | admin | technician |
|---|---|---|
| Ver lista de clientes, equipos, fichas, sedes | ✓ | ✓ |
| Ver lista de tokens (sin el token completo) | ✓ | ✓ |
| Crear/editar/borrar clientes, sedes, tokens | ✓ | — |
| Rotar tokens | ✓ | — |
| Asignar equipos pendientes | ✓ | — |
| Cambiar tipo, mover, servicios críticos | ✓ | — |
| Revocar credencial del agente | ✓ | — |
| Pestaña Ajustes del cliente | ✓ | — |

Los técnicos no ven los botones de acción ni la pestaña Ajustes. Todas las API de mutación devuelven 403 si `role !== 'admin'`.

---

## D. Paleta de colores

Toda la interfaz de 5b usa la misma paleta que `Main.dc.html` (ya usada en 5a):

- Fondo: `#0A0F1E` · Tarjetas: `#0F172A` · Bordes: `#1E293B`
- Texto: `#E2E8F0` · Secundario: `#94A3B8` · Acento: `#818CF8`
- Estados: verde `#34D399`, ámbar `#FBBF24`, rojo `#F87171`
- Fuente: Inter

---

## E. Ayudantes de librería (Parte 1)

### `lib/os-support.ts`

Tabla de versiones de Windows/Server con fecha de fin de soporte. Exporta:

```typescript
// Devuelve true si la build tiene soporte activo a fecha de hoy
function isOsSupported(osBuild: string): boolean

// Devuelve la fecha de fin de soporte, o null si no se conoce la versión
function getEolDate(osBuild: string): Date | null
```

Versiones mínimas a cubrir: Windows 10 (19041–19045), Windows 11 (22000, 22621, 26100),
Windows Server 2016/2019/2022/2025, Server Core equivalentes.

### `lib/device-checks.ts`

Calcula los anillos de seguridad y rendimiento a partir de `deviceCurrentState`. Resultado:

```typescript
type CheckResult = { ok: number; total: number; color: 'ok' | 'warn' | 'crit' }

function securityChecks(state: DeviceCurrentState): {
  result: CheckResult;
  details: Array<{ label: string; status: 'ok'|'warn'|'crit'|'no-data' }>
}

function performanceChecks(state: DeviceCurrentState): {
  result: CheckResult;
  details: Array<{ label: string; status: 'ok'|'warn'|'crit'|'no-data' }>
}
```

**Anillo de Seguridad (3 checks para PC/portátil; mismos para servidor):**
1. Antivirus activo y firmas al día → `antivirus.active && antivirus.signaturesUpToDate`
2. Actualizaciones recientes → `windowsUpdate.lastInstalledAt > now − 45 días`
3. SO con soporte → `isOsSupported(osInfo.buildNumber)` (vía `lib/os-support.ts`)

**Anillo de Rendimiento y discos (variable según volumes y physicalDisks disponibles):**
1. CPU media < 90 % (si `cpuAvgPct` disponible)
2. RAM media < 90 % (si `memoryUsedAvgPct` disponible)
3. Por cada volumen: libre > 5 % (crítico si no), > 15 % (aviso si no)
4. SMART: todos los discos `health === 'healthy'` (si `physicalDisks` disponible)

Si no hay datos para un check → estado `'no-data'`, cuenta como "no pasa".

Colores: rojo si algún check es `'crit'`, ámbar si alguno es `'warn'`, verde si todos pasan o `'no-data'`.

### `effectiveDeviceType(device)`

```typescript
// En lib/dal.ts o lib/device-utils.ts
function effectiveDeviceType(device: { deviceType: string|null; deviceTypeHint: string|null }): string | null {
  return device.deviceType ?? device.deviceTypeHint ?? null;
}
```

---

## F. Partes del plan (orden de ejecución)

---

### Parte 1 — Migración, `device-auth`, `/v1/enroll` y librerías base

1. Migración `0005_paso5b_devices.sql`: añade `device_type`, `critical_services`, `credential_revoked_at` a `devices`.
2. Actualizar `lib/device-auth.ts`: si `credential_revoked_at IS NOT NULL` → devuelve `null` (→ 401 en las rutas del agente).
3. Actualizar `app/v1/enroll/route.ts` — asignación de sede por IP pública:
   - Solo cuando el token es de cliente (no de sede): `matchedToken.clientId !== null && matchedToken.siteId === null`.
   - Consultar `sites` del cliente donde `public_ips @> ARRAY[publicIp]`.
   - Si hay coincidencia → asignar esa sede; si no → `siteId = null` ("Remotos / sin sede").
   - En reinstalación con `credential_revoked_at` activo: limpiar el campo, generar nueva credencial, registrar `device_reenrolled` en `audit_log` y en `agent_events`.
4. Implementar `lib/os-support.ts`.
5. Implementar `lib/device-checks.ts` (usa `os-support.ts`).
6. Implementar `effectiveDeviceType` en `lib/device-utils.ts`.
7. Tests:
   - `device-auth`: equipo con `credential_revoked_at` → devuelve `null`.
   - `device-checks`: equipo con antivirus OK, updates < 45 días, SO soportado → 3/3 verde.
   - `device-checks`: sin datos de antivirus → check como `'no-data'`, no pasa.
   - `os-support`: Windows 10 22H2 build 19045 → no soportado; Windows 11 24H2 build 26100 → soportado.
   - `/v1/enroll` con token de cliente e IP que coincide con una sede → `siteId` asignado.
   - `/v1/enroll` con token de cliente e IP sin coincidencia → `siteId = null`.
   - Reinstalación de equipo con `credential_revoked_at` activo → campo limpiado, nueva credencial válida.
8. Comprobaciones manuales:
   - [ ] Revocar credencial (Parte 7) → agente recibe 401 en el siguiente `/v1/reports`.
   - [ ] Reinstalar con mismo hardware y token válido → `credential_revoked_at` limpio, historial conservado.
9. Commit + push.

---

### Parte 2 — `/clientes`: lista y crear cliente

**DAL (`lib/dal.ts` — solo las funciones de esta parte):**
```typescript
getClients(orgId): ClientWithStats[]      // nombre, nº equipos por estado, semáforo provisional
getDeviceCountsByOrg(orgId): Map<clientId, counts>  // para las tarjetas
```

**UI y API:**
1. `app/(panel)/clientes/page.tsx` (Server Component):
   - Llama a `getClients(orgId)`.
   - Reutiliza `ClientGrid` de la vista general (`app/(panel)/ClientGrid.tsx`); el componente ya muestra nombre, semáforo, sedes y barras — verificar que acepta el nuevo origen o extender sin romper la vista general.
   - Botón "+ Nuevo cliente" (solo si `role === 'admin'`).
2. Modal "+ Nuevo cliente" (Client Component):
   - Campos: nombre del cliente + nombre de la primera sede.
   - `POST /api/clientes` → al crear, redirige a `/clientes/[clientId]`.
3. `app/api/clientes/route.ts`:
   - Crea cliente + sede + token de cliente (sin sede asignada) en una transacción.
   - Registra `client_created` y `site_created` y `token_created` en `audit_log`.
   - Devuelve `{ clientId, fullToken }` (el token completo solo aquí).
4. Tests:
   - `POST /api/clientes` con `role === 'technician'` → 403.
   - Crear cliente: se crean las 3 entidades (cliente, sede, token) en la misma transacción.
5. Comprobaciones manuales:
   - [ ] Lista muestra clientes con conteo correcto de equipos.
   - [ ] Crear cliente genera también la sede inicial y un token de alta.
   - [ ] Técnico no ve el botón "+ Nuevo cliente".
6. Commit + push.

---

### Parte 3 — Vista de cliente: pestaña Equipos

**DAL:**
```typescript
getClient(orgId, clientId): ClientDetail       // nombre, sedes, conteos
getDevicesForClient(orgId, clientId, filters): DeviceRow[]
// filters: { siteId?, type?, status? }
// DeviceRow incluye datos de deviceCurrentState para la tabla y el panel lateral
```

**UI:**
1. `app/(panel)/clientes/[clientId]/page.tsx` — layout de pestañas (Client Component):
   - Tabs: Equipos | Sedes | Tokens | Ajustes (Ajustes oculta si `role !== 'admin'`).
2. Pestaña **Equipos** (activa por defecto):
   - Selector de sede (dropdown) + filtros en línea: Todos · En línea · Sin reportar · Servidores · PCs · Portátiles (con contador por categoría).
   - Tabla (igual que `MixCliente.dc.html` pero con la paleta de Main): punto de estado + nombre, tipo (`effectiveDeviceType`), IP, sistema, CPU %, RAM %, disco más lleno (color semáforo), último contacto.
   - Al pulsar fila → panel lateral de detalle:
     - Nombre, badges (aviso/estado/tiempo), anillos de seguridad y rendimiento (via `device-checks.ts`), dl datos rápidos (IP, usuario, CPU, RAM, antivirus, actualizaciones, agente), barras de volúmenes, últimos 3 eventos del agente, botones "Abrir ficha completa" (→ `/equipos/[deviceId]`) y "Copiar IP".
     - Botones de acción solo si `role === 'admin'`.
3. Filtros locales en cliente (sin nueva llamada al servidor).
4. Tests:
   - Filtro "Servidores" muestra solo equipos con `effectiveDeviceType === 'server'`.
   - `getDevicesForClient` con `orgId` incorrecto → error (aislamiento).
5. Comprobaciones manuales:
   - [ ] Filtro "Sin reportar" oculta los equipos en línea.
   - [ ] Panel lateral se abre al hacer clic en fila y se cierra con la X.
   - [ ] "Abrir ficha completa" enlaza a `/equipos/[deviceId]`.
   - [ ] Paleta de Main en toda la vista (fondo `#0A0F1E`, acento `#818CF8`).
6. Commit + push.

---

### Parte 4 — Vista de cliente: pestañas Sedes y Tokens de alta

**DAL:**
```typescript
getSites(orgId, clientId): Site[]
createSite(orgId, userId, clientId, { name, publicIps: string[] })
updateSite(orgId, userId, siteId, { name, publicIps: string[] })
deleteSite(orgId, userId, siteId)       // lanza error si tiene equipos activos

getTokens(orgId, clientId): Token[]    // sin fullToken; solo id, label, prefix, siteId, revokedAt, createdAt
createToken(orgId, userId, { clientId, siteId, label }): { token: Token; fullToken: string }
revokeToken(orgId, userId, tokenId)
rotateToken(orgId, userId, tokenId): { token: Token; fullToken: string }
```

**Sedes (pestaña):**
1. Lista de sedes: nombre, IPs públicas, nº equipos. "Remotos / sin sede" siempre al final (no borrable).
2. Modal crear sede: nombre + IPs públicas (una por línea o separadas por coma).
3. Editar sede: mismo modal con valores actuales.
4. Borrar sede: confirmación; solo si no tiene equipos activos → error descriptivo si los tiene.
5. `POST/PATCH/DELETE /api/clientes/[clientId]/sites`.

**Tokens de alta (pestaña):**
6. Lista: label, prefijo (8 chars), sede (si tiene), estado (activo/revocado), fecha creación. Técnicos ven la lista pero no los botones crear/revocar/rotar.
7. Modal crear token (admin): label + sede opcional. Al crear: muestra el token completo **una sola vez** + botón "Copiar comando de instalación" (`msiexec /i vylax-agent.msi TOKEN=… /qn`). Después, solo el prefijo.
8. Revocar (admin): confirmación. Los equipos ya registrados no se ven afectados.
9. Rotar (admin): revoca el antiguo al instante + crea uno nuevo + muestra el nuevo completo una vez.
10. `POST /api/clientes/[clientId]/tokens` + `/revoke` + `/rotate`.
11. Tests:
    - `GET /v1/enroll` con token revocado → 401.
    - `createToken`: `fullToken` solo en la respuesta de creación, no almacenado en BD.
    - `rotateToken`: antiguo `revoked_at IS NOT NULL`, nuevo activo.
    - `deleteSite` con equipos activos → lanza error.
    - `POST /api/clientes/[clientId]/sites` con `role === 'technician'` → 403.
12. Comprobaciones manuales:
    - [ ] Crear token muestra el comando de instalación completo.
    - [ ] Cerrar el modal → el token completo ya no es visible.
    - [ ] Token revocado no permite dar de alta un equipo nuevo.
    - [ ] "Remotos / sin sede" aparece siempre en la lista de sedes.
13. Commit + push.

---

### Parte 5 — Vista de cliente: pestaña Ajustes

**DAL:**
```typescript
updateClient(orgId, userId, clientId, { name })
deleteClient(orgId, userId, clientId)   // lanza error si tiene CUALQUIER equipo (incluidos desinstalados)
```

**UI y API:**
1. Pestaña **Ajustes** (oculta para técnicos).
2. Campo para renombrar el cliente → `PATCH /api/clientes/[clientId]` → audit `client_updated`.
3. Botón "Eliminar cliente" → confirmación doble (escribe el nombre) → `DELETE /api/clientes/[clientId]` → audit `client_deleted`. Bloquea si tiene cualquier equipo (activos o desinstalados).
4. Tests:
   - `role === 'technician'` → 403 en PATCH y DELETE.
   - Borrar cliente con equipo desinstalado → 409 (error claro).
5. Comprobaciones manuales:
   - [ ] Renombrar cliente actualiza el nombre en la lista de `/clientes`.
   - [ ] Borrar cliente con equipos desinstalados → error descriptivo.
6. Commit + push.

---

### Parte 6 — Ficha del equipo: datos y visualizaciones

**DAL:**
```typescript
getDevice(orgId, deviceId): DeviceDetail   // device + deviceCurrentState + última inventory + agent_events (20 últimos)
getDeviceMetrics(orgId, deviceId, period: '24h' | '7d'): MetricPoint[]
// '24h' → agrupa por hora (24 puntos); '7d' → agrupa por día (7 puntos)
// fuente: metrics_5min (retención 7 días cubre ambos periodos)
// sin datos → array vacío, no explota
```

**UI:**
1. `app/(panel)/equipos/[deviceId]/page.tsx` (Server Component).
2. **Cabecera**: hostname como `<h1>`, badges (estado + tiempo + `effectiveDeviceType`), párrafo con SO · fabricante · CPU · RAM · usuario · versión agente. Enlace "← NombreCliente · NombreSede".
3. **Sección Seguridad** (tarjeta): anillo SVG inline (`securityChecks`) + desglose: antivirus, actualizaciones, SO.
4. **Sección Rendimiento y discos** (tarjeta): anillo SVG inline (`performanceChecks`) + desglose: CPU, RAM, discos por volumen, SMART.
5. **Gráfica CPU**: SVG inline; selector "24 horas" / "7 días"; datos de `getDeviceMetrics()`. Sin datos → eje vacío con texto "Sin métricas disponibles".
6. **Gráfica Memoria**: igual.
7. **Volúmenes**: grid 3 columnas; barra de uso; tamaños ÷ 1 073 741 824 mostrados como "GB" (ej. "12,3 GB libres de 232,3 GB"). Colores: rojo < 5 % libre, ámbar < 15 %, verde el resto.
8. **Discos físicos**: tabla modelo, tipo, salud SMART, temperatura, desgaste.
9. **Sistema y red**: dl con SO + build, fecha instalación, fabricante + BIOS, CPU + núcleos, red + IP, gateway + DNS, último arranque, reinicio pendiente.
10. **Historial del agente**: lista de `agent_events` ordenados desc (tipo, fecha, datos).
11. **Servicios parados**: contador + enlace "Ver lista" (modal o sección expandible).
12. **Vylax Agent**: versión, consumo (CPU %, RAM MB), próximo informe diario.
13. Botones de acción (admin): Cambiar tipo · Mover equipo · Servicios críticos · Revocar credencial (ver Parte 7).
14. Tests:
    - `getDeviceMetrics` sin datos en `metrics_5min` → array vacío.
    - Anillo seguridad: sin `antivirus` en `deviceCurrentState` → check `'no-data'`, no pasa.
    - `getDevice` con `orgId` incorrecto → error (aislamiento).
15. Comprobaciones manuales:
    - [ ] Disco de 100 GiB con 10 GiB libres → "10 GB libres de 100 GB".
    - [ ] Gráfica CPU muestra curva con datos reales del equipo (si tiene informes).
    - [ ] Anillo rendimiento ámbar si C: > 85 % (< 15 % libre).
    - [ ] Técnico no ve los botones de acción.
16. Commit + push.

---

### Parte 7 — Acciones de la ficha del equipo

**DAL:**
```typescript
setDeviceType(orgId, userId, deviceId, type: 'server'|'desktop'|'laptop'|'nas'|'ups')
// registra device_type_changed en audit_log

moveDevice(orgId, userId, deviceId, { clientId, siteId })
// actualiza client_id y site_id; historial, métricas y eventos se conservan
// registra device_moved en audit_log

updateCriticalServices(orgId, userId, deviceId, services: string[])
// services: nombres internos (MSSQLSERVER, VeeamBackupSvc…)
// config_version += 1 en la misma transacción
// registra device_services_updated en audit_log

revokeDeviceCredential(orgId, userId, deviceId)
// credential_revoked_at = now()
// registra device_credential_revoked en audit_log
```

**UI y API:**
1. Modal **Cambiar tipo** (admin): selector servidor/sobremesa/portátil → `PATCH /api/equipos/[id]/type`.
2. Modal **Mover equipo** (admin): selector de cliente (dropdown filtrado por org) + sede del cliente elegido → `POST /api/equipos/[id]/move`.
3. Modal **Servicios críticos** (admin): lista editable de nombres internos de servicio (input de texto, uno por línea o tags); nota de ayuda: "Usa el nombre interno del servicio de Windows (p. ej. MSSQLSERVER, VeeamBackupSvc)" → `PATCH /api/equipos/[id]/services`.
4. Modal **Revocar credencial** (admin): confirmación con explicación clara ("El agente recibirá 401 en su próximo envío. Para recuperarlo, reinstalarlo con un token de alta válido.") → `POST /api/equipos/[id]/revoke-credential`.
5. Tests:
   - `role === 'technician'` → 403 en todas estas rutas.
   - `revokeDeviceCredential`: `credential_revoked_at IS NOT NULL`; el hash no cambia.
   - `updateCriticalServices`: `config_version` incrementado en +1.
   - `moveDevice`: `client_id` y `site_id` actualizados; `agent_events` sin tocar.
6. Comprobaciones manuales:
   - [ ] Revocar credencial → agente recibe 401 en el siguiente `/v1/reports`.
   - [ ] Mover equipo → aparece bajo el nuevo cliente en `/clientes/[nuevoClienteId]`.
   - [ ] Cambiar tipo → ficha muestra el nuevo tipo.
   - [ ] Editar servicios críticos → `config_version` ha subido (visible en `/v1/config`).
7. Commit + push.

---

### Parte 8 — `/equipos`: todos los equipos de la org

**DAL:**
```typescript
getDevicesForOrg(orgId, filters): DeviceRow[]
// filters: { type?, status?, search? (hostname o IP) }
```

**UI:**
1. `app/(panel)/equipos/page.tsx` (Server Component):
   - Tabla con columna extra "Cliente" respecto a la pestaña Equipos del cliente.
   - Filtros: tipo (Todos/Servidores/PCs/Portátiles), estado (Todos/En línea/Sin reportar/Desinstalados), buscador (hostname o IP, debounce en cliente).
   - Paginación de 50 registros.
   - Fila → enlaza directamente a `/equipos/[deviceId]` (sin panel lateral).
2. Tests:
   - Solo devuelve equipos de la org activa.
   - Filtro "Sin reportar" no devuelve equipos `online`.
3. Comprobaciones manuales:
   - [ ] Buscar por hostname filtra la lista.
   - [ ] Filtro "Sin reportar" muestra solo equipos unreporting.
4. Commit + push.

---

### Parte 9 — `/pendientes`: asignar equipos sin cliente

**DAL:**
```typescript
getPendingDevices(orgId): DeviceRow[]    // status = 'pending_assignment'
getOrgToken(orgId): Token | null         // enrollment token con clientId = null (token general de la org)
createOrgToken(orgId, userId, label): { token: Token; fullToken: string }  // si no existe todavía
assignDevice(orgId, userId, deviceId, { clientId: string; siteId: string | null })
// status → 'active', fija client_id y site_id
// registra device_assigned en audit_log
```

**UI:**
1. `app/(panel)/pendientes/page.tsx`:
   - Lista `getPendingDevices(orgId)`: hostname, fecha alta, IP pública, UUID.
   - **Token general de la org** (sección fija al principio): muestra el prefijo del token activo + botón "Copiar comando de instalación" (`msiexec /i vylax-agent.msi TOKEN=… /qn`; comando visible porque el token completo no se guarda — solo se puede copiar en el momento de creación). Si no existe → botón "Crear token general" (admin). Si existe y el admin quiere rotarlo, botón "Rotar" (admin).
   - Badge "Pendientes de asignar" en menú lateral con recuento real (ya hay el slot).
2. Modal "Asignar equipo" (admin):
   - Radio: "Asignar a cliente existente" (dropdown) o "+ Crear cliente" (nombre + nombre de sede).
   - Si cliente existente: selector de sede.
   - Botón "Asignar" → `POST /api/pendientes/[deviceId]/assign` → `status = 'active'`.
3. Tests:
   - Asignar cambia `status` de `'pending_assignment'` a `'active'`.
   - Equipo asignado no aparece en `getPendingDevices`.
   - `role === 'technician'` → 403 en la API de asignación.
4. Comprobaciones manuales:
   - [ ] Badge del menú muestra recuento correcto.
   - [ ] Asignar a cliente existente → equipo aparece en `/clientes/[clienteId]`.
   - [ ] Asignar creando cliente nuevo → crea cliente + sede y el equipo aparece en la nueva vista.
   - [ ] Token general: si ya fue creado en otra sesión, el botón "Copiar comando" no funciona (solo muestra el prefijo y la opción de rotar).
5. Commit + push.

---

## G. Notas de implementación

- **`critical_services`**: almacena el nombre interno del servicio de Windows (p. ej. `MSSQLSERVER`, `VeeamBackupSvc`, `W3SVC`), no el nombre visible. La UI muestra una nota de ayuda al editar.
- **Token completo**: nunca se almacena entero en BD. El `fullToken` solo viaja en la respuesta de `createToken` / `rotateToken` y no se persiste en ningún sitio en servidor.
- **Tamaños en GiB mostrados como "GB"**: dividir por 1 073 741 824 y mostrar con una decimal; etiquetar como "GB" sin aclaración (convención del producto).
- **`effectiveDeviceType`**: siempre usar esta función para mostrar el tipo; prioriza `device_type` (confirmado por admin) sobre `device_type_hint` (enviado por el agente).
- **"Descargar agente para [cliente]"**: reservado para el paso 7 (MSI con token embebido).
- **`/clientes` reutiliza `ClientGrid`**: verificar que el componente acepta los datos del nuevo origen o refactorizarlo sin romper la vista general.
- **Selector de sede en las gráficas de CPU/RAM**: Client Component con `useTransition` + nuevo fetch al cambiar el periodo, o SSR con `searchParams`. Preferir `searchParams` para mantener Server Components.

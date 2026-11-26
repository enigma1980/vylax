# Plan del paso 5b â€” Cliente, ficha del equipo y gestiÃ³n

## A. Tablas nuevas y migraciones

### Campos nuevos en `devices` (`0005_paso5b_devices.sql`)

```sql
ALTER TABLE devices
  ADD COLUMN device_type          text,   -- 'server'|'desktop'|'laptop'|'nas'|'ups'|null (null = sin confirmar)
  ADD COLUMN critical_services    jsonb,  -- ["MSSQLSERVER","VeeamBackupSvc"] â€” nombres internos de servicio
  ADD COLUMN credential_revoked_at timestamptz;  -- non-null â†’ el agente recibe 401
```

`config_version` ya existe por equipo en `devices` (confirmado). No requiere cambio.

### Comportamiento de `credential_revoked_at`

- `lib/device-auth.ts`: si `credential_revoked_at IS NOT NULL` â†’ devuelve `null` â†’ las rutas `/v1/*` responden 401.
- Nuevo enroll con token vÃ¡lido del mismo hardware (smbios_uuid): limpia `credential_revoked_at`, genera nueva credencial, conserva historial; registra `device_reenrolled` en `audit_log` y en `agent_events`.

### Eventos nuevos en `audit_log`

No requiere migraciÃ³n; `event` es texto libre. Nuevos valores:

| CategorÃ­a | Eventos |
|---|---|
| Clientes | `client_created`, `client_updated`, `client_deleted` |
| Sedes | `site_created`, `site_updated`, `site_deleted` |
| Tokens | `token_created`, `token_rotated`, `token_revoked` |
| Dispositivos | `device_type_changed`, `device_moved`, `device_services_updated`, `device_credential_revoked`, `device_assigned`, `device_reenrolled` |

---

## B. Rutas y API

### PÃ¡ginas (App Router, `(panel)/`)

| Ruta | Tipo | Rol mÃ­nimo |
|---|---|---|
| `/clientes` | Server Component | technician |
| `/clientes/[clientId]` | Client Component (tabs) | technician |
| `/equipos/[deviceId]` | Server Component | technician |
| `/equipos` | Server Component | technician |
| `/pendientes` | Server Component | technician |

### API Routes (mutaciones â€” todas requieren `role === 'admin'`)

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
PATCH  /api/equipos/[deviceId]/services                    editar servicios crÃ­ticos
POST   /api/equipos/[deviceId]/revoke-credential           revocar credencial

POST   /api/pendientes/[deviceId]/assign                   asignar equipo
```

---

## C. QuiÃ©n puede hacer quÃ©

| AcciÃ³n | admin | technician |
|---|---|---|
| Ver lista de clientes, equipos, fichas, sedes | âœ“ | âœ“ |
| Ver lista de tokens (sin el token completo) | âœ“ | âœ“ |
| Crear/editar/borrar clientes, sedes, tokens | âœ“ | â€” |
| Rotar tokens | âœ“ | â€” |
| Asignar equipos pendientes | âœ“ | â€” |
| Cambiar tipo, mover, servicios crÃ­ticos | âœ“ | â€” |
| Revocar credencial del agente | âœ“ | â€” |
| PestaÃ±a Ajustes del cliente | âœ“ | â€” |

Los tÃ©cnicos no ven los botones de acciÃ³n ni la pestaÃ±a Ajustes. Todas las API de mutaciÃ³n devuelven 403 si `role !== 'admin'`.

---

## D. Paleta de colores

Toda la interfaz de 5b usa la misma paleta que `Main.dc.html` (ya usada en 5a):

- Fondo: `#0A0F1E` Â· Tarjetas: `#0F172A` Â· Bordes: `#1E293B`
- Texto: `#E2E8F0` Â· Secundario: `#94A3B8` Â· Acento: `#818CF8`
- Estados: verde `#34D399`, Ã¡mbar `#FBBF24`, rojo `#F87171`
- Fuente: Inter

---

## E. Ayudantes de librerÃ­a (Parte 1)

### `lib/os-support.ts`

Tabla de versiones de Windows/Server con fecha de fin de soporte. Exporta:

```typescript
// Devuelve true si la build tiene soporte activo a fecha de hoy
function isOsSupported(osBuild: string): boolean

// Devuelve la fecha de fin de soporte, o null si no se conoce la versiÃ³n
function getEolDate(osBuild: string): Date | null
```

Versiones mÃ­nimas a cubrir: Windows 10 (19041â€“19045), Windows 11 (22000, 22621, 26100),
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

**Anillo de Seguridad (3 checks para PC/portÃ¡til; mismos para servidor):**
1. Antivirus activo y firmas al dÃ­a â†’ `antivirus.active && antivirus.signaturesUpToDate`
2. Actualizaciones recientes â†’ `windowsUpdate.lastInstalledAt > now âˆ’ 45 dÃ­as`
3. SO con soporte â†’ `isOsSupported(osInfo.buildNumber)` (vÃ­a `lib/os-support.ts`)

**Anillo de Rendimiento y discos (variable segÃºn volumes y physicalDisks disponibles):**
1. CPU media < 90 % (si `cpuAvgPct` disponible)
2. RAM media < 90 % (si `memoryUsedAvgPct` disponible)
3. Por cada volumen: libre > 5 % (crÃ­tico si no), > 15 % (aviso si no)
4. SMART: todos los discos `health === 'healthy'` (si `physicalDisks` disponible)

Si no hay datos para un check â†’ estado `'no-data'`, cuenta como "no pasa".

Colores: rojo si algÃºn check es `'crit'`, Ã¡mbar si alguno es `'warn'`, verde si todos pasan o `'no-data'`.

### `effectiveDeviceType(device)`

```typescript
// En lib/dal.ts o lib/device-utils.ts
function effectiveDeviceType(device: { deviceType: string|null; deviceTypeHint: string|null }): string | null {
  return device.deviceType ?? device.deviceTypeHint ?? null;
}
```

---

## F. Partes del plan (orden de ejecuciÃ³n)

---

### Parte 1 â€” MigraciÃ³n, `device-auth`, `/v1/enroll` y librerÃ­as base

1. MigraciÃ³n `0005_paso5b_devices.sql`: aÃ±ade `device_type`, `critical_services`, `credential_revoked_at` a `devices`.
2. Actualizar `lib/device-auth.ts`: si `credential_revoked_at IS NOT NULL` â†’ devuelve `null` (â†’ 401 en las rutas del agente).
3. Actualizar `app/v1/enroll/route.ts` â€” asignaciÃ³n de sede por IP pÃºblica:
   - Solo cuando el token es de cliente (no de sede): `matchedToken.clientId !== null && matchedToken.siteId === null`.
   - Consultar `sites` del cliente donde `public_ips @> ARRAY[publicIp]`.
   - Si hay coincidencia â†’ asignar esa sede; si no â†’ `siteId = null` ("Remotos / sin sede").
   - En reinstalaciÃ³n con `credential_revoked_at` activo: limpiar el campo, generar nueva credencial, registrar `device_reenrolled` en `audit_log` y en `agent_events`.
4. Implementar `lib/os-support.ts`.
5. Implementar `lib/device-checks.ts` (usa `os-support.ts`).
6. Implementar `effectiveDeviceType` en `lib/device-utils.ts`.
7. Tests:
   - `device-auth`: equipo con `credential_revoked_at` â†’ devuelve `null`.
   - `device-checks`: equipo con antivirus OK, updates < 45 dÃ­as, SO soportado â†’ 3/3 verde.
   - `device-checks`: sin datos de antivirus â†’ check como `'no-data'`, no pasa.
   - `os-support`: Windows 10 22H2 build 19045 â†’ no soportado; Windows 11 24H2 build 26100 â†’ soportado.
   - `/v1/enroll` con token de cliente e IP que coincide con una sede â†’ `siteId` asignado.
   - `/v1/enroll` con token de cliente e IP sin coincidencia â†’ `siteId = null`.
   - ReinstalaciÃ³n de equipo con `credential_revoked_at` activo â†’ campo limpiado, nueva credencial vÃ¡lida.
8. Comprobaciones manuales:
   - [ ] Revocar credencial (Parte 7) â†’ agente recibe 401 en el siguiente `/v1/reports`.
   - [ ] Reinstalar con mismo hardware y token vÃ¡lido â†’ `credential_revoked_at` limpio, historial conservado.
9. Commit + push.

---

### Parte 2 â€” `/clientes`: lista y crear cliente

**DAL (`lib/dal.ts` â€” solo las funciones de esta parte):**
```typescript
getClients(orgId): ClientWithStats[]      // nombre, nÂº equipos por estado, semÃ¡foro provisional
getDeviceCountsByOrg(orgId): Map<clientId, counts>  // para las tarjetas
```

**UI y API:**
1. `app/(panel)/clientes/page.tsx` (Server Component):
   - Llama a `getClients(orgId)`.
   - Reutiliza `ClientGrid` de la vista general (`app/(panel)/ClientGrid.tsx`); el componente ya muestra nombre, semÃ¡foro, sedes y barras â€” verificar que acepta el nuevo origen o extender sin romper la vista general.
   - BotÃ³n "+ Nuevo cliente" (solo si `role === 'admin'`).
2. Modal "+ Nuevo cliente" (Client Component):
   - Campos: nombre del cliente + nombre de la primera sede.
   - `POST /api/clientes` â†’ al crear, redirige a `/clientes/[clientId]`.
3. `app/api/clientes/route.ts`:
   - Crea cliente + sede + token de cliente (sin sede asignada) en una transacciÃ³n.
   - Registra `client_created` y `site_created` y `token_created` en `audit_log`.
   - Devuelve `{ clientId, fullToken }` (el token completo solo aquÃ­).
4. Tests:
   - `POST /api/clientes` con `role === 'technician'` â†’ 403.
   - Crear cliente: se crean las 3 entidades (cliente, sede, token) en la misma transacciÃ³n.
5. Comprobaciones manuales:
   - [ ] Lista muestra clientes con conteo correcto de equipos.
   - [ ] Crear cliente genera tambiÃ©n la sede inicial y un token de alta.
   - [ ] TÃ©cnico no ve el botÃ³n "+ Nuevo cliente".
6. Commit + push.

---

### Parte 3 â€” Vista de cliente: pestaÃ±a Equipos

**DAL:**
```typescript
getClient(orgId, clientId): ClientDetail       // nombre, sedes, conteos
getDevicesForClient(orgId, clientId, filters): DeviceRow[]
// filters: { siteId?, type?, status? }
// DeviceRow incluye datos de deviceCurrentState para la tabla y el panel lateral
```

**UI:**
1. `app/(panel)/clientes/[clientId]/page.tsx` â€” layout de pestaÃ±as (Client Component):
   - Tabs: Equipos | Sedes | Tokens | Ajustes (Ajustes oculta si `role !== 'admin'`).
2. PestaÃ±a **Equipos** (activa por defecto):
   - Selector de sede (dropdown) + filtros en lÃ­nea: Todos Â· En lÃ­nea Â· Sin reportar Â· Servidores Â· PCs Â· PortÃ¡tiles (con contador por categorÃ­a).
   - Tabla (igual que `MixCliente.dc.html` pero con la paleta de Main): punto de estado + nombre, tipo (`effectiveDeviceType`), IP, sistema, CPU %, RAM %, disco mÃ¡s lleno (color semÃ¡foro), Ãºltimo contacto.
   - Al pulsar fila â†’ panel lateral de detalle:
     - Nombre, badges (aviso/estado/tiempo), anillos de seguridad y rendimiento (via `device-checks.ts`), dl datos rÃ¡pidos (IP, usuario, CPU, RAM, antivirus, actualizaciones, agente), barras de volÃºmenes, Ãºltimos 3 eventos del agente, botones "Abrir ficha completa" (â†’ `/equipos/[deviceId]`) y "Copiar IP".
     - Botones de acciÃ³n solo si `role === 'admin'`.
3. Filtros locales en cliente (sin nueva llamada al servidor).
4. Tests:
   - Filtro "Servidores" muestra solo equipos con `effectiveDeviceType === 'server'`.
   - `getDevicesForClient` con `orgId` incorrecto â†’ error (aislamiento).
5. Comprobaciones manuales:
   - [ ] Filtro "Sin reportar" oculta los equipos en lÃ­nea.
   - [ ] Panel lateral se abre al hacer clic en fila y se cierra con la X.
   - [ ] "Abrir ficha completa" enlaza a `/equipos/[deviceId]`.
   - [ ] Paleta de Main en toda la vista (fondo `#0A0F1E`, acento `#818CF8`).
6. Commit + push.

---

### Parte 4 â€” Vista de cliente: pestaÃ±as Sedes y Tokens de alta

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

**Sedes (pestaÃ±a):**
1. Lista de sedes: nombre, IPs pÃºblicas, nÂº equipos. "Remotos / sin sede" siempre al final (no borrable).
2. Modal crear sede: nombre + IPs pÃºblicas (una por lÃ­nea o separadas por coma).
3. Editar sede: mismo modal con valores actuales.
4. Borrar sede: confirmaciÃ³n; solo si no tiene equipos activos â†’ error descriptivo si los tiene.
5. `POST/PATCH/DELETE /api/clientes/[clientId]/sites`.

**Tokens de alta (pestaÃ±a):**
6. Lista: label, prefijo (8 chars), sede (si tiene), estado (activo/revocado), fecha creaciÃ³n. TÃ©cnicos ven la lista pero no los botones crear/revocar/rotar.
7. Modal crear token (admin): label + sede opcional. Al crear: muestra el token completo **una sola vez** + botÃ³n "Copiar comando de instalaciÃ³n" (`msiexec /i Guaitiq-agent.msi TOKEN=â€¦ /qn`). DespuÃ©s, solo el prefijo.
8. Revocar (admin): confirmaciÃ³n. Los equipos ya registrados no se ven afectados.
9. Rotar (admin): revoca el antiguo al instante + crea uno nuevo + muestra el nuevo completo una vez.
10. `POST /api/clientes/[clientId]/tokens` + `/revoke` + `/rotate`.
11. Tests:
    - `GET /v1/enroll` con token revocado â†’ 401.
    - `createToken`: `fullToken` solo en la respuesta de creaciÃ³n, no almacenado en BD.
    - `rotateToken`: antiguo `revoked_at IS NOT NULL`, nuevo activo.
    - `deleteSite` con equipos activos â†’ lanza error.
    - `POST /api/clientes/[clientId]/sites` con `role === 'technician'` â†’ 403.
12. Comprobaciones manuales:
    - [ ] Crear token muestra el comando de instalaciÃ³n completo.
    - [ ] Cerrar el modal â†’ el token completo ya no es visible.
    - [ ] Token revocado no permite dar de alta un equipo nuevo.
    - [ ] "Remotos / sin sede" aparece siempre en la lista de sedes.
13. Commit + push.

---

### Parte 5 â€” Vista de cliente: pestaÃ±a Ajustes

**DAL:**
```typescript
updateClient(orgId, userId, clientId, { name })
deleteClient(orgId, userId, clientId)   // lanza error si tiene CUALQUIER equipo (incluidos desinstalados)
```

**UI y API:**
1. PestaÃ±a **Ajustes** (oculta para tÃ©cnicos).
2. Campo para renombrar el cliente â†’ `PATCH /api/clientes/[clientId]` â†’ audit `client_updated`.
3. BotÃ³n "Eliminar cliente" â†’ confirmaciÃ³n doble (escribe el nombre) â†’ `DELETE /api/clientes/[clientId]` â†’ audit `client_deleted`. Bloquea si tiene cualquier equipo (activos o desinstalados).
4. Tests:
   - `role === 'technician'` â†’ 403 en PATCH y DELETE.
   - Borrar cliente con equipo desinstalado â†’ 409 (error claro).
5. Comprobaciones manuales:
   - [ ] Renombrar cliente actualiza el nombre en la lista de `/clientes`.
   - [ ] Borrar cliente con equipos desinstalados â†’ error descriptivo.
6. Commit + push.

---

### Parte 6 â€” Ficha del equipo: datos y visualizaciones

**DAL:**
```typescript
getDevice(orgId, deviceId): DeviceDetail   // device + deviceCurrentState + Ãºltima inventory + agent_events (20 Ãºltimos)
getDeviceMetrics(orgId, deviceId, period: '24h' | '7d'): MetricPoint[]
// '24h' â†’ agrupa por hora (24 puntos); '7d' â†’ agrupa por dÃ­a (7 puntos)
// fuente: metrics_5min (retenciÃ³n 7 dÃ­as cubre ambos periodos)
// sin datos â†’ array vacÃ­o, no explota
```

**UI:**
1. `app/(panel)/equipos/[deviceId]/page.tsx` (Server Component).
2. **Cabecera**: hostname como `<h1>`, badges (estado + tiempo + `effectiveDeviceType`), pÃ¡rrafo con SO Â· fabricante Â· CPU Â· RAM Â· usuario Â· versiÃ³n agente. Enlace "â† NombreCliente Â· NombreSede".
3. **SecciÃ³n Seguridad** (tarjeta): anillo SVG inline (`securityChecks`) + desglose: antivirus, actualizaciones, SO.
4. **SecciÃ³n Rendimiento y discos** (tarjeta): anillo SVG inline (`performanceChecks`) + desglose: CPU, RAM, discos por volumen, SMART.
5. **GrÃ¡fica CPU**: SVG inline; selector "24 horas" / "7 dÃ­as"; datos de `getDeviceMetrics()`. Sin datos â†’ eje vacÃ­o con texto "Sin mÃ©tricas disponibles".
6. **GrÃ¡fica Memoria**: igual.
7. **VolÃºmenes**: grid 3 columnas; barra de uso; tamaÃ±os Ã· 1 073 741 824 mostrados como "GB" (ej. "12,3 GB libres de 232,3 GB"). Colores: rojo < 5 % libre, Ã¡mbar < 15 %, verde el resto.
8. **Discos fÃ­sicos**: tabla modelo, tipo, salud SMART, temperatura, desgaste.
9. **Sistema y red**: dl con SO + build, fecha instalaciÃ³n, fabricante + BIOS, CPU + nÃºcleos, red + IP, gateway + DNS, Ãºltimo arranque, reinicio pendiente.
10. **Historial del agente**: lista de `agent_events` ordenados desc (tipo, fecha, datos).
11. **Servicios parados**: contador + enlace "Ver lista" (modal o secciÃ³n expandible).
12. **Guaitiq Agent**: versiÃ³n, consumo (CPU %, RAM MB), prÃ³ximo informe diario.
13. Botones de acciÃ³n (admin): Cambiar tipo Â· Mover equipo Â· Servicios crÃ­ticos Â· Revocar credencial (ver Parte 7).
14. Tests:
    - `getDeviceMetrics` sin datos en `metrics_5min` â†’ array vacÃ­o.
    - Anillo seguridad: sin `antivirus` en `deviceCurrentState` â†’ check `'no-data'`, no pasa.
    - `getDevice` con `orgId` incorrecto â†’ error (aislamiento).
15. Comprobaciones manuales:
    - [ ] Disco de 100 GiB con 10 GiB libres â†’ "10 GB libres de 100 GB".
    - [ ] GrÃ¡fica CPU muestra curva con datos reales del equipo (si tiene informes).
    - [ ] Anillo rendimiento Ã¡mbar si C: > 85 % (< 15 % libre).
    - [ ] TÃ©cnico no ve los botones de acciÃ³n.
16. Commit + push.

---

### Parte 7 â€” Acciones de la ficha del equipo

**DAL:**
```typescript
setDeviceType(orgId, userId, deviceId, type: 'server'|'desktop'|'laptop'|'nas'|'ups')
// registra device_type_changed en audit_log

moveDevice(orgId, userId, deviceId, { clientId, siteId })
// actualiza client_id y site_id; historial, mÃ©tricas y eventos se conservan
// registra device_moved en audit_log

updateCriticalServices(orgId, userId, deviceId, services: string[])
// services: nombres internos (MSSQLSERVER, VeeamBackupSvcâ€¦)
// config_version += 1 en la misma transacciÃ³n
// registra device_services_updated en audit_log

revokeDeviceCredential(orgId, userId, deviceId)
// credential_revoked_at = now()
// registra device_credential_revoked en audit_log
```

**UI y API:**
1. Modal **Cambiar tipo** (admin): selector servidor/sobremesa/portÃ¡til â†’ `PATCH /api/equipos/[id]/type`.
2. Modal **Mover equipo** (admin): selector de cliente (dropdown filtrado por org) + sede del cliente elegido â†’ `POST /api/equipos/[id]/move`.
3. Modal **Servicios crÃ­ticos** (admin): lista editable de nombres internos de servicio (input de texto, uno por lÃ­nea o tags); nota de ayuda: "Usa el nombre interno del servicio de Windows (p. ej. MSSQLSERVER, VeeamBackupSvc)" â†’ `PATCH /api/equipos/[id]/services`.
4. Modal **Revocar credencial** (admin): confirmaciÃ³n con explicaciÃ³n clara ("El agente recibirÃ¡ 401 en su prÃ³ximo envÃ­o. Para recuperarlo, reinstalarlo con un token de alta vÃ¡lido.") â†’ `POST /api/equipos/[id]/revoke-credential`.
5. Tests:
   - `role === 'technician'` â†’ 403 en todas estas rutas.
   - `revokeDeviceCredential`: `credential_revoked_at IS NOT NULL`; el hash no cambia.
   - `updateCriticalServices`: `config_version` incrementado en +1.
   - `moveDevice`: `client_id` y `site_id` actualizados; `agent_events` sin tocar.
6. Comprobaciones manuales:
   - [ ] Revocar credencial â†’ agente recibe 401 en el siguiente `/v1/reports`.
   - [ ] Mover equipo â†’ aparece bajo el nuevo cliente en `/clientes/[nuevoClienteId]`.
   - [ ] Cambiar tipo â†’ ficha muestra el nuevo tipo.
   - [ ] Editar servicios crÃ­ticos â†’ `config_version` ha subido (visible en `/v1/config`).
7. Commit + push.

---

### Parte 8 â€” `/equipos`: todos los equipos de la org

**DAL:**
```typescript
getDevicesForOrg(orgId, filters): DeviceRow[]
// filters: { type?, status?, search? (hostname o IP) }
```

**UI:**
1. `app/(panel)/equipos/page.tsx` (Server Component):
   - Tabla con columna extra "Cliente" respecto a la pestaÃ±a Equipos del cliente.
   - Filtros: tipo (Todos/Servidores/PCs/PortÃ¡tiles), estado (Todos/En lÃ­nea/Sin reportar/Desinstalados), buscador (hostname o IP, debounce en cliente).
   - PaginaciÃ³n de 50 registros.
   - Fila â†’ enlaza directamente a `/equipos/[deviceId]` (sin panel lateral).
2. Tests:
   - Solo devuelve equipos de la org activa.
   - Filtro "Sin reportar" no devuelve equipos `online`.
3. Comprobaciones manuales:
   - [ ] Buscar por hostname filtra la lista.
   - [ ] Filtro "Sin reportar" muestra solo equipos unreporting.
4. Commit + push.

---

### Parte 9 â€” `/pendientes`: asignar equipos sin cliente

**DAL:**
```typescript
getPendingDevices(orgId): DeviceRow[]    // status = 'pending_assignment'
getOrgToken(orgId): Token | null         // enrollment token con clientId = null (token general de la org)
createOrgToken(orgId, userId, label): { token: Token; fullToken: string }  // si no existe todavÃ­a
assignDevice(orgId, userId, deviceId, { clientId: string; siteId: string | null })
// status â†’ 'active', fija client_id y site_id
// registra device_assigned en audit_log
```

**UI:**
1. `app/(panel)/pendientes/page.tsx`:
   - Lista `getPendingDevices(orgId)`: hostname, fecha alta, IP pÃºblica, UUID.
   - **Token general de la org** (secciÃ³n fija al principio): muestra el prefijo del token activo + botÃ³n "Copiar comando de instalaciÃ³n" (`msiexec /i Guaitiq-agent.msi TOKEN=â€¦ /qn`; comando visible porque el token completo no se guarda â€” solo se puede copiar en el momento de creaciÃ³n). Si no existe â†’ botÃ³n "Crear token general" (admin). Si existe y el admin quiere rotarlo, botÃ³n "Rotar" (admin).
   - Badge "Pendientes de asignar" en menÃº lateral con recuento real (ya hay el slot).
2. Modal "Asignar equipo" (admin):
   - Radio: "Asignar a cliente existente" (dropdown) o "+ Crear cliente" (nombre + nombre de sede).
   - Si cliente existente: selector de sede.
   - BotÃ³n "Asignar" â†’ `POST /api/pendientes/[deviceId]/assign` â†’ `status = 'active'`.
3. Tests:
   - Asignar cambia `status` de `'pending_assignment'` a `'active'`.
   - Equipo asignado no aparece en `getPendingDevices`.
   - `role === 'technician'` â†’ 403 en la API de asignaciÃ³n.
4. Comprobaciones manuales:
   - [ ] Badge del menÃº muestra recuento correcto.
   - [ ] Asignar a cliente existente â†’ equipo aparece en `/clientes/[clienteId]`.
   - [ ] Asignar creando cliente nuevo â†’ crea cliente + sede y el equipo aparece en la nueva vista.
   - [ ] Token general: si ya fue creado en otra sesiÃ³n, el botÃ³n "Copiar comando" no funciona (solo muestra el prefijo y la opciÃ³n de rotar).
5. Commit + push.

---

## G. Notas de implementaciÃ³n

- **`critical_services`**: almacena el nombre interno del servicio de Windows (p. ej. `MSSQLSERVER`, `VeeamBackupSvc`, `W3SVC`), no el nombre visible. La UI muestra una nota de ayuda al editar.
- **Token completo**: nunca se almacena entero en BD. El `fullToken` solo viaja en la respuesta de `createToken` / `rotateToken` y no se persiste en ningÃºn sitio en servidor.
- **TamaÃ±os en GiB mostrados como "GB"**: dividir por 1 073 741 824 y mostrar con una decimal; etiquetar como "GB" sin aclaraciÃ³n (convenciÃ³n del producto).
- **`effectiveDeviceType`**: siempre usar esta funciÃ³n para mostrar el tipo; prioriza `device_type` (confirmado por admin) sobre `device_type_hint` (enviado por el agente).
- **"Descargar agente para [cliente]"**: reservado para el paso 7 (MSI con token embebido).
- **`/clientes` reutiliza `ClientGrid`**: verificar que el componente acepta los datos del nuevo origen o refactorizarlo sin romper la vista general.
- **Selector de sede en las grÃ¡ficas de CPU/RAM**: Client Component con `useTransition` + nuevo fetch al cambiar el periodo, o SSR con `searchParams`. Preferir `searchParams` para mantener Server Components.


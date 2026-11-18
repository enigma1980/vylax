# Plan del paso 5a — Acceso, estructura y vista general

## A. Base de datos: tablas nuevas y campos

**`users`** (ajustar existente; eliminar `role`):
- `id`, `email` (único), `password_hash` (`@node-rs/argon2`)
- `two_fa_method` (`null` | `totp` | `email`) — para email, se fija solo tras verificar el primer código
- `totp_verified` (bool)
- `totp_secret_encrypted` (AES-256-GCM, clave en `VYLAX_ENCRYPTION_KEY`)
- `totp_last_step` (entero; paso de tiempo del último código TOTP aceptado, para prevenir replay)
- `recovery_codes` (array de hashes argon2id, 8 códigos de un solo uso)
- `email_code_hash`, `email_code_expires_at`, `email_code_attempts`
- `password_attempts`, `password_locked_until`
- `created_at`, `updated_at`

**`user_organizations`** — relación M:N usuario ↔ organización:
- `user_id`, `org_id`, `role` (`admin` | `technician`)

**`sessions`**:
- `id`, `token_hash` (SHA-256 del token que viaja en la cookie)
- `user_id`, `org_id` (null hasta seleccionar organización)
- `mfa_verified_at` — null = sesión parcial (máx. 10 min, sin acceso al panel); valor = sesión completa
- `last_active_at`, `expires_at`, `created_at`, `ip`, `user_agent`
- Índice único en `token_hash`

**`trusted_devices`**:
- `id`, `token_hash`, `user_id`, `created_at`, `expires_at`, `user_agent`
- Se invalidan todas al cambiar contraseña o reiniciar 2FA

**`audit_log`**:
- `id`, `user_id` (nullable), `org_id` (nullable)
- `event`: `login_ok`, `login_failed`, `lockout`, `2fa_ok`, `2fa_failed`, `logout`, `org_changed`, `password_changed`, `2fa_reset`
- `ip`, `user_agent`, `metadata` (JSONB), `created_at`

**`devices`**: verificar que tiene el campo `last_seen_at` y que se actualiza en cada `/v1/reports`. Si no existe, añadirlo como `TIMESTAMPTZ` actualizado al procesar cualquier informe, sin cambiar el contrato con el agente.

Seed: mantiene la organización Global-Link; sin usuario ni contraseña por defecto.

---

## B. Scripts npm

**`npm run user:create`** — `web/scripts/user-create.ts`:
Pide por consola correo, contraseña sin eco y confirmación, organización y rol. Hashea con `@node-rs/argon2` e inserta en BD con Drizzle.

**`npm run user:set-password <email>`** — `web/scripts/user-set-password.ts`:
Pide nueva contraseña sin eco y confirmación. Hashea con `@node-rs/argon2`, actualiza `password_hash`, pone `password_attempts = 0`, invalida todas las sesiones y dispositivos de confianza del usuario. Registra `password_changed` en `audit_log`. Usar también para las comprobaciones manuales de "cambio de contraseña invalida dispositivos de confianza".

**`npm run user:reset-2fa <email>`** — `web/scripts/user-reset-2fa.ts`:
Pone `two_fa_method = null`, borra `totp_secret_encrypted`, `totp_last_step`, `recovery_codes` y `email_code_*`. Invalida todas las sesiones y dispositivos de confianza. Registra `2fa_reset` en `audit_log`.

---

## C. Capa de acceso a datos: `lib/dal.ts`

**`getSession(context)`** — `context` indica si se llama desde una página o desde un Route Handler:

1. Lee la cookie `session_token`.
2. Busca `hash(token)` en `sessions`; verifica `expires_at > now` y `last_active_at > now - 8h`.
3. Exige `mfa_verified_at IS NOT NULL` — si null: en página → redirect a `/login/verificacion`; en Route Handler → `Response 401 JSON`.
4. Si `org_id` es null: en página → redirect a `/login/organizacion`; en Route Handler → `Response 401 JSON`.
5. Verifica que el usuario pertenece a esa organización.
6. Renueva `last_active_at` en BD.
7. Devuelve `{ userId, orgId, role }`.

**`getPartialSession()`**: igual pero acepta `mfa_verified_at = null`; exige `created_at > now - 10 min`. Solo para las páginas del flujo de login.

---

## D. Proxy/Middleware

Verificar si Next.js 16 usa `proxy.ts` en lugar de `middleware.ts`. El proxy:
- Excluye de cualquier comprobación: `/v1/*`, `/login*`, `/api/auth/*`, `/_next/*`, `/favicon*` y estáticos.
- Para rutas bajo `/(panel)` sin cookie `session_token`: en página → redirect a `/login`; en `/api/*` → respuesta `401 { error: "no autenticado" }` en JSON.
- No valida el token completo; eso lo hace `lib/dal`.

---

## E. Flujo de autenticación

### Paso 1 — `/login`

`POST /api/auth/login`:
- Si el correo no existe: esperar el mismo tiempo que si la contraseña fuera incorrecta y devolver el mismo mensaje genérico (evitar enumeración de usuarios).
- Bloqueo: 5 intentos fallidos → `password_locked_until = now + 15 min`; registra `lockout`. El 6.º intento devuelve bloqueo incluso con contraseña correcta.
- Éxito: pone `password_attempts = 0`. Comprueba cookie de dispositivo de confianza:
  - Cookie válida y del mismo usuario → crea sesión completa directamente, salta 2FA; redirige al panel (o a `/login/organizacion` si tiene más de una org).
  - Sin cookie válida → crea sesión parcial (sin `mfa_verified_at`, expira en 10 min); redirige a `/login/configurar-2fa` (si `two_fa_method = null`) o a `/login/verificacion`.
- Registra `login_ok` o `login_failed` en `audit_log` con IP y user-agent.

### Paso 2 — `/login/configurar-2fa`

Requiere sesión parcial. Solo en el primer inicio de sesión (cuando `two_fa_method = null`).

- Administradores: solo TOTP (obligatorio).
- Técnicos: pueden elegir TOTP (recomendado) o código por correo.
- **TOTP**: genera secreto con `otpauth`, cifra con AES-256-GCM (`VYLAX_ENCRYPTION_KEY`), guarda cifrado. Muestra QR + clave manual. El usuario introduce el primer código TOTP; al verificarlo se activa: se guarda `two_fa_method = 'totp'`, `totp_verified = true`, `totp_last_step = <step actual>`. Genera 8 códigos de recuperación (mostrar una vez en texto, guardar hashes argon2id).
- **Email**: el usuario elige la opción, se envía el primer código. `two_fa_method = 'email'` se fija solo cuando el usuario verifica ese primer código correctamente en `/login/verificacion`.

### Paso 3 — `/login/verificacion`

Requiere sesión parcial. También se usa en logins posteriores sin dispositivo de confianza.

- **TOTP**: campo de 6 dígitos. Rechaza el código si `step == totp_last_step` (previene replay). Al aceptar, actualiza `totp_last_step`. Límite: 5 intentos por sesión parcial; al superarlo, destruir sesión parcial y registrar `2fa_failed`. También acepta un código de recuperación (límite conjunto de 5 intentos; al usar uno, se borra su hash).
- **Email**: genera código de 6 dígitos, guarda **hash** en BD; caduca en 10 min; un solo uso; máx. 5 intentos; reenvío tras 60 s. En `NODE_ENV=development` sin SMTP → `console.log`. Si era el primer login (configurando 2FA), al verificar correctamente fija `two_fa_method = 'email'`. Mismo límite de 5 intentos.
- Checkbox "Recordar este dispositivo 30 días": crea entrada en `trusted_devices`, envía cookie adicional (httpOnly, Secure, SameSite=Strict, 30 días).
- Éxito: actualiza `mfa_verified_at` en la sesión; registra `2fa_ok`.

### Selección de organización — `/login/organizacion`

Se muestra si `org_id` de la sesión es null (el usuario pertenece a más de una organización).

- `POST /api/auth/org/select`: valida en servidor que el usuario pertenece a la org elegida; actualiza `org_id` en la sesión. Registra `org_changed`.
- Si solo pertenece a una, se asigna automáticamente al crear la sesión completa.

### Cookie de sesión

httpOnly, Secure en producción, SameSite=Strict. Token: 32 bytes aleatorios (`crypto.randomBytes`), guardado como hash SHA-256. Caducidad: 8 h por inactividad. Al cambiar contraseña o reiniciar 2FA: revocar todas las sesiones y dispositivos de confianza del usuario.

**SMTP**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` en `.env`. Librería `nodemailer`.

---

## F. Estructura de rutas (App Router)

```
app/
  (auth)/
    login/
      page.tsx                   ← correo + contraseña
      verificacion/page.tsx      ← 2FA
      configurar-2fa/page.tsx    ← configuración 2FA primer login
      organizacion/page.tsx      ← selección de org (si > 1)
  (panel)/
    layout.tsx                   ← menú lateral + barra superior
    page.tsx                     ← vista general (Server Component)
    clientes/page.tsx            ← (5b)
    equipos/page.tsx             ← (5b)
    pendientes/page.tsx          ← (5b)
    alertas/page.tsx             ← (5b)
    ajustes/page.tsx             ← (5b)
lib/
  dal.ts                         ← getSession(), getPartialSession()
  device-status.ts               ← lógica de estados de equipo
  auth/
    argon2.ts                    ← hash + verify
    totp.ts                      ← generar/verificar TOTP, cifrado AES-256-GCM
    session.ts                   ← crear/destruir sesiones en BD
    email-code.ts                ← generar/enviar/verificar código email
    trusted-device.ts            ← gestión cookie de dispositivo de confianza
  mail.ts                        ← nodemailer + fallback consola
```

---

## G. Layout del panel

**Colores** (de la especificación):
- Fondo: `#0A0F1E` · Tarjetas: `#0F172A` · Bordes: `#1E293B`
- Texto: `#E2E8F0` · Secundario: `#94A3B8` · Acento: `#818CF8`
- Estados: verde `#34D399`, ámbar `#FBBF24`, rojo `#F87171`
- Fuente: Inter

**Menú lateral** — ancho ~220 px, fondo `#0F172A`, borde derecho `#1E293B`:
- Logo + "Vylax" arriba.
- Selector de organización (visible si el usuario pertenece a más de una; cambio valida pertenencia en servidor vía `POST /api/auth/org/select`, registra `org_changed`).
- Ítems con icono SVG + texto: Vista general, Clientes, Equipos, Pendientes de asignar (badge si hay), Alertas.
- Ajustes al fondo.
- Ítem activo: fondo con tinte acento `#818CF8`, texto acento.

**Barra superior** — fondo `#0F172A`, borde inferior `#1E293B`:
- Buscador global (cliente, equipo o IP) → `GET /api/search?q=…`, debounce 300 ms, desplegable agrupado por tipo.
- Icono notificaciones (sin funcionalidad en 5a).
- Avatar con iniciales → menú: nombre/email, cerrar sesión (`POST /api/auth/logout`, destruye sesión, registra `logout`).

---

## H. Vista general — Server Components con `lib/dal`

No hay rutas `/api/dashboard/*`. Los Server Components consultan la BD directamente a través de `lib/dal`, filtrando siempre por `orgId`.

**Estados de equipo** (lógica en `lib/device-status.ts`; se evalúan en este orden):

| Prioridad | Estado | Condición |
|---|---|---|
| 1 | `online` | `last_seen_at < 15 min` (incluye equipos que reportaron tras un resume) |
| 2 | `unreporting` | Superado el umbral sin reportar — servidor/NAS: 10 min · Sobremesa: 3 días · Portátil: 15 días |
| 3 | `suspended` | Último evento es `suspend` Y dentro del umbral del tipo |
| 4 | `offline` | Dentro del umbral, sin evento `suspend` reciente |

Excluidos del recuento principal: `status = 'uninstalled'`. Los `pending_assignment` van en "Pendientes de asignar".

`last_seen_at` en la tabla `devices` se actualiza al procesar cualquier `/v1/reports`. Verificar que el campo ya existe y, si no, añadirlo con una migración sin cambiar el contrato con el agente.

### Componentes de la vista

1. **Resumen** — 4 cifras: Equipos activos, En línea, Sin reportar, Pendientes de asignar. Barra proporcional verde/gris/rojo.

2. **Tarjetas de clientes** — cuadrícula `auto-fill minmax(260px, 1fr)`. Cada tarjeta:
   - Nombre, semáforo provisional, sedes, barra en línea/total, conteo por tipo (servidores / PCs / portátiles).
   - Botón alternar vista lista (estado local, sin servidor).
   - Sin "alertas abiertas" (llega en paso 6). Sin "+ Nuevo cliente" (llega en 5b).

3. **Semáforo provisional** (hasta paso 6):
   - Rojo: algún servidor o NAS en `unreporting`, o algún volumen con `free_pct < 5 %`.
   - Ámbar: cualquier otro equipo en `unreporting`, o algún volumen con `free_pct < 15 %`.
   - Gris: sin equipos.
   - Verde: todo lo demás.

4. **Anillo "Actualizaciones al día"** — SVG inline; porcentaje calculado solo sobre equipos que tienen al menos un informe `daily`. Se excluyen del total los que nunca han enviado uno. `last_installed_at < 45 días` = al día.

5. **Gráfica "En línea · 7 días"** — SVG inline; un punto por día = número de `device_id` distintos que enviaron al menos un informe (metrics o status) ese día.

6. **Discos con menos espacio** — 5 volúmenes con menos espacio libre del último informe `metrics`. Tamaño en GiB (÷ 1 073 741 824) mostrado como "GB". Barra y color: rojo si `free_pct < 5 %`, ámbar si `< 15 %`.

---

## I. API Routes (solo auth y búsqueda)

```
POST /api/auth/login
POST /api/auth/2fa/totp/setup      ← genera secreto y QR
POST /api/auth/2fa/totp/verify     ← verifica primer código y activa
POST /api/auth/2fa/email/send      ← envía código por correo
POST /api/auth/2fa/verify          ← verifica código (TOTP, email o recuperación)
POST /api/auth/org/select          ← asigna org activa a la sesión
POST /api/auth/logout
GET  /api/search?q=…
```

---

## J. Librerías nuevas

| Librería | Para qué |
|---|---|
| `@node-rs/argon2` | Hash de contraseñas y códigos de recuperación |
| `otpauth` | Generación y verificación TOTP |
| `qrcode` | QR para configurar TOTP |
| `nodemailer` | Envío de correos SMTP |
| `crypto.randomBytes` (nativo) | Tokens de sesión y dispositivo |

Sin `iron-session`.

---

## K. Pruebas

### Tests automatizados (Jest o Vitest, en `web/`)

- Bloqueo de contraseña: 5 intentos fallidos → cuenta bloqueada 15 min; 6.º intento devuelve bloqueo incluso con contraseña correcta.
- Mismo mensaje y tiempo si el correo no existe que si la contraseña es incorrecta.
- TOTP: código válido acepta; expirado o incorrecto rechaza; replay (mismo step) rechaza; 5 intentos en sesión parcial → sesión destruida.
- Códigos de recuperación: uso único (el mismo código la segunda vez falla); 5 intentos → sesión parcial destruida.
- Caducidad sesión parcial: sesión creada hace >10 min sin `mfa_verified_at` rechaza; sesión completa inactiva >8 h rechaza.
- Aislamiento de organizaciones: usuario de org A no puede obtener datos de org B aunque se pase `org_id` de B manualmente — `lib/dal` rechaza con 401.
- `npm test` de `/v1/*` sigue pasando sin cambios.

### Comprobaciones manuales (en el sobremesa)

- [ ] Login correcto con TOTP → accede al panel.
- [ ] Login correcto con código por correo → accede al panel.
- [ ] "Recordar dispositivo 30 días" → segundo login no pide 2FA.
- [ ] `npm run user:set-password` → cookie de dispositivo de confianza invalida, debe pedir 2FA en el siguiente login.
- [ ] `npm run user:create` → usuario creado puede entrar.
- [ ] `npm run user:reset-2fa` → debe reconfigurar 2FA en el próximo login.
- [ ] Búsqueda global devuelve cliente y equipo correcto.
- [ ] Cambio de organización en el selector → datos cambian a la nueva org.
- [ ] Vista general muestra semáforo rojo con servidor sin reportar.
- [ ] Volumen con 4 % libre aparece en "Discos con menos espacio" en rojo.
- [ ] Disco de 100 GiB con 10 GiB libres se muestra como "10 GB libres de 100 GB".
- [ ] Equipo que reporta tras `resume` aparece como "En línea".

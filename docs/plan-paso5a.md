# Plan del paso 5a â€” Acceso, estructura y vista general

## A. Base de datos: tablas nuevas y campos

**`users`** (ajustar existente; eliminar `role`):
- `id`, `email` (Ãºnico), `password_hash` (`@node-rs/argon2`)
- `two_fa_method` (`null` | `totp` | `email`) â€” para email, se fija solo tras verificar el primer cÃ³digo
- `totp_verified` (bool)
- `totp_secret_encrypted` (AES-256-GCM, clave en `VYLAX_ENCRYPTION_KEY`)
- `totp_last_step` (entero; paso de tiempo del Ãºltimo cÃ³digo TOTP aceptado, para prevenir replay)
- `recovery_codes` (array de hashes argon2id, 8 cÃ³digos de un solo uso)
- `email_code_hash`, `email_code_expires_at`, `email_code_attempts`
- `password_attempts`, `password_locked_until`
- `created_at`, `updated_at`

**`user_organizations`** â€” relaciÃ³n M:N usuario â†” organizaciÃ³n:
- `user_id`, `org_id`, `role` (`admin` | `technician`)

**`sessions`**:
- `id`, `token_hash` (SHA-256 del token que viaja en la cookie)
- `user_id`, `org_id` (null hasta seleccionar organizaciÃ³n)
- `mfa_verified_at` â€” null = sesiÃ³n parcial (mÃ¡x. 10 min, sin acceso al panel); valor = sesiÃ³n completa
- `last_active_at`, `expires_at`, `created_at`, `ip`, `user_agent`
- Ãndice Ãºnico en `token_hash`

**`trusted_devices`**:
- `id`, `token_hash`, `user_id`, `created_at`, `expires_at`, `user_agent`
- Se invalidan todas al cambiar contraseÃ±a o reiniciar 2FA

**`audit_log`**:
- `id`, `user_id` (nullable), `org_id` (nullable)
- `event`: `login_ok`, `login_failed`, `lockout`, `2fa_ok`, `2fa_failed`, `logout`, `org_changed`, `password_changed`, `2fa_reset`
- `ip`, `user_agent`, `metadata` (JSONB), `created_at`

**`devices`**: verificar que tiene el campo `last_seen_at` y que se actualiza en cada `/v1/reports`. Si no existe, aÃ±adirlo como `TIMESTAMPTZ` actualizado al procesar cualquier informe, sin cambiar el contrato con el agente.

Seed: mantiene la organizaciÃ³n Global-Link; sin usuario ni contraseÃ±a por defecto.

---

## B. Scripts npm

**`npm run user:create`** â€” `web/scripts/user-create.ts`:
Pide por consola correo, contraseÃ±a sin eco y confirmaciÃ³n, organizaciÃ³n y rol. Hashea con `@node-rs/argon2` e inserta en BD con Drizzle.

**`npm run user:set-password <email>`** â€” `web/scripts/user-set-password.ts`:
Pide nueva contraseÃ±a sin eco y confirmaciÃ³n. Hashea con `@node-rs/argon2`, actualiza `password_hash`, pone `password_attempts = 0`, invalida todas las sesiones y dispositivos de confianza del usuario. Registra `password_changed` en `audit_log`. Usar tambiÃ©n para las comprobaciones manuales de "cambio de contraseÃ±a invalida dispositivos de confianza".

**`npm run user:reset-2fa <email>`** â€” `web/scripts/user-reset-2fa.ts`:
Pone `two_fa_method = null`, borra `totp_secret_encrypted`, `totp_last_step`, `recovery_codes` y `email_code_*`. Invalida todas las sesiones y dispositivos de confianza. Registra `2fa_reset` en `audit_log`.

---

## C. Capa de acceso a datos: `lib/dal.ts`

**`getSession(context)`** â€” `context` indica si se llama desde una pÃ¡gina o desde un Route Handler:

1. Lee la cookie `session_token`.
2. Busca `hash(token)` en `sessions`; verifica `expires_at > now` y `last_active_at > now - 8h`.
3. Exige `mfa_verified_at IS NOT NULL` â€” si null: en pÃ¡gina â†’ redirect a `/login/verificacion`; en Route Handler â†’ `Response 401 JSON`.
4. Si `org_id` es null: en pÃ¡gina â†’ redirect a `/login/organizacion`; en Route Handler â†’ `Response 401 JSON`.
5. Verifica que el usuario pertenece a esa organizaciÃ³n.
6. Renueva `last_active_at` en BD.
7. Devuelve `{ userId, orgId, role }`.

**`getPartialSession()`**: igual pero acepta `mfa_verified_at = null`; exige `created_at > now - 10 min`. Solo para las pÃ¡ginas del flujo de login.

---

## D. Proxy/Middleware

Verificar si Next.js 16 usa `proxy.ts` en lugar de `middleware.ts`. El proxy:
- Excluye de cualquier comprobaciÃ³n: `/v1/*`, `/login*`, `/api/auth/*`, `/_next/*`, `/favicon*` y estÃ¡ticos.
- Para rutas bajo `/(panel)` sin cookie `session_token`: en pÃ¡gina â†’ redirect a `/login`; en `/api/*` â†’ respuesta `401 { error: "no autenticado" }` en JSON.
- No valida el token completo; eso lo hace `lib/dal`.

---

## E. Flujo de autenticaciÃ³n

### Paso 1 â€” `/login`

`POST /api/auth/login`:
- Si el correo no existe: esperar el mismo tiempo que si la contraseÃ±a fuera incorrecta y devolver el mismo mensaje genÃ©rico (evitar enumeraciÃ³n de usuarios).
- Bloqueo: 5 intentos fallidos â†’ `password_locked_until = now + 15 min`; registra `lockout`. El 6.Âº intento devuelve bloqueo incluso con contraseÃ±a correcta.
- Ã‰xito: pone `password_attempts = 0`. Comprueba cookie de dispositivo de confianza:
  - Cookie vÃ¡lida y del mismo usuario â†’ crea sesiÃ³n completa directamente, salta 2FA; redirige al panel (o a `/login/organizacion` si tiene mÃ¡s de una org).
  - Sin cookie vÃ¡lida â†’ crea sesiÃ³n parcial (sin `mfa_verified_at`, expira en 10 min); redirige a `/login/configurar-2fa` (si `two_fa_method = null`) o a `/login/verificacion`.
- Registra `login_ok` o `login_failed` en `audit_log` con IP y user-agent.

### Paso 2 â€” `/login/configurar-2fa`

Requiere sesiÃ³n parcial. Solo en el primer inicio de sesiÃ³n (cuando `two_fa_method = null`).

- Administradores: solo TOTP (obligatorio).
- TÃ©cnicos: pueden elegir TOTP (recomendado) o cÃ³digo por correo.
- **TOTP**: genera secreto con `otpauth`, cifra con AES-256-GCM (`VYLAX_ENCRYPTION_KEY`), guarda cifrado. Muestra QR + clave manual. El usuario introduce el primer cÃ³digo TOTP; al verificarlo se activa: se guarda `two_fa_method = 'totp'`, `totp_verified = true`, `totp_last_step = <step actual>`. Genera 8 cÃ³digos de recuperaciÃ³n (mostrar una vez en texto, guardar hashes argon2id).
- **Email**: el usuario elige la opciÃ³n, se envÃ­a el primer cÃ³digo. `two_fa_method = 'email'` se fija solo cuando el usuario verifica ese primer cÃ³digo correctamente en `/login/verificacion`.

### Paso 3 â€” `/login/verificacion`

Requiere sesiÃ³n parcial. TambiÃ©n se usa en logins posteriores sin dispositivo de confianza.

- **TOTP**: campo de 6 dÃ­gitos. Rechaza el cÃ³digo si `step == totp_last_step` (previene replay). Al aceptar, actualiza `totp_last_step`. LÃ­mite: 5 intentos por sesiÃ³n parcial; al superarlo, destruir sesiÃ³n parcial y registrar `2fa_failed`. TambiÃ©n acepta un cÃ³digo de recuperaciÃ³n (lÃ­mite conjunto de 5 intentos; al usar uno, se borra su hash).
- **Email**: genera cÃ³digo de 6 dÃ­gitos, guarda **hash** en BD; caduca en 10 min; un solo uso; mÃ¡x. 5 intentos; reenvÃ­o tras 60 s. En `NODE_ENV=development` sin SMTP â†’ `console.log`. Si era el primer login (configurando 2FA), al verificar correctamente fija `two_fa_method = 'email'`. Mismo lÃ­mite de 5 intentos.
- Checkbox "Recordar este dispositivo 30 dÃ­as": crea entrada en `trusted_devices`, envÃ­a cookie adicional (httpOnly, Secure, SameSite=Strict, 30 dÃ­as).
- Ã‰xito: actualiza `mfa_verified_at` en la sesiÃ³n; registra `2fa_ok`.

### SelecciÃ³n de organizaciÃ³n â€” `/login/organizacion`

Se muestra si `org_id` de la sesiÃ³n es null (el usuario pertenece a mÃ¡s de una organizaciÃ³n).

- `POST /api/auth/org/select`: valida en servidor que el usuario pertenece a la org elegida; actualiza `org_id` en la sesiÃ³n. Registra `org_changed`.
- Si solo pertenece a una, se asigna automÃ¡ticamente al crear la sesiÃ³n completa.

### Cookie de sesiÃ³n

httpOnly, Secure en producciÃ³n, SameSite=Strict. Token: 32 bytes aleatorios (`crypto.randomBytes`), guardado como hash SHA-256. Caducidad: 8 h por inactividad. Al cambiar contraseÃ±a o reiniciar 2FA: revocar todas las sesiones y dispositivos de confianza del usuario.

**SMTP**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` en `.env`. LibrerÃ­a `nodemailer`.

---

## F. Estructura de rutas (App Router)

```
app/
  (auth)/
    login/
      page.tsx                   â† correo + contraseÃ±a
      verificacion/page.tsx      â† 2FA
      configurar-2fa/page.tsx    â† configuraciÃ³n 2FA primer login
      organizacion/page.tsx      â† selecciÃ³n de org (si > 1)
  (panel)/
    layout.tsx                   â† menÃº lateral + barra superior
    page.tsx                     â† vista general (Server Component)
    clientes/page.tsx            â† (5b)
    equipos/page.tsx             â† (5b)
    pendientes/page.tsx          â† (5b)
    alertas/page.tsx             â† (5b)
    ajustes/page.tsx             â† (5b)
lib/
  dal.ts                         â† getSession(), getPartialSession()
  device-status.ts               â† lÃ³gica de estados de equipo
  auth/
    argon2.ts                    â† hash + verify
    totp.ts                      â† generar/verificar TOTP, cifrado AES-256-GCM
    session.ts                   â† crear/destruir sesiones en BD
    email-code.ts                â† generar/enviar/verificar cÃ³digo email
    trusted-device.ts            â† gestiÃ³n cookie de dispositivo de confianza
  mail.ts                        â† nodemailer + fallback consola
```

---

## G. Layout del panel

**Colores** (de la especificaciÃ³n):
- Fondo: `#0A0F1E` Â· Tarjetas: `#0F172A` Â· Bordes: `#1E293B`
- Texto: `#E2E8F0` Â· Secundario: `#94A3B8` Â· Acento: `#818CF8`
- Estados: verde `#34D399`, Ã¡mbar `#FBBF24`, rojo `#F87171`
- Fuente: Inter

**MenÃº lateral** â€” ancho ~220 px, fondo `#0F172A`, borde derecho `#1E293B`:
- Logo + "Guaitiq" arriba.
- Selector de organizaciÃ³n (visible si el usuario pertenece a mÃ¡s de una; cambio valida pertenencia en servidor vÃ­a `POST /api/auth/org/select`, registra `org_changed`).
- Ãtems con icono SVG + texto: Vista general, Clientes, Equipos, Pendientes de asignar (badge si hay), Alertas.
- Ajustes al fondo.
- Ãtem activo: fondo con tinte acento `#818CF8`, texto acento.

**Barra superior** â€” fondo `#0F172A`, borde inferior `#1E293B`:
- Buscador global (cliente, equipo o IP) â†’ `GET /api/search?q=â€¦`, debounce 300 ms, desplegable agrupado por tipo.
- Icono notificaciones (sin funcionalidad en 5a).
- Avatar con iniciales â†’ menÃº: nombre/email, cerrar sesiÃ³n (`POST /api/auth/logout`, destruye sesiÃ³n, registra `logout`).

---

## H. Vista general â€” Server Components con `lib/dal`

No hay rutas `/api/dashboard/*`. Los Server Components consultan la BD directamente a travÃ©s de `lib/dal`, filtrando siempre por `orgId`.

**Estados de equipo** (lÃ³gica en `lib/device-status.ts`; se evalÃºan en este orden):

| Prioridad | Estado | CondiciÃ³n |
|---|---|---|
| 1 | `online` | `last_seen_at < 15 min` (incluye equipos que reportaron tras un resume) |
| 2 | `unreporting` | Superado el umbral sin reportar â€” servidor/NAS: 10 min Â· Sobremesa: 3 dÃ­as Â· PortÃ¡til: 15 dÃ­as |
| 3 | `suspended` | Ãšltimo evento es `suspend` Y dentro del umbral del tipo |
| 4 | `offline` | Dentro del umbral, sin evento `suspend` reciente |

Excluidos del recuento principal: `status = 'uninstalled'`. Los `pending_assignment` van en "Pendientes de asignar".

`last_seen_at` en la tabla `devices` se actualiza al procesar cualquier `/v1/reports`. Verificar que el campo ya existe y, si no, aÃ±adirlo con una migraciÃ³n sin cambiar el contrato con el agente.

### Componentes de la vista

1. **Resumen** â€” 4 cifras: Equipos activos, En lÃ­nea, Sin reportar, Pendientes de asignar. Barra proporcional verde/gris/rojo.

2. **Tarjetas de clientes** â€” cuadrÃ­cula `auto-fill minmax(260px, 1fr)`. Cada tarjeta:
   - Nombre, semÃ¡foro provisional, sedes, barra en lÃ­nea/total, conteo por tipo (servidores / PCs / portÃ¡tiles).
   - BotÃ³n alternar vista lista (estado local, sin servidor).
   - Sin "alertas abiertas" (llega en paso 6). Sin "+ Nuevo cliente" (llega en 5b).

3. **SemÃ¡foro provisional** (hasta paso 6):
   - Rojo: algÃºn servidor o NAS en `unreporting`, o algÃºn volumen con `free_pct < 5 %`.
   - Ãmbar: cualquier otro equipo en `unreporting`, o algÃºn volumen con `free_pct < 15 %`.
   - Gris: sin equipos.
   - Verde: todo lo demÃ¡s.

4. **Anillo "Actualizaciones al dÃ­a"** â€” SVG inline; porcentaje calculado solo sobre equipos que tienen al menos un informe `daily`. Se excluyen del total los que nunca han enviado uno. `last_installed_at < 45 dÃ­as` = al dÃ­a.

5. **GrÃ¡fica "En lÃ­nea Â· 7 dÃ­as"** â€” SVG inline; un punto por dÃ­a = nÃºmero de `device_id` distintos que enviaron al menos un informe (metrics o status) ese dÃ­a.

6. **Discos con menos espacio** â€” 5 volÃºmenes con menos espacio libre del Ãºltimo informe `metrics`. TamaÃ±o en GiB (Ã· 1 073 741 824) mostrado como "GB". Barra y color: rojo si `free_pct < 5 %`, Ã¡mbar si `< 15 %`.

---

## I. API Routes (solo auth y bÃºsqueda)

```
POST /api/auth/login
POST /api/auth/2fa/totp/setup      â† genera secreto y QR
POST /api/auth/2fa/totp/verify     â† verifica primer cÃ³digo y activa
POST /api/auth/2fa/email/send      â† envÃ­a cÃ³digo por correo
POST /api/auth/2fa/verify          â† verifica cÃ³digo (TOTP, email o recuperaciÃ³n)
POST /api/auth/org/select          â† asigna org activa a la sesiÃ³n
POST /api/auth/logout
GET  /api/search?q=â€¦
```

---

## J. LibrerÃ­as nuevas

| LibrerÃ­a | Para quÃ© |
|---|---|
| `@node-rs/argon2` | Hash de contraseÃ±as y cÃ³digos de recuperaciÃ³n |
| `otpauth` | GeneraciÃ³n y verificaciÃ³n TOTP |
| `qrcode` | QR para configurar TOTP |
| `nodemailer` | EnvÃ­o de correos SMTP |
| `crypto.randomBytes` (nativo) | Tokens de sesiÃ³n y dispositivo |

Sin `iron-session`.

---

## K. Pruebas

### Tests automatizados (Jest o Vitest, en `web/`)

- Bloqueo de contraseÃ±a: 5 intentos fallidos â†’ cuenta bloqueada 15 min; 6.Âº intento devuelve bloqueo incluso con contraseÃ±a correcta.
- Mismo mensaje y tiempo si el correo no existe que si la contraseÃ±a es incorrecta.
- TOTP: cÃ³digo vÃ¡lido acepta; expirado o incorrecto rechaza; replay (mismo step) rechaza; 5 intentos en sesiÃ³n parcial â†’ sesiÃ³n destruida.
- CÃ³digos de recuperaciÃ³n: uso Ãºnico (el mismo cÃ³digo la segunda vez falla); 5 intentos â†’ sesiÃ³n parcial destruida.
- Caducidad sesiÃ³n parcial: sesiÃ³n creada hace >10 min sin `mfa_verified_at` rechaza; sesiÃ³n completa inactiva >8 h rechaza.
- Aislamiento de organizaciones: usuario de org A no puede obtener datos de org B aunque se pase `org_id` de B manualmente â€” `lib/dal` rechaza con 401.
- `npm test` de `/v1/*` sigue pasando sin cambios.

### Comprobaciones manuales (en el sobremesa)

- [ ] Login correcto con TOTP â†’ accede al panel.
- [ ] Login correcto con cÃ³digo por correo â†’ accede al panel.
- [ ] "Recordar dispositivo 30 dÃ­as" â†’ segundo login no pide 2FA.
- [ ] `npm run user:set-password` â†’ cookie de dispositivo de confianza invalida, debe pedir 2FA en el siguiente login.
- [ ] `npm run user:create` â†’ usuario creado puede entrar.
- [ ] `npm run user:reset-2fa` â†’ debe reconfigurar 2FA en el prÃ³ximo login.
- [ ] BÃºsqueda global devuelve cliente y equipo correcto.
- [ ] Cambio de organizaciÃ³n en el selector â†’ datos cambian a la nueva org.
- [ ] Vista general muestra semÃ¡foro rojo con servidor sin reportar.
- [ ] Volumen con 4 % libre aparece en "Discos con menos espacio" en rojo.
- [ ] Disco de 100 GiB con 10 GiB libres se muestra como "10 GB libres de 100 GB".
- [ ] Equipo que reporta tras `resume` aparece como "En lÃ­nea".


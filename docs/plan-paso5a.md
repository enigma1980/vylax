# Plan – Paso 5a: autenticación, sesión y organización activa

> **Alcance:** Sistema completo de login con 2FA, middleware de protección de rutas, helper
> `getSession`, selección de organización activa, script de administración de contraseñas y dos
> ajustes menores en `/v1/reports`. El panel propiamente dicho (vistas de equipos, clientes y
> sedes) se abordará en el paso 5b.

---

## A. Cambios en el esquema (migración)

### Tabla `users` — campos nuevos

| Campo | Tipo | Por qué |
|---|---|---|
| `two_fa_method` | `text \| null` (`'totp'` \| `'email'`) | Método de segundo factor activo; `null` = solo contraseña |
| `totp_last_step` | `bigint \| null` | Step TOTP del último código aceptado; evita reutilizar el mismo código TOTP |
| `email_otp_hash` | `text \| null` | Hash SHA-256 del OTP enviado por correo |
| `email_otp_expires_at` | `timestamptz \| null` | Caducidad del OTP por correo (10 min) |
| `password_attempts` | `integer` default `0` | Intentos fallidos consecutivos |
| `locked_until` | `timestamptz \| null` | Si no es null, el login está bloqueado hasta esa hora |

### Tabla `device_current_state` — campo nuevo

| Campo | Tipo | Por qué |
|---|---|---|
| `last_seen_at` | `timestamptz \| null` | Momento del último POST /v1/reports; sirve para calcular "online" |

### Acciones

1. Añadir los campos a `web/src/db/schema.ts`.
2. `npm run db:generate` → nueva migración SQL.
3. `npm run db:migrate` → aplicar.

---

## B. Dependencias nuevas

```
npm install iron-session bcryptjs otplib nodemailer
npm install -D @types/bcryptjs @types/nodemailer
```

| Paquete | Uso |
|---|---|
| `iron-session` | Cookie de sesión cifrada (sin base de datos, sin JWT externo) |
| `bcryptjs` | Hash de contraseñas (coste 12) |
| `otplib` | Generación y verificación de TOTP |
| `nodemailer` | Envío del OTP por correo |

Variables de entorno nuevas en `.env.local` (y en la plantilla `.env.example`):

```
SESSION_SECRET=<32 chars aleatorios>
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Vylax <noreply@vylax.app>"
```

---

## C. Middleware (`web/src/middleware.ts`)

El middleware de Next.js se ejecuta en el edge antes de cada ruta.

**Rutas excluidas (pasan sin comprobación):**

- `/api/auth/*` — el sistema de login/logout en sí, no puede protegerse a sí mismo
- `/api/v1/*` — API del agente, se autentica con Bearer token propio
- `/login`, `/login/organizacion` — páginas públicas
- `/_next/*`, `/favicon.ico`, archivos estáticos

**Para rutas `/api/*` no excluidas:** si no hay sesión válida → `401 { "error": "no autenticado" }`.

**Para páginas:** si no hay sesión → redirigir a `/login`; si hay sesión pero `org_id` es `null` → redirigir a `/login/organizacion`.

```ts
// Esqueleto
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();
  const session = getIronSession(request, ...);
  if (!session.userId) {
    if (pathname.startsWith('/api/')) return new Response('{"error":"no autenticado"}', { status: 401 });
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (!session.orgId && !pathname.startsWith('/api/')) {
    return NextResponse.redirect(new URL('/login/organizacion', request.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
```

---

## D. Helper `getSession`

Archivo: `web/src/lib/session.ts`

Dos funciones para uso interno en Route Handlers y Server Components:

```ts
// En páginas/Server Components: lanza redirect si no autenticado
export async function requirePageSession(): Promise<SessionData>

// En Route Handlers de API protegidas: devuelve { status: 401 } si no autenticado
export async function requireApiSession(req: Request): Promise<SessionData | Response>
```

`SessionData`:

```ts
interface SessionData {
  userId: string;
  email: string;
  orgId: string | null;   // null hasta que el usuario elige organización
  role: 'admin' | 'tech';
  isPlatformAdmin: boolean;
  step: 'password_ok' | 'done'; // 'password_ok' = pendiente de 2FA
}
```

Comportamiento de `requirePageSession`:
- Si `step === 'password_ok'` → redirigir a `/login/verify-2fa`
- Si `orgId === null` → redirigir a `/login/organizacion`

---

## E. Flujo de login — contraseña

**Endpoint:** `POST /api/auth/login`  
**Body:** `{ email: string, password: string }`

Pasos del handler:

1. Buscar el usuario por email.  
   Si no existe → **mismo mensaje y mismo tiempo de respuesta** que si la contraseña es incorrecta  
   (evita enumeración de usuarios). Usar `bcrypt.compare` contra un hash ficticio para igualar el tiempo.

2. Comprobar `locked_until`: si está en el futuro → `429 { "error": "cuenta bloqueada", "until": "..." }`.

3. Comparar contraseña con `bcrypt.compare`.  
   - Si falla: `password_attempts += 1`; si `≥ 5` → `locked_until = NOW() + 15 min`; responder `401`.  
   - Si ok: `password_attempts = 0`; `locked_until = null`.

4. Crear sesión parcial `{ userId, email, step: 'password_ok', orgId: null, ... }`.

5. Responder `200 { "next": "totp" | "email_otp" | "none" }` según `two_fa_method`.  
   Si `"none"`, promover la sesión a `step: 'done'` antes de responder.

---

## F. Verificación del segundo factor

### TOTP

**Endpoint:** `POST /api/auth/verify-2fa`  
**Body:** `{ code: string }` (6 dígitos)

1. Verificar `session.step === 'password_ok'`.
2. Obtener `totp_secret` del usuario.
3. `otplib.authenticator.verify({ token: code, secret })`.
4. Calcular `currentStep = Math.floor(Date.now() / 30000)`.  
   Si `currentStep === totp_last_step` → `401 { "error": "código ya utilizado" }` (anti-replay).
5. Si ok: guardar `totp_last_step = currentStep`; promover sesión a `step: 'done'`.

### OTP por correo

1. `POST /api/auth/send-email-otp` — genera 6 dígitos, guarda `hash(code)` y `expires_at = NOW() + 10 min`, envía el correo.
2. `POST /api/auth/verify-2fa` con `{ code }` — compara `hash(code)` con `email_otp_hash` y verifica `expires_at`.

### Activación de `two_fa_method = 'email'`

Solo se puede establecer `two_fa_method = 'email'` **después de que el usuario haya verificado con éxito un OTP de prueba enviado a su correo**. Flujo:

1. Admin llama a `POST /api/auth/setup-email-2fa` → se envía OTP de prueba.
2. Admin introduce el código → `POST /api/auth/confirm-email-2fa`.
3. Solo si el código es correcto se guarda `two_fa_method = 'email'`.

Esto evita que un error de configuración de correo deje al usuario sin poder entrar.

---

## G. Gestión de sesión y organización activa

### Página `/login/organizacion`

- Consultar `organization_memberships` del usuario.
- Si pertenece a **una sola organización**: redirigir directamente a `/panel` (guardar `orgId` en sesión automáticamente).
- Si pertenece a **varias**: mostrar lista; el usuario elige.

### Endpoint `POST /api/auth/set-org`

```ts
// Body: { orgId: string }
// Verifica que el usuario pertenece a esa org; guarda orgId en la sesión.
```

---

## H. Script `user:set-password`

Archivo: `web/scripts/set-password.ts`  
Acceso: `npm run user:set-password -- correo@ejemplo.com`

Comportamiento:

1. Leer el correo como argumento de línea de comandos.
2. Pedir la nueva contraseña **dos veces por stdin sin eco** (con `readline` en modo `mute`, o la librería `read`).
3. Verificar que las dos entradas coinciden.
4. Generar hash con `bcrypt` (coste 12).
5. Actualizar `password_hash` en la base de datos.
6. Resetear `password_attempts = 0` y `locked_until = null`.
7. Confirmar por consola: `Contraseña actualizada para <correo>`.

**Las contraseñas nunca se muestran por pantalla** (ni al escribirlas ni en ningún log).

---

## I. `last_seen_at` y estado "online" en `/v1/reports`

### `last_seen_at`

Al inicio de `POST /v1/reports/route.ts`, **antes de procesar los informes**, ejecutar:

```sql
UPDATE device_current_state
SET last_seen_at = NOW(), updated_at = NOW()
WHERE device_id = $deviceId
```

Así `last_seen_at` siempre refleja el último contacto real con el servidor,
independientemente de qué tipo de informe traiga el sobre.

### Evaluación de "online"

La función que calcula el estado del dispositivo (para el panel y el semáforo) debe **evaluar "online" primero**, antes de cualquier otra comprobación de alertas:

```ts
function computeOnline(lastSeenAt: Date | null, deviceType: string): boolean {
  if (!lastSeenAt) return false;
  const thresholds = { server: 10, pc: 180, laptop: 900 }; // minutos
  const mins = thresholds[deviceType] ?? 180;
  return (Date.now() - lastSeenAt.getTime()) < mins * 60_000;
}
```

Si `online === false` → el estado es `offline` directamente, sin evaluar el resto de métricas.

---

## J. Anillo/gráfico circular sin dispositivos

El componente de anillo (donut chart de salud de un cliente o sede) **no se renderiza ni solicita datos al servidor** si la consulta de dispositivos activos devuelve cero resultados. En su lugar se muestra:

```
Sin dispositivos activos
```

Esto aplica también al proceso que genera el informe diario del anillo: **si no hay dispositivos, no se programa ni se ejecuta**. Evita divisiones por cero y gráficos vacíos.

---

## K. Comprobaciones manuales

Una vez implementado el paso 5a, verificar de arriba a abajo:

**Middleware y protección de rutas**
- [ ] `GET /api/datos-protegidos` sin cookie → responde `401`, no redirige
- [ ] `GET /panel` sin cookie → redirige a `/login`
- [ ] `GET /login` sin cookie → carga la página sin bucle de redirección
- [ ] `POST /api/auth/login` sin cookie → no da 401 (ruta excluida del middleware)
- [ ] `POST /v1/reports` con Bearer válido → no da 401 (ruta excluida del middleware)

**Login con contraseña**
- [ ] Correo inexistente → mismo mensaje que contraseña incorrecta, tiempo de respuesta similar
- [ ] Contraseña incorrecta × 5 → la cuenta se bloquea; los siguientes intentos devuelven `429`
- [ ] Login correcto → `password_attempts` vuelve a 0
- [ ] Contraseña correcta durante bloqueo activo → sigue dando `429`

**Segundo factor TOTP**
- [ ] Código TOTP válido → sesión promovida a `step: done`
- [ ] Mismo código TOTP dos veces seguidas → segunda vez devuelve `401 "código ya utilizado"` (`totp_last_step`)
- [ ] Código expirado → `401`

**Segundo factor por correo**
- [ ] OTP llegado al correo → se acepta y sesión queda `done`
- [ ] OTP caducado (> 10 min) → `401`
- [ ] `two_fa_method = 'email'` solo se activa si el usuario verifica un OTP de prueba

**`getSession` según contexto**
- [ ] Server Component sin sesión → redirige a `/login`
- [ ] Route Handler sin sesión → devuelve `401`
- [ ] Sesión con `orgId = null` en página → redirige a `/login/organizacion`
- [ ] Sesión con `orgId = null` en API → devuelve `401`

**Selección de organización**
- [ ] Usuario con 1 org → va directamente al panel sin pasar por la lista
- [ ] Usuario con varias orgs → ve la lista y al elegir queda `orgId` guardado en sesión

**Script `user:set-password`**
- [ ] La contraseña no aparece en pantalla al escribirla
- [ ] La contraseña no aparece en pantalla al confirmarla
- [ ] Si las dos entradas no coinciden → error sin actualizar la BD
- [ ] Tras ejecutarse: el usuario puede iniciar sesión con la contraseña nueva
- [ ] `password_attempts` y `locked_until` quedan a 0 / null

**`last_seen_at` y "online"**
- [ ] Un POST a `/v1/reports` actualiza `last_seen_at` aunque los informes fallen validación
- [ ] Dispositivo con `last_seen_at` reciente → aparece como "online" en el panel
- [ ] Dispositivo con `last_seen_at` antiguo → aparece como "offline" sin evaluar alertas de métricas

**Anillo sin dispositivos**
- [ ] Cliente sin dispositivos activos → el panel muestra "Sin dispositivos activos", no un gráfico vacío ni un error
- [ ] El proceso de informe diario de anillo no se ejecuta para clientes sin dispositivos

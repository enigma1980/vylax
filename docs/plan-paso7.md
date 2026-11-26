# Plan del paso 7 — Instalador MSI del agente

## A. Herramienta: WiX Toolset v4

### Versión y licencia

**WiX Toolset v4** (última estable: 4.0.x, en activo desarrollo).

Licencia: **MS-RL** (Microsoft Reciprocal License) para los binarios del toolset y **Apache 2.0** para los nuevos módulos.
Ambas son licencias de código abierto; la MS-RL es *file-level copyleft*, lo que significa:
- Si modificas los fuentes de WiX, debes publicar esos cambios.
- Tus propios archivos `.wxs`, el `.msi` generado y el producto final son **enteramente tuyos** con la licencia que quieras.
- **Coste: cero**, sin restricciones por número de instalaciones ni por venta del producto.

WiX v3 (alternativa más antigua) también es gratuito, pero su instalación es manual y su CLI obsoleta. Se elige v4 porque es el estándar actual y su CLI (`wix build`) es más limpia.

### Requisitos en el sobremesa de desarrollo

| Herramienta | Dónde conseguirla |
|---|---|
| **.NET 8 SDK** | <https://dotnet.microsoft.com/download> |
| **WiX v4** (global tool) | `dotnet tool install --global wix` |
| **Go 1.22+** | ya instalado |

Verificar: `wix --version` → debe mostrar `4.x.y`.

---

## B. Estructura del repositorio

```
installer/
  guaitiq-agent.wxs      Definición del paquete MSI
  build.ps1            Script de build (compila el .exe y genera el .msi)
web/
  public/
    agent/
      guaitiq-agent.msi  MSI resultante, servido estáticamente por Next.js
```

---

## C. Decisiones (cerradas 26/11/2026)

1. **`SERVER` sin valor por defecto.** El MSI siempre requiere `SERVER` como parámetro. El panel lo añade automáticamente al comando de instalación con su propia URL pública, junto al TOKEN.
   Comando resultante: `msiexec /i guaitiq-agent.msi TOKEN=xxx SERVER=https://Guaitiq.empresa.com /qn`

2. **Opción A — MSI único + comando de instalación.** Añadir un botón "Descargar instalador (MSI)" junto a "Copiar comando de instalación" en tres puntos de la UI: pestaña Tokens de alta del cliente, modal "+ Añadir equipo" y página `/pendientes`.

3. **Versión 0.1.0** para las pruebas iniciales.

---

## D. Descripción técnica del MSI

### Propiedades y flags

```xml
<Property Id="TOKEN" Hidden="yes" />    <!-- oculto en logs de msiexec -->
<Property Id="SERVER" Value="http://192.168.1.51:3000" />  <!-- ajustar en prod -->
```

`Hidden="yes"` impide que el valor de TOKEN aparezca en los logs de `msiexec /l*v`. El valor se pasa a las custom actions mediante `CustomActionData`; en ese canal tampoco se registra si se marca con `HideTarget="yes"`.

### Directorios

```
C:\Program Files\Guaitiq\
  guaitiq-agent.exe          → componente principal
C:\ProgramData\Guaitiq\      → NO creado por el MSI; lo crea el agente en enroll
                              (así sobrevive a las desinstalaciones y conserva historial)
```

### Servicio de Windows

El MSI **no** usa los elementos WiX `<ServiceInstall>`/`<ServiceControl>` para el servicio, porque ya tenemos el código Go testeado que configura el inicio retrasado, la recuperación y el preshutdown timeout. En su lugar, usa custom actions que llaman a los subcomandos existentes del agente:

```
guaitiq-agent.exe service install    → crea el servicio con toda la config
guaitiq-agent.exe service start      → lo arranca
guaitiq-agent.exe service stop       → lo detiene (en desinstalación)
guaitiq-agent.exe service uninstall  → lo elimina
```

### Secuencia de instalación

```
1. InstallFiles                  → copia guaitiq-agent.exe a Program Files\Guaitiq\
2. CA_ServiceInstall (deferred)  → guaitiq-agent.exe service install
3. CA_Enroll        (deferred)   → guaitiq-agent.exe enroll --server [SERVER] --token [TOKEN]
                                    (token oculto con HideTarget="yes")
4. CA_ServiceStart  (deferred)   → guaitiq-agent.exe service start
```

Si el equipo ya tiene credencial (reinstalación): `enroll` sin `--force` detecta el caso y sale con código de error; el MSI necesita `--force` explícito. Para el flujo normal de reinstalación (misma versión) se pasa `--force` siempre desde la CA — el servidor reconoce el SMBIOS UUID, limpia la credencial revocada y conserva el historial.

### Secuencia de desinstalación (desinstalación manual)

```
1. CA_NotifyUninstall (deferred) → guaitiq-agent.exe notify-uninstall --reason manual
2. CA_ServiceStop     (deferred) → guaitiq-agent.exe service stop
3. CA_ServiceUninstall(deferred) → guaitiq-agent.exe service uninstall
4. RemoveFiles                   → borra guaitiq-agent.exe de Program Files\Guaitiq\
   C:\ProgramData\Guaitiq\ NO se borra → el historial y config sobreviven
```

### Actualización (versión nueva del MSI)

WiX usa `<MajorUpgrade>` para detectar que ya hay una versión anterior. La secuencia es:

```
1. CA_NotifyUninstall → guaitiq-agent.exe notify-uninstall --reason upgrade
   (el agente escribe un marcador de actualización; al arrancar de nuevo lo elimina)
2. Desinstalación de la versión antigua (incluye stop + service uninstall)
3. Instalación de la versión nueva (steps 1–4 de arriba)
   El marcador "upgrade" evita que el servidor genere una alerta de desinstalación.
```

---

## E. Instalación silenciosa (Intune / scripts)

```powershell
# Instalación silenciosa — Intune, PDQ, scripts de despliegue
msiexec /i guaitiq-agent.msi TOKEN=<token> /qn

# Con servidor explícito
msiexec /i guaitiq-agent.msi TOKEN=<token> SERVER=https://Guaitiq.empresa.com /qn

# Log de instalación (el TOKEN no aparece en el log)
msiexec /i guaitiq-agent.msi TOKEN=<token> /qn /l*v C:\Temp\Guaitiq-install.log
```

La propiedad `TOKEN` marcada como `Hidden` no aparece en ningún nivel de log de msiexec.

---

## F. Panel: botón "Descargar agente" — opciones y recomendación

### Opción A — MSI único + comando de instalación (recomendada)

El panel muestra:
1. Un enlace de descarga al MSI estático (`/agent/guaitiq-agent.msi`).
2. El comando de instalación preconfigurado con el token del cliente (o del token general), listo para copiar.

```
msiexec /i guaitiq-agent.msi TOKEN=vylx_abc123def456 /qn
```

**Pros:**
- Un único binario para todos los clientes; solo se descarga y actualiza una vez.
- El token NO queda embebido en ningún archivo descargable: el admin copia el comando y lo ejecuta.
- Compatible directamente con Intune, Ninja, PDQ.
- Sin código de generación dinámica en el servidor.

**Contras:**
- El técnico tiene que abrir un terminal para pegarlo (no es un doble-clic).
- Si el servidor Next.js está en `localhost:3000` durante las pruebas, el comando incluye esa URL y el técnico tiene que cambiarla.

### Opción B — Archivo `.cmd` con token incrustado

El panel genera un archivo `.cmd` firmado con el token incluido que el técnico descarga y ejecuta con doble-clic.

**Pros:** Experiencia de un clic; sin terminal.

**Contras:**
- El token queda en texto plano en el `.cmd` descargado (riesgo si el archivo se comparte o queda en Descargas).
- Si el token se regenera, el `.cmd` descargado queda inútil.
- Generación dinámica de archivos en el servidor (más complejidad).
- Los antivirus (y SmartScreen) suelen ser más agresivos con `.cmd` desconocidos que con un MSI.

### Opción C — MSI precompilado con token incrustado (descartada)

Generar un MSI diferente por cada token es costoso en tiempo de build y almacenamiento. Descartada.

**Decisión recomendada: Opción A.** La UX actual ya muestra "Copiar comando de instalación" en la sección de tokens — es el flujo natural. Solo hay que añadir el enlace de descarga del MSI junto al comando.

---

## G. Build en el sobremesa

### Archivo `installer/build.ps1`

```powershell
# 1. Compilar el agente (Windows AMD64, sin consola de debug)
Set-Location "$PSScriptRoot\..\agent"
$env:GOOS = "windows"; $env:GOARCH = "amd64"
go build -o "..\installer\bin\guaitiq-agent.exe" .

# 2. Generar el MSI
Set-Location "$PSScriptRoot"
wix build guaitiq-agent.wxs `
    -arch x64 `
    -out bin\guaitiq-agent.msi

# 3. Copiar al panel
Copy-Item bin\guaitiq-agent.msi ..\web\public\agent\guaitiq-agent.msi -Force
Write-Host "✅  guaitiq-agent.msi generado y copiado a web/public/agent/"
```

Ejecutar desde PowerShell (admin no necesario para el build; sí para las pruebas de instalación):
```powershell
.\installer\build.ps1
```

---

## H. Equipo sin firmar: SmartScreen y ESET

### SmartScreen (Windows Defender)

Sin firma de código (Authenticode), Windows muestra:
- En la descarga del MSI desde un navegador: diálogo "Windows protegió tu PC".
- Al ejecutar el MSI: el instalador puede bloquearse con `Error 1603` en algunas configuraciones.

**Soluciones para las pruebas:**
1. Clic derecho sobre el MSI descargado → Propiedades → "Desbloquear" (tick de seguridad).
2. Bajar el MSI en lugar de abrirlo desde el navegador (evita la marca de zona).
3. En la VM de pruebas: desactivar SmartScreen temporalmente (Configuración → Windows Security → App & browser control → Reputation-based protection → "Check apps and files" → Off).

**Para producción:** firmado con un certificado de Code Signing (OV, aprox. 150-400 €/año). Decisión a tomar cuando se vaya a distribuir a clientes reales.

### ESET PROTECT (exclusiones)

Para evitar que ESET bloquee la instalación o el agente en los equipos gestionados, configurar en ESET PROTECT Server → Políticas → Exclusiones:

| Tipo | Valor |
|---|---|
| Ruta | `C:\Program Files\Guaitiq\*` |
| Ruta | `C:\ProgramData\Guaitiq\*` |
| Archivo ejecutable | `guaitiq-agent.exe` |

En la máquina de pruebas local (ESET instalado), añadir la misma exclusión en ESET Security → Configuración → Exclusiones antes de instalar.

---

## I. Pruebas

### Escenario 1 — VM o segundo PC de la red

El servidor corre en el sobremesa (`192.168.1.51:3000`). El agente acepta HTTP en desarrollo; basta con:
```
msiexec /i guaitiq-agent.msi TOKEN=<token_org> SERVER=http://192.168.1.51:3000 /qn
```

Pasos:
1. Copiar el MSI a la VM o segundo PC (carpeta compartida, USB o desde `\\192.168.1.51\...`).
2. Ejecutar el comando de instalación silenciosa.
3. Verificar que el equipo aparece en `/pendientes` del panel.
4. Asignarlo a un cliente desde el panel.
5. Verificar métricas en `/clientes/[clientId]` a los 5 minutos.

### Escenario 2 — Re-registrar el agente del sobremesa

La base de datos se reinició en el paso 5a y la credencial del agente ya no es válida. El agente recibirá 401 en cada envío. Para re-registrarlo:

```powershell
# 1. Detener el servicio actual (si está corriendo)
.\guaitiq-agent.exe service stop

# 2. Re-enroll con --force (sobrescribe la credencial sin borrar el historial)
.\guaitiq-agent.exe enroll --server http://localhost:3000 --token <token_de_la_nueva_bd> --force

# 3. Arrancar el servicio
.\guaitiq-agent.exe service start
```

Alternativamente, desinstalar con el MSI y reinstalar: el flujo de reinstalación usa `--force` automáticamente y `C:\ProgramData\Guaitiq\` se conserva (el SMBIOS UUID coincide → el servidor une el nuevo enrollment con el historial existente si se implementa reenroll en el paso 5b).

---

## J. Partes del paso 7 (implementación)

| Parte | Contenido | Notas |
|---|---|---|
| **1** | Entorno: instalar .NET 8 SDK + WiX v4. Crear `installer/`. Compilar el agente en modo release. | Manual (tú en el sobremesa) |
| **2** | `guaitiq-agent.wxs`: estructura base, directorios, componente del .exe, propiedades TOKEN/SERVER. Sin custom actions todavía. Build del MSI vacío como smoke test. | — |
| **3** | Custom actions: `service install`, `enroll` (token oculto), `service start`. Prueba de instalación silenciosa en máquina virtual o segundo PC. | — |
| **4** | Desinstalación limpia: `notify-uninstall --reason manual`, service stop/uninstall. `MajorUpgrade` para actualizaciones con `--reason upgrade`. | — |
| **5** | Panel: botón "Descargar agente" en la ficha del cliente (pestaña Tokens) y en `/pendientes` (token general). Enlace al MSI + comando de instalación preconfigurado con el token activo. | Decisión F pendiente |
| **6** | Pruebas end-to-end: VM/segundo PC + re-registro del agente del sobremesa. | Manual |
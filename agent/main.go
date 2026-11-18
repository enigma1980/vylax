//go:build windows

package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	golog "log"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	winsvc "golang.org/x/sys/windows/svc"

	"github.com/enigma1980/vylax/agent/client"
	"github.com/enigma1980/vylax/agent/collector"
	"github.com/enigma1980/vylax/agent/logger"
	"github.com/enigma1980/vylax/agent/report"
	"github.com/enigma1980/vylax/agent/scheduler"
	"github.com/enigma1980/vylax/agent/service"
)

const agentVersion = "0.1.0"

var procSetPriorityClass = windows.NewLazySystemDLL("kernel32.dll").NewProc("SetPriorityClass")

func main() {
	// Detectar si se está ejecutando como servicio de Windows antes de procesar argumentos.
	isService, err := winsvc.IsWindowsService()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error al detectar modo de ejecución:", err)
		os.Exit(1)
	}
	if isService {
		runAsWindowsService()
		return
	}

	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}
	switch os.Args[1] {
	case "run":
		cmdRun(os.Args[2:])
	case "enroll":
		cmdEnroll(os.Args[2:])
	case "service":
		cmdService(os.Args[2:])
	case "notify-uninstall":
		cmdNotifyUninstall(os.Args[2:])
	case "dump":
		cmdDump(os.Args[2:])
	default:
		fmt.Fprintf(os.Stderr, "subcomando desconocido: %q\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintln(os.Stderr, "uso: vylax-agent.exe <subcomando>")
	fmt.Fprintln(os.Stderr, "  run [--fast]                                          Ejecuta el agente en primer plano")
	fmt.Fprintln(os.Stderr, "  enroll --server <url> --token <token> [--force]       Alta del equipo")
	fmt.Fprintln(os.Stderr, "  service install|uninstall|start|stop|status           Gestión del servicio de Windows")
	fmt.Fprintln(os.Stderr, "  notify-uninstall [--reason manual|upgrade]            Notifica una desinstalación")
	fmt.Fprintln(os.Stderr, "                   [--initiated-by <usuario>]")
	fmt.Fprintln(os.Stderr, "  dump [--quick] [--out <archivo>]                      Vuelca métricas por consola")
}

// setPriority establece la prioridad del proceso a BELOW_NORMAL.
func setPriority() {
	const belowNormalPriorityClass = 0x00004000
	// Pseudo-handle del proceso actual: (HANDLE)-1
	procSetPriorityClass.Call(^uintptr(0), belowNormalPriorityClass)
}

// ---- modo servicio ----

func runAsWindowsService() {
	setPriority()

	cfg, err := client.LoadConfig()
	if err != nil {
		// No está registrado; el SCM verá la salida limpia y reintentará según la política.
		return
	}
	secret, err := client.LoadCredential()
	if err != nil {
		return
	}
	log, err := logger.New(client.LogFile)
	if err != nil {
		return
	}
	defer log.Close()

	// Redirigir el log estándar de Go al archivo del agente para que los avisos
	// de paquetes externos (gopsutil, wmi, etc.) también aparezcan en modo servicio.
	// En modo servicio stderr se descarta; sin esta redirección esos mensajes se perderían.
	golog.SetOutput(log.Writer())
	defer golog.SetOutput(os.Stderr)

	// Si arrancamos tras una actualización, borrar la marca de desinstalación.
	if m := client.ReadUninstallMarker(); m != nil && m.Reason == "upgrade" {
		client.DeleteUninstallMarker()
		log.Printf("marcador de actualización eliminado; arrancando tras actualización")
	}

	hc, err := client.New(cfg.ServerURL, cfg.DeviceID, secret)
	if err != nil {
		log.Printf("URL del servidor inválida: %v", err)
		return
	}

	log.Printf("Vylax Agent %s iniciando como servicio (device=%s)", agentVersion, cfg.DeviceID)
	if err := service.RunAsService(hc, cfg, log, agentVersion); err != nil {
		log.Printf("error en svc.Run: %v", err)
	}
}

// ---- subcomando: run ----

func cmdRun(args []string) {
	if !client.IsElevated() {
		fmt.Fprintln(os.Stderr, "Vylax Agent necesita ejecutarse como administrador.")
		os.Exit(1)
	}
	setPriority()

	fs := flag.NewFlagSet("run", flag.ExitOnError)
	fast := fs.Bool("fast", false, "intervalos cortos (1 min métricas/status, 5 min daily)")
	_ = fs.Parse(args)

	// Comprobar ACL (advertencia, no error fatal)
	if err := client.CheckDirACL(); err != nil {
		fmt.Fprintln(os.Stderr, "ADVERTENCIA ACL:", err)
	}

	cfg, err := client.LoadConfig()
	if err != nil {
		if os.IsNotExist(err) {
			fmt.Fprintln(os.Stderr, "sin credenciales — ejecuta primero:")
			fmt.Fprintln(os.Stderr, "  vylax-agent.exe enroll --server <url> --token <token>")
		} else {
			fmt.Fprintln(os.Stderr, "error al leer config.json:", err)
		}
		os.Exit(1)
	}

	secret, err := client.LoadCredential()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error al leer credencial:", err)
		fmt.Fprintln(os.Stderr, "ejecuta: vylax-agent.exe enroll --server <url> --token <token>")
		os.Exit(1)
	}

	log, err := logger.New(client.LogFile)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error al abrir log:", err)
		os.Exit(1)
	}
	defer log.Close()

	log.Printf("Vylax Agent %s arrancando (device=%s server=%s fast=%v)",
		agentVersion, cfg.DeviceID, cfg.ServerURL, *fast)

	hc, err := client.New(cfg.ServerURL, cfg.DeviceID, secret)
	if err != nil {
		log.Printf("URL del servidor inválida: %v", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	sched := scheduler.New(hc, cfg, log, agentVersion, *fast)
	sched.Run(ctx)

	log.Printf("Vylax Agent detenido.")
}

// ---- subcomando: enroll ----

func cmdEnroll(args []string) {
	if !client.IsElevated() {
		fmt.Fprintln(os.Stderr, "Vylax Agent necesita ejecutarse como administrador.")
		os.Exit(1)
	}

	fs := flag.NewFlagSet("enroll", flag.ExitOnError)
	server := fs.String("server", "", "URL base del servidor (ej: https://vylax.example.com)")
	token := fs.String("token", "", "token de alta (proporcionado en el panel)")
	force := fs.Bool("force", false, "sobrescribir credencial existente")
	_ = fs.Parse(args)

	if *server == "" || *token == "" {
		fmt.Fprintln(os.Stderr, "uso: vylax-agent.exe enroll --server <url> --token <token>")
		os.Exit(1)
	}

	if err := client.SetupDataDir(); err != nil {
		fmt.Fprintln(os.Stderr, "error al crear directorio de datos:", err)
		os.Exit(1)
	}

	if !*force && client.CredentialExists() {
		fmt.Fprintln(os.Stderr, "este equipo ya está registrado.")
		fmt.Fprintln(os.Stderr, "Para volver a darlo de alta usa --force (sobrescribe la credencial actual):")
		fmt.Fprintln(os.Stderr, "  vylax-agent.exe enroll --server <url> --token <token> --force")
		os.Exit(1)
	}

	fmt.Println("recopilando datos del equipo...")
	inv, _ := collector.CollectInventory()
	hostname, _ := os.Hostname()

	enrollReq := &report.EnrollRequest{
		SchemaVersion:   1,
		EnrollmentToken: *token,
		AgentVersion:    agentVersion,
		HardwareID: report.HardwareID{
			SMBIOSuuid:   inv.System.SMBIOSuuid,
			SerialNumber: inv.System.SerialNumber,
		},
		Hostname: hostname,
		OS: report.EnrollOS{
			Name:    inv.OS.Name,
			Version: inv.OS.Version,
			Build:   inv.OS.Build,
			Arch:    runtime.GOARCH,
		},
		DeviceTypeHint: detectDeviceType(inv.System.Chassis),
	}

	fmt.Printf("registrando en %s...\n", *server)
	resp, err := client.Enroll(*server, enrollReq)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error en el alta:", err)
		os.Exit(1)
	}

	localCfg := &client.LocalConfig{
		ServerURL:     *server,
		DeviceID:      resp.DeviceID,
		ConfigVersion: resp.Config.ConfigVersion,
	}
	if err := client.SaveConfig(localCfg); err != nil {
		fmt.Fprintln(os.Stderr, "error al guardar config.json:", err)
		os.Exit(1)
	}
	if err := client.SaveCredential(resp.DeviceSecret); err != nil {
		fmt.Fprintln(os.Stderr, "error al guardar credencial:", err)
		os.Exit(1)
	}

	fmt.Println("alta completada.")
	fmt.Printf("  device_id: %s\n", resp.DeviceID)
	fmt.Printf("  estado:    %s\n", resp.Status)
	fmt.Printf("  config:    v%d\n", resp.Config.ConfigVersion)
	fmt.Println("ejecuta 'vylax-agent.exe service install' para instalar el servicio.")

	// Enviar evento installed (best-effort)
	hc, err := client.New(*server, resp.DeviceID, resp.DeviceSecret)
	if err == nil {
		env := &report.Envelope{
			SchemaVersion: 1,
			AgentVersion:  agentVersion,
			SentAt:        time.Now().UTC().Format(time.RFC3339),
			Reports: []report.Report{report.Event{
				Type:       "event",
				Event:      "installed",
				OccurredAt: time.Now().UTC().Format(time.RFC3339),
			}},
		}
		if outcome, _, _ := hc.SendReports(env); outcome.Result != client.SendOK {
			fmt.Fprintln(os.Stderr, "advertencia: no se pudo enviar evento 'installed' al servidor")
		}
	}
}

// ---- subcomando: service ----

func cmdService(args []string) {
	if !client.IsElevated() {
		fmt.Fprintln(os.Stderr, "Vylax Agent necesita ejecutarse como administrador.")
		os.Exit(1)
	}
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "uso: vylax-agent.exe service install|uninstall|start|stop|status")
		os.Exit(1)
	}
	switch args[0] {
	case "install":
		exePath, err := os.Executable()
		if err != nil {
			fmt.Fprintln(os.Stderr, "error al obtener ruta del ejecutable:", err)
			os.Exit(1)
		}
		if err := service.Install(exePath); err != nil {
			fmt.Fprintln(os.Stderr, "error al instalar:", err)
			os.Exit(1)
		}
		fmt.Println("servicio instalado correctamente.")
		fmt.Println("Para iniciarlo: vylax-agent.exe service start")
	case "uninstall":
		if err := service.Uninstall(); err != nil {
			fmt.Fprintln(os.Stderr, "error al desinstalar:", err)
			os.Exit(1)
		}
		fmt.Println("servicio desinstalado.")
	case "start":
		if err := service.Start(); err != nil {
			fmt.Fprintln(os.Stderr, "error al iniciar:", err)
			os.Exit(1)
		}
		fmt.Println("servicio iniciado.")
	case "stop":
		if err := service.Stop(); err != nil {
			fmt.Fprintln(os.Stderr, "error al detener:", err)
			os.Exit(1)
		}
		fmt.Println("servicio detenido.")
	case "status":
		st, err := service.QueryStatus()
		if err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
		fmt.Printf("VylaxAgent: %s\n", st)
	default:
		fmt.Fprintf(os.Stderr, "subcomando desconocido: %q\n", args[0])
		fmt.Fprintln(os.Stderr, "uso: vylax-agent.exe service install|uninstall|start|stop|status")
		os.Exit(1)
	}
}

// ---- subcomando: notify-uninstall ----

func cmdNotifyUninstall(args []string) {
	fs := flag.NewFlagSet("notify-uninstall", flag.ExitOnError)
	reason := fs.String("reason", "manual", "motivo de la desinstalación (manual|upgrade)")
	initiatedBy := fs.String("initiated-by", "", "usuario que inicia la desinstalación (lo pasa el MSI)")
	_ = fs.Parse(args)

	// Escribir el archivo de marca ANTES de enviar el evento.
	// Esto indica al servicio (en STOP) que no envíe service_stopped.
	if err := client.WriteUninstallMarker(*reason); err != nil {
		fmt.Fprintln(os.Stderr, "advertencia: no se pudo escribir marca:", err)
	}

	// Si no está registrado, no hay nada que enviar.
	cfg, err := client.LoadConfig()
	if err != nil {
		os.Exit(0)
	}
	secret, err := client.LoadCredential()
	if err != nil {
		os.Exit(0)
	}
	hc, err := client.New(cfg.ServerURL, cfg.DeviceID, secret)
	if err != nil {
		os.Exit(1)
	}

	// Usuario que inicia la desinstalación.
	by := *initiatedBy
	if by == "" {
		by = collector.LoggedOnUser()
	}

	// logged_on_user es siempre la sesión activa vía WTS; initiated_by puede ser
	// distinto si el MSI pasa --initiated-by (p.ej. la cuenta de Intune).
	loggedOnUser := collector.LoggedOnUser()

	env := &report.Envelope{
		SchemaVersion: 1,
		AgentVersion:  agentVersion,
		SentAt:        time.Now().UTC().Format(time.RFC3339),
		Reports: []report.Report{report.Event{
			Type:       "event",
			Event:      "uninstall",
			OccurredAt: time.Now().UTC().Format(time.RFC3339),
			Data: map[string]any{
				"reason":          *reason,
				"initiated_by":    by,
				"logged_on_user":  loggedOnUser,
			},
		}},
	}

	// Reintentar durante 20 s (con pausas de 2 s).
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		outcome, _, err := hc.SendReports(env)
		if outcome.Result == client.SendOK {
			fmt.Println("evento de desinstalación enviado.")
			return
		}
		if outcome.Result == client.SendRetry || err != nil {
			time.Sleep(2 * time.Second)
			continue
		}
		break // 401, 410, etc.: no reintentar
	}

	// Si no se pudo enviar, guardar en caché para el próximo arranque.
	_ = client.SaveToCache(env, 10)
	fmt.Fprintln(os.Stderr, "no se pudo enviar el evento; guardado en caché.")
}

// ---- subcomando: dump ----

func cmdDump(args []string) {
	fs := flag.NewFlagSet("dump", flag.ExitOnError)
	quick := fs.Bool("quick", false, "muestras de CPU de 1 s durante 10 s")
	outFile := fs.String("out", "", "archivo de salida JSON (vacío = stdout)")
	_ = fs.Parse(args)

	sampleInterval := 30 * time.Second
	sampleCount := 10
	if *quick {
		sampleInterval = 1 * time.Second
		fmt.Fprintln(os.Stderr, "modo --quick: 10 muestras de 1 s")
	} else {
		fmt.Fprintln(os.Stderr, "modo normal: 10 × 30 s (usa --quick para pruebas rápidas)")
	}

	var w io.Writer = os.Stdout
	if *outFile != "" {
		f, err := os.Create(*outFile)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error al crear archivo:", err)
			os.Exit(1)
		}
		defer f.Close()
		w = f
	}

	fmt.Fprintln(os.Stderr, "recopilando inventario...")
	inv, invHash := collector.CollectInventory()
	fmt.Fprintln(os.Stderr, "tomando muestras de CPU y RAM...")
	metrics := collector.CollectMetrics(sampleInterval, sampleCount, nil, nil)
	fmt.Fprintln(os.Stderr, "recopilando estado...")
	status := collector.CollectStatus(invHash)
	fmt.Fprintln(os.Stderr, "recopilando daily...")
	daily := collector.CollectDaily()

	envelope := report.Envelope{
		SchemaVersion: 1,
		AgentVersion:  agentVersion,
		SentAt:        time.Now().UTC().Format(time.RFC3339),
		Reports:       []report.Report{metrics, status, daily, inv},
	}

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(envelope); err != nil {
		fmt.Fprintln(os.Stderr, "error al serializar JSON:", err)
		os.Exit(1)
	}
}

// ---- helpers ----

func detectDeviceType(chassis string) string {
	switch strings.ToLower(chassis) {
	case "laptop", "notebook", "portable", "sub-notebook", "tablet", "convertible", "detachable":
		return "laptop"
	case "server", "main-server-chassis", "rack-mount-chassis", "tower", "blade", "blade-enclosure":
		return "server"
	default:
		return "desktop"
	}
}

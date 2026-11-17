//go:build windows

package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/enigma1980/vylax/agent/client"
	"github.com/enigma1980/vylax/agent/collector"
	"github.com/enigma1980/vylax/agent/logger"
	"github.com/enigma1980/vylax/agent/report"
	"github.com/enigma1980/vylax/agent/scheduler"
)

const agentVersion = "0.1.0"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}
	switch os.Args[1] {
	case "run":
		cmdRun(os.Args[2:])
	case "enroll":
		cmdEnroll(os.Args[2:])
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
	fmt.Fprintln(os.Stderr, "  run [--fast]                              Ejecuta el agente en primer plano")
	fmt.Fprintln(os.Stderr, "  enroll --server <url> --token <token>     Alta del equipo (--force para sobrescribir)")
	fmt.Fprintln(os.Stderr, "  dump [--quick] [--out <archivo>]          Vuelca métricas por consola (pruebas)")
}

// ---- subcomando: run ----

func cmdRun(args []string) {
	if !client.IsElevated() {
		fmt.Fprintln(os.Stderr, "Vylax Agent necesita ejecutarse como administrador.")
		os.Exit(1)
	}

	fs := flag.NewFlagSet("run", flag.ExitOnError)
	fast := fs.Bool("fast", false, "intervalos cortos (1 min métricas/status, 5 min daily)")
	_ = fs.Parse(args)

	// Comprobar ACL (advertencia, no error fatal)
	if err := client.CheckDirACL(); err != nil {
		fmt.Fprintln(os.Stderr, "ADVERTENCIA ACL:", err)
	}

	// Cargar config local
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

	// Cargar credencial (cifrada con DPAPI)
	secret, err := client.LoadCredential()
	if err != nil {
		fmt.Fprintln(os.Stderr, "error al leer credencial:", err)
		fmt.Fprintln(os.Stderr, "ejecuta: vylax-agent.exe enroll --server <url> --token <token>")
		os.Exit(1)
	}

	// Abrir log rotante
	log, err := logger.New(client.LogFile)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error al abrir log:", err)
		os.Exit(1)
	}
	defer log.Close()

	log.Printf("Vylax Agent %s arrancando (device=%s server=%s fast=%v)",
		agentVersion, cfg.DeviceID, cfg.ServerURL, *fast)

	// Crear cliente HTTP
	hc, err := client.New(cfg.ServerURL, cfg.DeviceID, secret)
	if err != nil {
		log.Printf("URL del servidor inválida: %v", err)
		os.Exit(1)
	}

	// Capturar Ctrl+C / SIGTERM
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

	// Crear directorio antes de cualquier otra comprobación
	if err := client.SetupDataDir(); err != nil {
		fmt.Fprintln(os.Stderr, "error al crear directorio de datos:", err)
		os.Exit(1)
	}

	// Protección contra doble alta
	if !*force && client.CredentialExists() {
		fmt.Fprintln(os.Stderr, "este equipo ya está registrado.")
		fmt.Fprintln(os.Stderr, "Para volver a darlo de alta usa --force (sobrescribe la credencial actual):")
		fmt.Fprintln(os.Stderr, "  vylax-agent.exe enroll --server <url> --token <token> --force")
		os.Exit(1)
	}

	// Recopilar datos del equipo
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

	// Guardar config y credencial
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
	fmt.Println("ejecuta 'vylax-agent.exe run' para iniciar el agente.")

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

// detectDeviceType mapea el tipo de chasis SMBIOS a laptop/server/desktop.
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

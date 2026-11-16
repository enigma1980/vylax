//go:build windows

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/enigma1980/vylax/agent/collector"
	"github.com/enigma1980/vylax/agent/report"
)

const agentVersion = "0.1.0"

func main() {
	quick := flag.Bool("quick", false, "muestras de CPU de 1 s durante 10 s (para pruebas)")
	outFile := flag.String("out", "", "archivo de salida JSON en UTF-8 (si se omite, usa stdout)")
	flag.Parse()

	var sampleInterval time.Duration
	var sampleCount int
	if *quick {
		sampleInterval = 1 * time.Second
		sampleCount = 10
		fmt.Fprintln(os.Stderr, "modo --quick: 10 muestras de 1 s")
	} else {
		sampleInterval = 30 * time.Second
		sampleCount = 10 // 10 × 30 s = 5 min
		fmt.Fprintln(os.Stderr, "modo normal: 10 muestras de 30 s (usa --quick para pruebas rápidas)")
	}

	// Servicios críticos y lista de ignorados (vacías en el prototipo;
	// en el agente completo vendrán de /v1/config).
	criticalServices := []string{}
	ignoreServices := []string{}

	// 1. Inventario (lo primero para tener el hash)
	fmt.Fprintln(os.Stderr, "recopilando inventario...")
	inv, invHash := collector.CollectInventory()

	// 2. Métricas (ciclo de muestras; es la operación más larga)
	fmt.Fprintln(os.Stderr, "tomando muestras de CPU y RAM...")
	metrics := collector.CollectMetrics(sampleInterval, sampleCount, criticalServices, ignoreServices)

	// 3. Estado
	fmt.Fprintln(os.Stderr, "recopilando estado del sistema...")
	status := collector.CollectStatus(invHash)

	// 4. Daily
	fmt.Fprintln(os.Stderr, "recopilando salud de discos y actualizaciones...")
	daily := collector.CollectDaily()

	// Sobre
	envelope := report.Envelope{
		SchemaVersion: 1,
		AgentVersion:  agentVersion,
		SentAt:        time.Now().UTC().Format(time.RFC3339),
		Reports:       []report.Report{metrics, status, daily, inv},
	}

	var w io.Writer = os.Stdout
	if *outFile != "" {
		f, err := os.Create(*outFile)
		if err != nil {
			fmt.Fprintln(os.Stderr, "error al crear archivo de salida:", err)
			os.Exit(1)
		}
		defer f.Close()
		w = f
	}

	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(envelope); err != nil {
		fmt.Fprintln(os.Stderr, "error al serializar JSON:", err)
		os.Exit(1)
	}
}

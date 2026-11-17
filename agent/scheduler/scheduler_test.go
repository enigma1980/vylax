//go:build windows

package scheduler_test

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/enigma1980/vylax/agent/client"
	"github.com/enigma1980/vylax/agent/logger"
	"github.com/enigma1980/vylax/agent/report"
	"github.com/enigma1980/vylax/agent/scheduler"
)

// TestNoShutdownEventEnModoServicio verifica que, cuando DisableShutdownEvent
// está activo, una cancelación de contexto (equivalente a un STOP del servicio)
// no envía el evento "shutdown". En modo servicio el handler de Execute es
// el único responsable de los eventos de parada.
func TestNoShutdownEventEnModoServicio(t *testing.T) {
	var mu sync.Mutex
	var eventNames []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			// GET /v1/config
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(report.ConfigResponse{
				ConfigVersion: 1,
				Intervals: report.ConfigIntervals{
					SampleS:  30,
					MetricsS: 60,
					StatusS:  60,
					DailyS:   300,
				},
				MeteredIntervalMult: 3,
				OfflineCacheMaxMB:   10,
			})
			return
		}

		// POST /v1/reports — descomprimir gzip y registrar nombres de eventos
		body := r.Body
		if r.Header.Get("Content-Encoding") == "gzip" {
			gr, err := gzip.NewReader(r.Body)
			if err == nil {
				defer gr.Close()
				body = io.NopCloser(gr)
			}
		}

		var envRaw struct {
			Reports []json.RawMessage `json:"reports"`
		}
		if err := json.NewDecoder(body).Decode(&envRaw); err == nil {
			for _, raw := range envRaw.Reports {
				var ev struct {
					Type  string `json:"type"`
					Event string `json:"event"`
				}
				if err := json.Unmarshal(raw, &ev); err == nil && ev.Type == "event" {
					mu.Lock()
					eventNames = append(eventNames, ev.Event)
					mu.Unlock()
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(report.ReportsResponse{Accepted: 1})
	}))
	defer srv.Close()

	hc, err := client.New(srv.URL, "test-device", "test-secret")
	if err != nil {
		t.Fatal(err)
	}

	logPath := filepath.Join(t.TempDir(), "test.log")
	log, err := logger.New(logPath)
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()

	cfg := &client.LocalConfig{ServerURL: srv.URL, DeviceID: "test-device"}
	sched := scheduler.New(hc, cfg, log, "0.0.0-test", true /* fast */)
	sched.DisableShutdownEvent()

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		sched.Run(ctx)
	}()

	// Esperar a que se envíe el evento "started" (el primero que manda el scheduler)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		found := len(eventNames) > 0
		mu.Unlock()
		if found {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Cancelar el contexto (equivale al STOP del servicio)
	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()

	for _, name := range eventNames {
		if name == "shutdown" {
			t.Errorf("evento 'shutdown' enviado en modo servicio (no debe enviarse); eventos registrados: %v", eventNames)
		}
	}

	// Verificar que "started" sí se envió (el scheduler funciona)
	var foundStarted bool
	for _, name := range eventNames {
		if name == "started" {
			foundStarted = true
			break
		}
	}
	if !foundStarted {
		t.Errorf("evento 'started' no encontrado; ¿el scheduler arrancó? eventos: %v", eventNames)
	}
}

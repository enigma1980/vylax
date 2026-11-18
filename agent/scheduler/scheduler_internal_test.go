//go:build windows

package scheduler

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
)

// TestWarmupNoProgramaDailyReciente verifica que si el último daily se ejecutó
// hace menos de DailyS segundos, el warmup al arrancar no programa la tarea pesada.
// Reproduce el escenario del bug: timestamps.json tiene last_daily_at reciente,
// el agente reinicia con uptime de Windows > warmupTarget y el warmup dispara
// de inmediato, pero no debe programar la recogida pesada.
func TestWarmupNoProgramaDailyReciente(t *testing.T) {
	var mu sync.Mutex
	var reportTypes []string

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
					DailyS:   300, // 5 min; en fast mode se usa este valor
				},
				MeteredIntervalMult: 3,
				OfflineCacheMaxMB:   10,
			})
			return
		}

		// POST /v1/reports — registrar tipos de informes recibidos
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
				var rep struct {
					Type string `json:"type"`
				}
				if json.Unmarshal(raw, &rep) == nil {
					mu.Lock()
					reportTypes = append(reportTypes, rep.Type)
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
	sched := New(hc, cfg, log, "0.0.0-test", true /* fast */)
	sched.DisableShutdownEvent()

	// Simular que el último daily se ejecutó hace 2 min.
	// En fast mode DailyS=300 s (5 min), así que 2 min < 5 min → no debe programarse.
	sched.lastDailySent = time.Now().Add(-2 * time.Minute)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		sched.Run(ctx)
	}()

	// Esperar 3 s: suficiente para que el warmup dispare y el scheduler opere
	// varias iteraciones del ticker, pero no suficiente para que pasen 5 min.
	time.Sleep(3 * time.Second)
	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()

	for _, rtype := range reportTypes {
		if rtype == "daily" {
			t.Errorf("se envió un 'daily' aunque el último fue hace < 5 min; tipos enviados: %v", reportTypes)
			return
		}
	}
}

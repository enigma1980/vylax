//go:build windows

package client

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/enigma1980/vylax/agent/report"
)

// TestSendCachedFileCuerpoIdentico verifica que el cuerpo enviado al servidor
// es byte a byte igual al JSON guardado en disco por SaveToCache.
func TestSendCachedFileCuerpoIdentico(t *testing.T) {
	env := &report.Envelope{
		SchemaVersion: 1,
		AgentVersion:  "0.0.0-test",
		SentAt:        "2026-01-01T00:00:00Z",
		Reports:       nil,
	}
	original, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}

	var received []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gr, err := gzip.NewReader(r.Body)
		if err != nil {
			t.Errorf("body no es gzip: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		received, _ = io.ReadAll(gr)
		gr.Close()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(report.ReportsResponse{Accepted: 1})
	}))
	defer srv.Close()

	c, err := New(srv.URL, "device-1", "secret-test")
	if err != nil {
		t.Fatal(err)
	}
	outcome, _, err := c.SendCachedFile(original)
	if err != nil {
		t.Fatalf("SendCachedFile: %v", err)
	}
	if outcome.Result != SendOK {
		t.Fatalf("resultado esperado SendOK, obtenido %v", outcome.Result)
	}
	if !bytes.Equal(received, original) {
		t.Errorf("cuerpo recibido no coincide con el original\nrecibido: %s\noriginal: %s", received, original)
	}
}

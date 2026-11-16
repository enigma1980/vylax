//go:build windows

package client

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/enigma1980/vylax/agent/report"
)

const httpTimeout = 30 * time.Second

// Client es el cliente HTTP autenticado para POST /v1/reports y GET /v1/config.
type Client struct {
	serverURL string
	deviceID  string
	secret    string
	hc        *http.Client
}

// New crea un Client validando que la URL sea segura.
// http:// solo se permite si el host es localhost / 127.0.0.1 / ::1.
func New(serverURL, deviceID, secret string) (*Client, error) {
	if err := validateURL(serverURL); err != nil {
		return nil, err
	}
	return &Client{
		serverURL: serverURL,
		deviceID:  deviceID,
		secret:    secret,
		hc:        &http.Client{Timeout: httpTimeout},
	}, nil
}

func validateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("URL inválida: %w", err)
	}
	if u.Scheme == "http" {
		h := u.Hostname()
		if h != "localhost" && h != "127.0.0.1" && h != "::1" {
			return fmt.Errorf("http:// solo está permitido para localhost; usa https:// para %q", h)
		}
	}
	return nil
}

// SendResult clasifica el resultado de un envío.
type SendResult int

const (
	SendOK    SendResult = iota // 2xx — éxito
	SendRetry                   // 5xx o sin red — guardar en caché
	Send401                     // credencial revocada — esperar 6 h
	Send410                     // equipo eliminado — parar definitivamente
	Send429                     // tasa limitada — respetar Retry-After
)

// SendOutcome combina el resultado con información adicional (p.ej. Retry-After).
type SendOutcome struct {
	Result     SendResult
	RetryAfter time.Duration // solo relevante para Send429
}

// SendReports envía POST /v1/reports comprimido con gzip.
func (c *Client) SendReports(env *report.Envelope) (SendOutcome, *report.ReportsResponse, error) {
	data, err := marshalGzip(env)
	if err != nil {
		return SendOutcome{Result: SendRetry}, nil, fmt.Errorf("serializar sobre: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, c.serverURL+"/v1/reports", bytes.NewReader(data))
	if err != nil {
		return SendOutcome{Result: SendRetry}, nil, err
	}
	c.setAuthHeaders(req)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "gzip")

	resp, err := c.hc.Do(req)
	if err != nil {
		return SendOutcome{Result: SendRetry}, nil, fmt.Errorf("sin conexión: %w", err)
	}
	defer resp.Body.Close()
	return parseReportsResponse(resp)
}

// SendCachedFile recomprime y envía un envelope guardado en caché (JSON sin comprimir).
func (c *Client) SendCachedFile(raw []byte) (SendOutcome, *report.ReportsResponse, error) {
	var env report.Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return SendOutcome{Result: SendRetry}, nil, fmt.Errorf("parsear caché: %w", err)
	}
	return c.SendReports(&env)
}

// GetConfig hace GET /v1/config y devuelve la configuración del agente.
func (c *Client) GetConfig() (*report.ConfigResponse, error) {
	req, err := http.NewRequest(http.MethodGet, c.serverURL+"/v1/config", nil)
	if err != nil {
		return nil, err
	}
	c.setAuthHeaders(req)
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET /v1/config: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET /v1/config: estado %d", resp.StatusCode)
	}
	var cfg report.ConfigResponse
	if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
		return nil, fmt.Errorf("parsear config: %w", err)
	}
	return &cfg, nil
}

// Enroll hace POST /v1/enroll sin autenticación de dispositivo.
func Enroll(serverURL string, body *report.EnrollRequest) (*report.EnrollResponse, error) {
	if err := validateURL(serverURL); err != nil {
		return nil, err
	}
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	hc := &http.Client{Timeout: httpTimeout}
	req, err := http.NewRequest(http.MethodPost, serverURL+"/v1/enroll", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("POST /v1/enroll: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("enroll: estado %d: %s", resp.StatusCode, b)
	}
	var r report.EnrollResponse
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (c *Client) setAuthHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+c.secret)
	req.Header.Set("X-Device-Id", c.deviceID)
}

func parseReportsResponse(resp *http.Response) (SendOutcome, *report.ReportsResponse, error) {
	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		var r report.ReportsResponse
		if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
			return SendOutcome{Result: SendRetry}, nil, fmt.Errorf("parsear respuesta: %w", err)
		}
		return SendOutcome{Result: SendOK}, &r, nil
	case resp.StatusCode == 401:
		return SendOutcome{Result: Send401}, nil, fmt.Errorf("credencial revocada (401)")
	case resp.StatusCode == 410:
		return SendOutcome{Result: Send410}, nil, fmt.Errorf("equipo eliminado en el panel (410)")
	case resp.StatusCode == 429:
		d := parseRetryAfter(resp.Header.Get("Retry-After"))
		return SendOutcome{Result: Send429, RetryAfter: d}, nil, fmt.Errorf("tasa limitada (429); esperar %s", d)
	default:
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return SendOutcome{Result: SendRetry}, nil, fmt.Errorf("error %d: %s", resp.StatusCode, b)
	}
}

func marshalGzip(v any) ([]byte, error) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if err := json.NewEncoder(gz).Encode(v); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func parseRetryAfter(h string) time.Duration {
	if secs, err := strconv.Atoi(h); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	return 60 * time.Second
}

//go:build windows

package client

import (
	"encoding/json"
	"os"
	"time"
)

const UninstallMarkerFile = `C:\ProgramData\Guaitiq\uninstalling`

// UninstallMarker es el contenido del archivo de marca que escribe notify-uninstall.
type UninstallMarker struct {
	Reason string `json:"reason"`
	At     string `json:"at"`
}

// WriteUninstallMarker escribe el archivo de marca con reason y fecha actual.
// El servicio lo comprueba en STOP para omitir el evento service_stopped.
func WriteUninstallMarker(reason string) error {
	data, err := json.Marshal(UninstallMarker{
		Reason: reason,
		At:     time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return err
	}
	return os.WriteFile(UninstallMarkerFile, data, 0640)
}

// ReadUninstallMarker devuelve el marcador si existe y tiene menos de 10 minutos.
// Devuelve nil si no existe, está expirado o está malformado.
func ReadUninstallMarker() *UninstallMarker {
	data, err := os.ReadFile(UninstallMarkerFile)
	if err != nil {
		return nil
	}
	var m UninstallMarker
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	t, err := time.Parse(time.RFC3339, m.At)
	if err != nil || time.Since(t) > 10*time.Minute {
		return nil
	}
	return &m
}

// DeleteUninstallMarker elimina el archivo de marca.
func DeleteUninstallMarker() {
	_ = os.Remove(UninstallMarkerFile)
}

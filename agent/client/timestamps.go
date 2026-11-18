//go:build windows

package client

import (
	"encoding/json"
	"os"
)

const TimestampsFile = `C:\ProgramData\Vylax\timestamps.json`

// Timestamps guarda las fechas de la última recogida de tareas pesadas para
// no repetirlas innecesariamente cuando el agente se reinicia.
type Timestamps struct {
	LastDailyAt     string `json:"last_daily_at,omitempty"`
	LastInventoryAt string `json:"last_inventory_at,omitempty"`
}

// LoadTimestamps lee C:\ProgramData\Vylax\timestamps.json.
// Devuelve nil si el archivo no existe o está malformado (primer arranque).
func LoadTimestamps() (*Timestamps, error) {
	data, err := os.ReadFile(TimestampsFile)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var ts Timestamps
	if err := json.Unmarshal(data, &ts); err != nil {
		return nil, err
	}
	return &ts, nil
}

// SaveTimestamps escribe C:\ProgramData\Vylax\timestamps.json.
func SaveTimestamps(ts *Timestamps) error {
	data, err := json.MarshalIndent(ts, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(TimestampsFile, data, 0640)
}

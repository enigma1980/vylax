//go:build windows

package client

import (
	"encoding/json"
	"os"
)

const TimestampsFile = `C:\ProgramData\Vylax\timestamps.json`

// Timestamps guarda las fechas de la última recogida de tareas pesadas y el
// hash del último inventario para no perderlos entre reinicios del servicio.
type Timestamps struct {
	LastDailyAt     string `json:"last_daily_at,omitempty"`
	LastInventoryAt string `json:"last_inventory_at,omitempty"`
	// InvHash es el hash del último inventario enviado al servidor.
	// Se persiste para que CollectStatus pueda incluirlo aunque el agente
	// acabe de reiniciarse y aún no haya recogido el inventario completo.
	InvHash string `json:"inv_hash,omitempty"`
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

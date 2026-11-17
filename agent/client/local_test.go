//go:build windows

package client

import (
	"path/filepath"
	"testing"
)

// TestEnsureDirIdempotente verifica que ensureDir no falla al llamarse dos veces
// sobre la misma carpeta (caso de re-enroll con C:\ProgramData\Vylax ya existente).
func TestEnsureDirIdempotente(t *testing.T) {
	tmp := t.TempDir()
	dataDir := filepath.Join(tmp, "Vylax")
	cacheDir := filepath.Join(tmp, "Vylax", "cache")

	dirs := []string{dataDir, cacheDir}

	for i := 1; i <= 2; i++ {
		for _, dir := range dirs {
			if err := ensureDir(dir); err != nil {
				t.Fatalf("llamada %d, dir %s: %v", i, dir, err)
			}
		}
	}
}

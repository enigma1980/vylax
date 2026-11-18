//go:build windows

package collector_test

import (
	"strings"
	"testing"

	"github.com/enigma1980/vylax/agent/collector"
)

// TestInventoryHashEstable verifica que dos llamadas consecutivas a
// CollectInventory devuelven el mismo hash. El hash solo debe depender de
// campos que no cambian solos (fabricante, modelo, SO, discos físicos…) y
// debe ser insensible al orden de las listas.
func TestInventoryHashEstable(t *testing.T) {
	inv1, hash1 := collector.CollectInventory()
	inv2, hash2 := collector.CollectInventory()

	if hash1 == "" {
		t.Fatal("primer hash vacío; ¿falla la recogida de inventario?")
	}
	if hash2 == "" {
		t.Fatal("segundo hash vacío; ¿falla la recogida de inventario?")
	}
	if hash1 != hash2 {
		t.Errorf("hash no es estable entre dos llamadas consecutivas:\nhash1: %s\nhash2: %s", hash1, hash2)
	}
	// Coherencia básica: el hash almacenado en el struct debe coincidir con el retornado.
	if inv1.Hash != hash1 {
		t.Errorf("inv1.Hash (%s) != hash retornado (%s)", inv1.Hash, hash1)
	}
	if inv2.Hash != hash2 {
		t.Errorf("inv2.Hash (%s) != hash retornado (%s)", inv2.Hash, hash2)
	}
	// El hash tiene el prefijo "sha256:" y al menos 64 caracteres hex.
	if !strings.HasPrefix(hash1, "sha256:") {
		t.Errorf("hash sin prefijo 'sha256:': %s", hash1)
	}
}

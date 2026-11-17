//go:build windows

package collector

import (
	"log"
	"time"
)

// withTimeout ejecuta fn en una goroutine con un tiempo máximo.
// Si se supera el límite, registra un aviso y devuelve empty.
// El canal tiene buffer 1 para que la goroutine no quede bloqueada
// permanentemente aunque esta función ya haya devuelto.
func withTimeout[T any](name string, timeout time.Duration, fn func() T, empty T) T {
	ch := make(chan T, 1)
	go func() { ch <- fn() }()
	select {
	case result := <-ch:
		return result
	case <-time.After(timeout):
		log.Printf("aviso: colector %q superó el tiempo máximo de %s; dato omitido", name, timeout)
		return empty
	}
}

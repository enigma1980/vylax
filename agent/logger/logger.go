//go:build windows

package logger

import (
	"fmt"
	"io"
	"log"
	"os"
	"sync"
)

const maxLogSize int64 = 5 * 1024 * 1024 // 5 MB por archivo

// Logger escribe en el archivo de log y en stderr simultáneamente.
// Cuando el archivo supera maxLogSize lo renombra a .1 y crea uno nuevo.
type Logger struct {
	mu      sync.Mutex
	path    string
	file    *os.File
	written int64
	inner   *log.Logger
}

// New abre (o crea) el archivo de log en path.
func New(path string) (*Logger, error) {
	l := &Logger{path: path}
	if err := l.openFile(); err != nil {
		return nil, err
	}
	return l, nil
}

func (l *Logger) openFile() error {
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0640)
	if err != nil {
		return err
	}
	fi, _ := f.Stat()
	l.file = f
	l.written = fi.Size()
	l.inner = log.New(io.MultiWriter(f, os.Stderr), "", log.LstdFlags)
	return nil
}

func (l *Logger) rotate() {
	_ = l.file.Close()
	_ = os.Rename(l.path, l.path+".1")
	if err := l.openFile(); err != nil {
		l.inner = log.New(os.Stderr, "", log.LstdFlags)
	}
}

// Printf formatea y escribe una línea de log. Hilo-seguro.
func (l *Logger) Printf(format string, args ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	msg := fmt.Sprintf(format, args...)
	l.inner.Print(msg)
	l.written += int64(len(msg)) + 32 // 32 bytes aprox. de cabecera de timestamp
	if l.written >= maxLogSize {
		l.rotate()
	}
}

// Close cierra el archivo de log.
func (l *Logger) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		_ = l.file.Close()
	}
}

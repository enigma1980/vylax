//go:build windows

package client

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// SaveToCache serializa env como JSON y lo guarda en la carpeta de caché.
// Si el total supera maxMB elimina los archivos más antiguos para hacer hueco.
func SaveToCache(env any, maxMB int) error {
	if err := ensureDir(CacheDir); err != nil {
		return fmt.Errorf("crear caché: %w", err)
	}
	data, err := json.Marshal(env)
	if err != nil {
		return err
	}
	if maxMB > 0 {
		limit := int64(maxMB)*1024*1024 - int64(len(data))
		evictUntilBelow(limit)
	}
	name := fmt.Sprintf("%d.json", time.Now().UnixNano())
	return os.WriteFile(filepath.Join(CacheDir, name), data, 0640)
}

// CacheFiles devuelve las rutas de los archivos de caché del más antiguo al más nuevo.
func CacheFiles() ([]string, error) {
	entries, err := os.ReadDir(CacheDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			files = append(files, filepath.Join(CacheDir, e.Name()))
		}
	}
	sort.Strings(files) // nombres = timestamp_ns → orden cronológico
	return files, nil
}

// ReadCacheFile lee el contenido de un archivo de caché.
func ReadCacheFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

// DeleteCacheFile elimina un archivo de caché tras enviarlo con éxito.
func DeleteCacheFile(path string) error {
	return os.Remove(path)
}

// evictUntilBelow borra los archivos de caché más antiguos hasta que el total
// de bytes ocupados quede por debajo de targetBytes.
func evictUntilBelow(targetBytes int64) {
	entries, err := os.ReadDir(CacheDir)
	if err != nil {
		return
	}
	type fi struct {
		path string
		size int64
	}
	var files []fi
	var total int64
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, fi{filepath.Join(CacheDir, e.Name()), info.Size()})
		total += info.Size()
	}
	sort.Slice(files, func(i, j int) bool { return files[i].path < files[j].path })
	for total > targetBytes && len(files) > 0 {
		_ = os.Remove(files[0].path)
		total -= files[0].size
		files = files[1:]
	}
}

//go:build windows

package collector

import (
	"log"
	"os"
	"time"
	"unsafe"

	"github.com/enigma1980/vylax/agent/report"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"
	"golang.org/x/sys/windows"
)

// CollectMetrics toma muestras de CPU durante el intervalo indicado y devuelve
// el informe de métricas. sampleInterval define el tiempo entre muestras;
// sampleCount, cuántas tomar.
func CollectMetrics(sampleInterval time.Duration, sampleCount int, criticalServices []string, ignoreServices []string) report.Metrics {
	start := time.Now().UTC()

	cpuAvg, cpuMax := sampleCPU(sampleInterval, sampleCount)
	memAvg, memMax, memTotal := sampleMemory(sampleInterval, sampleCount)

	end := time.Now().UTC()

	vols := collectVolumes()
	svcs := collectServices(criticalServices, ignoreServices)
	uptime := collectUptime()
	self := collectSelf()

	return report.Metrics{
		Type:        "metrics",
		PeriodStart: start.Format(time.RFC3339),
		PeriodEnd:   end.Format(time.RFC3339),
		Samples:     sampleCount,
		CPU: report.MetricsCPU{
			AvgPct: cpuAvg,
			MaxPct: cpuMax,
		},
		Memory: report.MetricsMemory{
			TotalBytes: memTotal,
			UsedAvgPct: memAvg,
			UsedMaxPct: memMax,
		},
		Volumes:    vols,
		Services:   svcs,
		UptimeSecs: uptime,
		Agent:      self,
	}
}

// QuickCPUPercent toma una muestra de CPU de 1 s.
// Usada por el scheduler para decidir si las condiciones permiten una tarea pesada.
func QuickCPUPercent() float64 {
	pcts, err := cpu.Percent(1*time.Second, false)
	if err != nil || len(pcts) == 0 {
		return 0
	}
	return pcts[0]
}

func sampleCPU(interval time.Duration, count int) (avg, max float64) {
	var total float64
	for i := 0; i < count; i++ {
		pcts, err := cpu.Percent(interval, false)
		if err != nil || len(pcts) == 0 {
			log.Printf("aviso metrics: CPU sample %d: %v", i, err)
			continue
		}
		v := pcts[0]
		total += v
		if v > max {
			max = v
		}
	}
	if count > 0 {
		avg = roundPct(total / float64(count))
	}
	max = roundPct(max)
	return
}

func sampleMemory(interval time.Duration, count int) (avg, max float64, total uint64) {
	var sumPct float64
	for i := 0; i < count; i++ {
		if i > 0 {
			time.Sleep(interval)
		}
		vm, err := mem.VirtualMemory()
		if err != nil {
			log.Printf("aviso metrics: RAM sample %d: %v", i, err)
			continue
		}
		if total == 0 {
			total = vm.Total
		}
		pct := float64(vm.Used) / float64(vm.Total) * 100
		sumPct += pct
		if pct > max {
			max = pct
		}
	}
	if count > 0 {
		avg = roundPct(sumPct / float64(count))
	}
	max = roundPct(max)
	return
}

// collectVolumes enumera los volúmenes físicos del equipo usando GetLogicalDrives
// y GetVolumeInformation directamente, sin pasar por gopsutil. Esto evita problemas
// cuando el agente corre como LocalSystem en la sesión 0 (servicio de Windows), donde
// gopsutil/disk.Partitions puede fallar silenciosamente por diferencias en el espacio
// de nombres de dispositivos DOS entre sesiones.
func collectVolumes() []report.Volume {
	out := make([]report.Volume, 0)

	r, _, err := procGetLogicalDrives.Call()
	if r == 0 {
		log.Printf("aviso metrics: GetLogicalDrives: %v", err)
		return out
	}
	mask := uint32(r)

	for i := 0; i < 26; i++ {
		if mask&(1<<uint(i)) == 0 {
			continue
		}
		mountpoint := string(rune('A'+i)) + `:\`

		rootPtr, err := windows.UTF16PtrFromString(mountpoint)
		if err != nil {
			continue
		}

		// Solo FIXED y REMOVABLE; CD/DVD, red, ramdisk y desconocidos se descartan.
		dtype := windows.GetDriveType(rootPtr)
		switch dtype {
		case windows.DRIVE_FIXED, windows.DRIVE_REMOVABLE:
			// continuar
		default:
			continue
		}

		// Tipo de filesystem y etiqueta en una sola llamada.
		var volName [windows.MAX_PATH + 1]uint16
		var fsTypeBuf [32]uint16
		if err := windows.GetVolumeInformation(
			rootPtr,
			&volName[0], uint32(len(volName)),
			nil, nil, nil,
			&fsTypeBuf[0], uint32(len(fsTypeBuf)),
		); err != nil {
			// Extraíble sin medio u otro error temporal → silencio.
			continue
		}

		fstype := windows.UTF16ToString(fsTypeBuf[:])
		if fstype == "" {
			continue
		}

		// Excluir unidades virtuales / nube (Google Drive File Stream, OneDrive, etc.)
		// que montan como DRIVE_FIXED pero no tienen dispositivo de almacenamiento físico.
		if !hasPhysicalDevice(mountpoint) {
			continue
		}

		// Usamos TotalNumberOfFreeBytes (3er parámetro), no FreeBytesAvailableToCaller,
		// para que el valor sea independiente de las cuotas de disco del usuario.
		var freeBytesAvailable, totalBytes, totalFreeBytes uint64
		if err := windows.GetDiskFreeSpaceEx(rootPtr, &freeBytesAvailable, &totalBytes, &totalFreeBytes); err != nil {
			continue
		}
		if totalBytes == 0 {
			continue
		}

		out = append(out, report.Volume{
			Mount:      mountpoint,
			Label:      windows.UTF16ToString(volName[:]),
			FS:         fstype,
			TotalBytes: totalBytes,
			FreeBytes:  totalFreeBytes,
		})
	}

	if len(out) == 0 {
		log.Printf("aviso metrics: ningún volumen encontrado (máscara GetLogicalDrives=0x%08x)", mask)
	}

	return out
}

// hasPhysicalDevice usa QueryDosDevice para obtener el nombre NT del volumen.
// Los discos físicos (internos y USB externos) devuelven "\Device\HarddiskVolumeN".
// Las unidades virtuales (Google Drive, OneDrive, etc.) devuelven otros prefijos
// y se excluyen del informe.
func hasPhysicalDevice(mountpoint string) bool {
	vol := mountpoint
	for len(vol) > 0 && (vol[len(vol)-1] == '\\' || vol[len(vol)-1] == '/') {
		vol = vol[:len(vol)-1]
	}
	if len(vol) != 2 || vol[1] != ':' {
		return true
	}
	ptr, err := windows.UTF16PtrFromString(vol)
	if err != nil {
		return false
	}
	buf := make([]uint16, 512)
	r, _, _ := procQueryDosDeviceW.Call(
		uintptr(unsafe.Pointer(ptr)),
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
	)
	if r == 0 {
		return false
	}
	devPath := windows.UTF16ToString(buf)
	const prefix = `\Device\HarddiskVolu`
	return len(devPath) >= len(prefix) && devPath[:len(prefix)] == prefix
}

func collectUptime() int64 {
	bt, err := host.BootTime()
	if err != nil {
		log.Printf("aviso metrics: uptime: %v", err)
		return 0
	}
	return int64(time.Since(time.Unix(int64(bt), 0)).Seconds())
}

func collectSelf() report.AgentSelf {
	pid := int32(os.Getpid())
	p, err := process.NewProcess(pid)
	if err != nil {
		log.Printf("aviso metrics: autoconsumo proceso: %v", err)
		return report.AgentSelf{}
	}
	cpuPct, err := p.CPUPercent()
	if err != nil {
		log.Printf("aviso metrics: autoconsumo CPU: %v", err)
	}
	mi, err := p.MemoryInfo()
	if err != nil {
		log.Printf("aviso metrics: autoconsumo RAM: %v", err)
		return report.AgentSelf{CPUAvgPct: roundPct(cpuPct)}
	}
	return report.AgentSelf{
		CPUAvgPct: roundPct(cpuPct),
		MemBytes:  mi.RSS,
	}
}

func roundPct(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

// MetricsSample es una única muestra instantánea de CPU y RAM.
type MetricsSample struct {
	CPUpct float64
	MemPct float64
	At     time.Time
}

// TakeSample toma una muestra de CPU (ventana de 500 ms) y RAM.
// Bloquea aproximadamente 500 ms. No lanza procesos externos.
func TakeSample() MetricsSample {
	pcts, _ := cpu.Percent(500*time.Millisecond, false)
	cpuPct := 0.0
	if len(pcts) > 0 {
		cpuPct = pcts[0]
	}
	memPct := 0.0
	if vm, err := mem.VirtualMemory(); err == nil && vm.Total > 0 {
		memPct = float64(vm.Used) / float64(vm.Total) * 100
	}
	return MetricsSample{
		CPUpct: roundPct(cpuPct),
		MemPct: roundPct(memPct),
		At:     time.Now().UTC(),
	}
}

// AggregateSamples agrega un slice de muestras y devuelve un informe de métricas.
// Recolecta volúmenes, servicios, uptime y autoconsumo en el momento de la llamada.
func AggregateSamples(samples []MetricsSample, start, end time.Time, criticalServices []string) report.Metrics {
	var cpuSum, cpuMax, memSum, memMax float64
	for _, s := range samples {
		cpuSum += s.CPUpct
		if s.CPUpct > cpuMax {
			cpuMax = s.CPUpct
		}
		memSum += s.MemPct
		if s.MemPct > memMax {
			memMax = s.MemPct
		}
	}
	n := float64(len(samples))
	if n == 0 {
		n = 1
	}

	var memTotal uint64
	if vm, err := mem.VirtualMemory(); err == nil {
		memTotal = vm.Total
	}

	return report.Metrics{
		Type:        "metrics",
		PeriodStart: start.Format(time.RFC3339),
		PeriodEnd:   end.Format(time.RFC3339),
		Samples:     len(samples),
		CPU: report.MetricsCPU{
			AvgPct: roundPct(cpuSum / n),
			MaxPct: roundPct(cpuMax),
		},
		Memory: report.MetricsMemory{
			TotalBytes: memTotal,
			UsedAvgPct: roundPct(memSum / n),
			UsedMaxPct: roundPct(memMax),
		},
		Volumes:    collectVolumes(),
		Services:   collectServices(criticalServices, nil),
		UptimeSecs: collectUptime(),
		Agent:      collectSelf(),
	}
}

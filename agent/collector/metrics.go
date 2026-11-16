//go:build windows

package collector

import (
	"log"
	"os"
	"time"

	"github.com/enigma1980/vylax/agent/report"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"
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

func collectVolumes() []report.Volume {
	parts, err := disk.Partitions(false)
	if err != nil {
		log.Printf("aviso metrics: particiones: %v", err)
		return nil
	}
	out := make([]report.Volume, 0, len(parts))
	for _, p := range parts {
		usage, err := disk.Usage(p.Mountpoint)
		if err != nil {
			log.Printf("aviso metrics: uso disco %s: %v", p.Mountpoint, err)
			continue
		}
		label := volumeLabel(p.Mountpoint)
		out = append(out, report.Volume{
			Mount:      p.Mountpoint,
			Label:      label,
			FS:         p.Fstype,
			TotalBytes: usage.Total,
			FreeBytes:  usage.Free,
		})
	}
	return out
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

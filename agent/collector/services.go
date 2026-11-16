//go:build windows

package collector

import (
	"log"
	"strings"

	"github.com/enigma1980/vylax/agent/report"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc/mgr"
)

// collectServices devuelve los servicios críticos (con su estado) y los servicios
// de inicio automático que no están en marcha. Excluye servicios de inicio por
// desencadenador (trigger-start) y los de la lista ignoreServices.
func collectServices(criticalServices []string, ignoreServices []string) report.Services {
	m, err := mgr.Connect()
	if err != nil {
		log.Printf("aviso services: conectar SCM: %v", err)
		return report.Services{}
	}
	defer m.Disconnect()

	names, err := m.ListServices()
	if err != nil {
		log.Printf("aviso services: listar servicios: %v", err)
		return report.Services{}
	}

	ignoreSet := make(map[string]struct{}, len(ignoreServices))
	for _, s := range ignoreServices {
		ignoreSet[strings.ToLower(s)] = struct{}{}
	}
	criticalSet := make(map[string]struct{}, len(criticalServices))
	for _, s := range criticalServices {
		criticalSet[strings.ToLower(s)] = struct{}{}
	}

	var autoNotRunning []report.AutoNotRunningService
	var critical []report.CriticalService

	for _, name := range names {
		lname := strings.ToLower(name)
		if _, skip := ignoreSet[lname]; skip {
			continue
		}

		svc, err := m.OpenService(name)
		if err != nil {
			continue
		}

		cfg, err := svc.Config()
		if err != nil {
			svc.Close()
			continue
		}

		status, err := svc.Query()
		if err != nil {
			svc.Close()
			continue
		}

		isAuto := cfg.StartType == mgr.StartAutomatic
		isRunning := status.State == windows.SERVICE_RUNNING

		// Servicios trigger-start: arrancan solo cuando ocurre el evento correspondiente,
		// por diseño no están en marcha todo el tiempo. Se excluyen de auto_not_running.
		if isAuto && hasTriggerStart(name) {
			svc.Close()
			continue
		}

		if _, isCritical := criticalSet[lname]; isCritical {
			state := "stopped"
			if isRunning {
				state = "running"
			}
			critical = append(critical, report.CriticalService{Name: name, State: state})
		} else if isAuto && !isRunning {
			startType := "auto"
			if cfg.DelayedAutoStart {
				startType = "delayed"
			}
			autoNotRunning = append(autoNotRunning, report.AutoNotRunningService{
				Name:        name,
				DisplayName: cfg.DisplayName,
				Start:       startType,
				ExitCode:    status.Win32ExitCode,
			})
		}

		svc.Close()
	}

	return report.Services{
		Critical:       critical,
		AutoNotRunning: autoNotRunning,
	}
}

// hasTriggerStart comprueba si un servicio tiene triggers de inicio en el registro,
// lo que indica que solo arranca cuando se produce el evento correspondiente.
func hasTriggerStart(serviceName string) bool {
	path := `SYSTEM\CurrentControlSet\Services\` + serviceName + `\TriggerInfo`
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	k.Close()

	// Si la clave TriggerInfo existe, el servicio tiene al menos un trigger.
	// Verificamos que tenga subclaves (cada trigger es una subclave numerada).
	k2, err := registry.OpenKey(registry.LOCAL_MACHINE, path, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return false
	}
	defer k2.Close()
	subkeys, err := k2.ReadSubKeyNames(-1)
	return err == nil && len(subkeys) > 0
}

// volumeLabel obtiene la etiqueta de un volumen Windows (p.ej. "Sistema" para C:).
func volumeLabel(mountpoint string) string {
	mp := mountpoint
	if !strings.HasSuffix(mp, `\`) {
		mp += `\`
	}
	root, err := windows.UTF16PtrFromString(mp)
	if err != nil {
		return ""
	}
	var volName [windows.MAX_PATH + 1]uint16
	err = windows.GetVolumeInformation(root, &volName[0], uint32(len(volName)),
		nil, nil, nil, nil, 0)
	if err != nil {
		return ""
	}
	return windows.UTF16ToString(volName[:])
}

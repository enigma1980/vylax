//go:build windows

package service

import (
	"fmt"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

var (
	modAdvapi32              = windows.NewLazySystemDLL("advapi32.dll")
	procChangeServiceConfig2 = modAdvapi32.NewProc("ChangeServiceConfig2W")
)

const (
	serviceConfigPreshutdownInfo = 9 // SERVICE_CONFIG_PRESHUTDOWN_INFO
	serviceConfigDescription     = 1 // SERVICE_CONFIG_DESCRIPTION
)

type servicePreshutdownInfo struct {
	PreshutdownTimeout uint32
}

type serviceDescription struct {
	Description *uint16
}

// Install crea el servicio VylaxAgent con inicio automático retrasado y política de recuperación.
func Install(exePath string) error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("conectar con SCM: %w", err)
	}
	defer m.Disconnect()

	// Comprobar si ya existe.
	if s, err := m.OpenService(ServiceName); err == nil {
		s.Close()
		return fmt.Errorf("el servicio '%s' ya está instalado; desinstálalo primero con: service uninstall", ServiceName)
	}

	s, err := m.CreateService(ServiceName, exePath, mgr.Config{
		DisplayName: ServiceDisplayName,
		StartType:   mgr.StartAutomatic,
		ServiceType: windows.SERVICE_WIN32_OWN_PROCESS,
	})
	if err != nil {
		return fmt.Errorf("crear servicio: %w", err)
	}
	defer s.Close()

	// Descripción.
	if err := setServiceDescription(s.Handle, ServiceDescription); err != nil {
		// No fatal.
		_ = err
	}

	// Inicio automático retrasado (arranca después de los servicios esenciales).
	if cfg, err := s.Config(); err == nil {
		cfg.DelayedAutoStart = true
		_ = s.UpdateConfig(cfg)
	}

	// Política de recuperación: reiniciar tras 1 min en 1.º, 2.º y sucesivos fallos.
	// Resetear el contador de fallos al cabo de 1 día.
	if err := s.SetRecoveryActions([]mgr.RecoveryAction{
		{Type: mgr.ServiceRestart, Delay: 1 * time.Minute},
		{Type: mgr.ServiceRestart, Delay: 1 * time.Minute},
		{Type: mgr.ServiceRestart, Delay: 1 * time.Minute},
	}, 86400); err != nil {
		// No fatal; el servicio sigue funcionando sin política de recuperación.
		_ = err
	}

	// Preshutdown timeout: 15 000 ms (el servicio tiene 15 s para enviar evento y parar).
	if err := setPreshutdownTimeout(s.Handle, 15000); err != nil {
		_ = err
	}

	return nil
}

// Uninstall elimina el servicio. Debe estar detenido previamente.
func Uninstall() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("conectar con SCM: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(ServiceName)
	if err != nil {
		return fmt.Errorf("servicio no encontrado: %w", err)
	}
	defer s.Close()

	st, err := s.Query()
	if err == nil && st.State != svc.Stopped {
		return fmt.Errorf("detén el servicio antes de desinstalarlo: vylax-agent.exe service stop")
	}

	return s.Delete()
}

// Start arranca el servicio.
func Start() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("conectar con SCM: %w", err)
	}
	defer m.Disconnect()
	s, err := m.OpenService(ServiceName)
	if err != nil {
		return fmt.Errorf("servicio no encontrado: %w", err)
	}
	defer s.Close()
	return s.Start()
}

// Stop envía la señal de parada al servicio.
func Stop() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("conectar con SCM: %w", err)
	}
	defer m.Disconnect()
	s, err := m.OpenService(ServiceName)
	if err != nil {
		return fmt.Errorf("servicio no encontrado: %w", err)
	}
	defer s.Close()
	_, err = s.Control(svc.Stop)
	return err
}

// QueryStatus devuelve el estado del servicio como cadena legible.
func QueryStatus() (string, error) {
	m, err := mgr.Connect()
	if err != nil {
		return "", fmt.Errorf("conectar con SCM: %w", err)
	}
	defer m.Disconnect()
	s, err := m.OpenService(ServiceName)
	if err != nil {
		return "", fmt.Errorf("servicio no encontrado (¿instalado?): %w", err)
	}
	defer s.Close()
	st, err := s.Query()
	if err != nil {
		return "", err
	}
	return serviceStateString(st.State), nil
}

func serviceStateString(state svc.State) string {
	switch state {
	case svc.Stopped:
		return "detenido"
	case svc.StartPending:
		return "iniciando"
	case svc.StopPending:
		return "deteniéndose"
	case svc.Running:
		return "en ejecución"
	case svc.ContinuePending:
		return "reanudando"
	case svc.PausePending:
		return "pausando"
	case svc.Paused:
		return "pausado"
	default:
		return fmt.Sprintf("estado desconocido (%d)", state)
	}
}

func setPreshutdownTimeout(handle windows.Handle, timeoutMs uint32) error {
	info := servicePreshutdownInfo{PreshutdownTimeout: timeoutMs}
	r, _, err := procChangeServiceConfig2.Call(
		uintptr(handle),
		serviceConfigPreshutdownInfo,
		uintptr(unsafe.Pointer(&info)),
	)
	if r == 0 {
		return fmt.Errorf("ChangeServiceConfig2 preshutdown: %w", err)
	}
	return nil
}

func setServiceDescription(handle windows.Handle, desc string) error {
	descW, err := windows.UTF16PtrFromString(desc)
	if err != nil {
		return err
	}
	info := serviceDescription{Description: descW}
	r, _, err := procChangeServiceConfig2.Call(
		uintptr(handle),
		serviceConfigDescription,
		uintptr(unsafe.Pointer(&info)),
	)
	if r == 0 {
		return fmt.Errorf("ChangeServiceConfig2 description: %w", err)
	}
	return nil
}

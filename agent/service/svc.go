//go:build windows

package service

import (
	"context"
	"time"

	"golang.org/x/sys/windows/svc"

	"github.com/enigma1980/vylax/agent/client"
	"github.com/enigma1980/vylax/agent/logger"
	"github.com/enigma1980/vylax/agent/report"
	"github.com/enigma1980/vylax/agent/scheduler"
)

// Constantes de eventos de energía de Windows (WM_POWERBROADCAST wParam).
const (
	pbtApmSuspend         = 0x0004 // PBT_APMSUSPEND: el sistema va a suspenderse
	pbtApmResumeSuspend   = 0x0007 // PBT_APMRESUMESUSPEND: reanudación tras suspensión manual
	pbtApmResumeAutomatic = 0x0012 // PBT_APMRESUMEAUTOMATIC: reanudación automática (inicio rápido, temporizador)
)

const (
	ServiceName        = "GuaitiqAgent"
	ServiceDisplayName = "Guaitiq Agent"
	ServiceDescription = "Monitorización remota de equipos Windows"
)

type guaitiqSvc struct {
	hc           *client.Client
	cfg          *client.LocalConfig
	log          *logger.Logger
	agentVer     string
	sched        *scheduler.Scheduler // asignado al inicio de Execute, antes del bucle de eventos
	lastResumeAt time.Time            // para deduplicar PBT_APMRESUME* dentro de 60 s
}

func (s *guaitiqSvc) Execute(args []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (svcSpecificEC bool, exitCode uint32) {
	const accepted = svc.AcceptStop | svc.AcceptShutdown | svc.AcceptPreShutdown | svc.AcceptPowerEvent

	status <- svc.Status{State: svc.StartPending}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	sched := scheduler.New(s.hc, s.cfg, s.log, s.agentVer, false)
	// El handler del servicio (Execute) es el único que decide qué evento de
	// parada se envía. El bucle Run no debe enviar nada al cancelar el contexto.
	sched.DisableShutdownEvent()
	// Guardar referencia antes del bucle para que el handler de POWEREVENT pueda usarla.
	s.sched = sched
	go func() {
		defer close(done)
		sched.Run(ctx)
	}()

	status <- svc.Status{State: svc.Running, Accepts: accepted}
	s.log.Printf("servicio en marcha (v%s)", s.agentVer)

	for c := range r {
		switch c.Cmd {
		case svc.Interrogate:
			status <- c.CurrentStatus

		case svc.Stop:
			status <- svc.Status{State: svc.StopPending, WaitHint: 12000}
			// Solo enviar service_stopped si no forma parte de una desinstalación/actualización.
			if m := client.ReadUninstallMarker(); m == nil {
				s.log.Printf("STOP recibido (manual); enviando service_stopped")
				sendEventWithTimeout(s.hc, s.agentVer, "service_stopped", nil, 10*time.Second, s.log)
			} else {
				s.log.Printf("STOP recibido (desinstalación reason=%s); omitiendo service_stopped", m.Reason)
			}
			cancel()
			<-done
			return false, 0

		case svc.PreShutdown:
			// Windows nos da 15 s configurados en SERVICE_CONFIG_PRESHUTDOWN_INFO.
			status <- svc.Status{State: svc.StopPending, WaitHint: 15000}
			s.log.Printf("PRESHUTDOWN recibido; enviando shutdown (máx 5 s)")
			sendEventWithTimeout(s.hc, s.agentVer, "shutdown", nil, 5*time.Second, s.log)
			cancel()
			<-done
			return false, 0

		case svc.Shutdown:
			// Sin tiempo para red; guardar en caché y salir de inmediato.
			s.log.Printf("SHUTDOWN recibido; guardando en caché y saliendo")
			saveEventToCache(s.agentVer, "shutdown")
			cancel()
			return false, 0

		case svc.PowerEvent:
			switch c.EventType {
			case pbtApmSuspend:
				// Envío rápido del evento suspend (máx 3 s) o caché si no hay red.
				s.log.Printf("SUSPEND recibido; enviando evento suspend (máx 3 s)")
				sendEventWithTimeout(s.hc, s.agentVer, "suspend", nil, 3*time.Second, s.log)
			case pbtApmResumeSuspend, pbtApmResumeAutomatic:
				// Windows envía los dos avisos de reanudación (tipo 7 y 18) con pocos
				// segundos de diferencia. Solo procesamos el primero en cada ventana de 60 s.
				if time.Since(s.lastResumeAt) < 60*time.Second {
					s.log.Printf("RESUME tipo %d ignorado (deduplicado; último hace %s)",
						c.EventType, time.Since(s.lastResumeAt).Round(time.Second))
				} else {
					s.lastResumeAt = time.Now()
					s.log.Printf("RESUME recibido (tipo %d); notificando al scheduler", c.EventType)
					if s.sched != nil {
						s.sched.NotifyResume()
					}
				}
			}
			status <- c.CurrentStatus
		}
	}
	return false, 0
}

// RunAsService arranca el bucle del agente como servicio de Windows.
func RunAsService(hc *client.Client, cfg *client.LocalConfig, log *logger.Logger, ver string) error {
	return svc.Run(ServiceName, &guaitiqSvc{hc: hc, cfg: cfg, log: log, agentVer: ver})
}

// sendEventWithTimeout envía un evento con timeout; si falla lo guarda en caché.
func sendEventWithTimeout(hc *client.Client, agentVer, eventName string, data map[string]any, timeout time.Duration, log *logger.Logger) {
	env := buildEventEnvelope(agentVer, eventName, data)
	type res struct {
		outcome client.SendOutcome
		err     error
	}
	ch := make(chan res, 1)
	go func() {
		o, _, e := hc.SendReports(env)
		ch <- res{o, e}
	}()
	select {
	case r := <-ch:
		if r.outcome.Result != client.SendOK {
			log.Printf("evento '%s' no enviado (%v); guardado en caché", eventName, r.err)
			_ = client.SaveToCache(env, 10)
		}
	case <-time.After(timeout):
		log.Printf("timeout enviando '%s'; guardado en caché", eventName)
		_ = client.SaveToCache(env, 10)
	}
}

func saveEventToCache(agentVer, eventName string) {
	env := buildEventEnvelope(agentVer, eventName, nil)
	_ = client.SaveToCache(env, 10)
}

func buildEventEnvelope(agentVer, eventName string, data map[string]any) *report.Envelope {
	now := time.Now().UTC().Format(time.RFC3339)
	return &report.Envelope{
		SchemaVersion: 1,
		AgentVersion:  agentVer,
		SentAt:        now,
		Reports: []report.Report{report.Event{
			Type:       "event",
			Event:      eventName,
			OccurredAt: now,
			Data:       data,
		}},
	}
}

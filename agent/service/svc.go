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

const (
	ServiceName        = "VylaxAgent"
	ServiceDisplayName = "Vylax Agent"
	ServiceDescription = "Monitorización remota de equipos Windows"
)

type vylaxSvc struct {
	hc       *client.Client
	cfg      *client.LocalConfig
	log      *logger.Logger
	agentVer string
}

func (s *vylaxSvc) Execute(args []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (svcSpecificEC bool, exitCode uint32) {
	const accepted = svc.AcceptStop | svc.AcceptShutdown | svc.AcceptPreShutdown

	status <- svc.Status{State: svc.StartPending}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	sched := scheduler.New(s.hc, s.cfg, s.log, s.agentVer, false)
	// El handler del servicio (Execute) es el único que decide qué evento de
	// parada se envía. El bucle Run no debe enviar nada al cancelar el contexto.
	sched.DisableShutdownEvent()
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
		}
	}
	return false, 0
}

// RunAsService arranca el bucle del agente como servicio de Windows.
func RunAsService(hc *client.Client, cfg *client.LocalConfig, log *logger.Logger, ver string) error {
	return svc.Run(ServiceName, &vylaxSvc{hc: hc, cfg: cfg, log: log, agentVer: ver})
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

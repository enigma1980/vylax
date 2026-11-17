//go:build windows

package scheduler

import (
	"context"
	"math/rand"
	"time"

	"github.com/enigma1980/vylax/agent/client"
	"github.com/enigma1980/vylax/agent/collector"
	"github.com/enigma1980/vylax/agent/logger"
	"github.com/enigma1980/vylax/agent/report"
)

// defaultSrvConfig se usa cuando el servidor no está disponible al arrancar.
var defaultSrvConfig = report.ConfigResponse{
	ConfigVersion: 0,
	Intervals: report.ConfigIntervals{
		SampleS:  30,
		MetricsS: 300,
		StatusS:  3600,
		DailyS:   86400,
	},
	JitterS:             60,
	MeteredIntervalMult: 3,
	OfflineCacheMaxMB:   10,
	SelfLimits:          report.SelfLimits{CPUAvgPct: 1.0, MemMB: 40},
}

// Scheduler gestiona el calendario de muestras y envíos del agente.
type Scheduler struct {
	hc       *client.Client
	localCfg *client.LocalConfig
	srvCfg   report.ConfigResponse
	log      *logger.Logger
	agentVer string
	fast     bool

	// buffer de muestras para el informe de métricas
	samples     []collector.MetricsSample
	periodStart time.Time

	// marcas de tiempo del último envío por tipo
	lastStatusSent time.Time
	lastDailySent  time.Time

	// inventario más reciente (recogido en warmup y una vez al día)
	invHash string
	invData *report.Inventory

	// estado de envío
	blockedUntil time.Time // 401 (6 h) o 429 (Retry-After)
	stopped      bool      // 410: parar definitivamente

	// condiciones para tareas pesadas
	onBattery     bool      // actualizado en cada doSendStatus
	metered       bool      // actualizado en cada doSendStatus
	heavyPending  bool      // la tarea pesada está pendiente (aplazada por CPU/batería)
	heavyDeadline time.Time // plazo máximo desde que tocó la tarea (6 h)

	// shutdownEventDisabled indica que los eventos de ciclo de vida de parada
	// los gestiona el handler del servicio, no el bucle Run.
	shutdownEventDisabled bool
}

// DisableShutdownEvent indica al scheduler que no envíe el evento de parada
// cuando el contexto se cancela. Debe llamarse en modo servicio, donde el
// handler del servicio es el único responsable de los eventos de ciclo de vida.
func (s *Scheduler) DisableShutdownEvent() {
	s.shutdownEventDisabled = true
}

// New crea un Scheduler.
func New(hc *client.Client, localCfg *client.LocalConfig, log *logger.Logger, agentVer string, fast bool) *Scheduler {
	s := &Scheduler{
		hc:       hc,
		localCfg: localCfg,
		srvCfg:   defaultSrvConfig,
		log:      log,
		agentVer: agentVer,
		fast:     fast,
	}
	if localCfg.ConfigVersion > 0 {
		s.srvCfg.ConfigVersion = localCfg.ConfigVersion
	}
	return s
}

// Run es el bucle principal del agente. Bloquea hasta que ctx se cancela.
func (s *Scheduler) Run(ctx context.Context) {
	// Obtener config del servidor al arrancar
	if cfg, err := s.hc.GetConfig(); err == nil {
		s.applyConfig(cfg)
	} else {
		s.log.Printf("config inicial no disponible: %v (usando por defecto)", err)
	}

	intervals := s.effectiveIntervals()
	sampleD := time.Duration(intervals.SampleS) * time.Second

	// Jitter inicial (omitido en --fast)
	if !s.fast && s.srvCfg.JitterS > 0 {
		jitter := time.Duration(rand.Intn(s.srvCfg.JitterS+1)) * time.Second
		s.log.Printf("jitter inicial: %s", jitter)
		select {
		case <-ctx.Done():
			if !s.shutdownEventDisabled {
				s.sendEvent(ctx, "shutdown", nil)
			}
			return
		case <-time.After(jitter):
		}
	}

	// Evento de arranque
	s.sendEvent(ctx, "started", nil)

	// Status inmediato al arrancar (también actualiza onBattery y metered)
	s.log.Printf("enviando status inicial...")
	s.doSendStatus(ctx)
	s.lastStatusSent = time.Now()

	// Drenar caché de sesión anterior
	s.drainCache(ctx)

	// Warmup basado en el uptime de Windows (no del agente).
	// Si Windows lleva > 10 min encendido, warmupDelay = 0 (arranca tareas pesadas de inmediato).
	warmupTarget := 10 * time.Minute
	if s.fast {
		warmupTarget = 1 * time.Minute
	}
	winUptime := collector.WindowsUptime()
	warmupDelay := warmupTarget - winUptime
	if warmupDelay < 0 {
		warmupDelay = 0
	}
	s.log.Printf("agente activo (sample=%ds metrics=%ds status=%ds daily=%ds uptime=%s warmupDelay=%s fast=%v)",
		intervals.SampleS, intervals.MetricsS, intervals.StatusS, intervals.DailyS,
		winUptime.Round(time.Second), warmupDelay.Round(time.Second), s.fast)

	warmupTimer := time.NewTimer(warmupDelay)
	defer warmupTimer.Stop()
	warmupDone := warmupDelay == 0

	ticker := time.NewTicker(sampleD)
	defer ticker.Stop()
	s.periodStart = time.Now().UTC()

	// Si warmupDelay==0 el timer ya expiró antes de entrar al loop;
	// ejecutar la tarea pesada inicial directamente.
	if warmupDone {
		s.log.Printf("warmup completado (uptime=%s); programando tarea pesada...", winUptime.Round(time.Second))
		s.scheduleHeavy(ctx)
	}

	for {
		select {
		case <-ctx.Done():
			// En modo servicio, el handler Execute gestiona el evento de parada.
			// En modo run (Ctrl+C) sí lo enviamos.
			if !s.shutdownEventDisabled {
				s.sendEvent(ctx, "shutdown", nil)
			}
			return

		case <-warmupTimer.C:
			if !warmupDone {
				warmupDone = true
				s.log.Printf("warmup completado; programando tarea pesada...")
				s.scheduleHeavy(ctx)
			}

		case now := <-ticker.C:
			if s.stopped {
				continue
			}

			// Tomar muestra (siempre, incluso en pausa de red)
			smpl := collector.TakeSample()
			s.samples = append(s.samples, smpl)

			if !s.blockedUntil.IsZero() && now.Before(s.blockedUntil) {
				// En pausa (401/429): acumular muestras pero no enviar
				continue
			}

			// Recalcular intervalos cada tick (puede cambiar si metered cambia)
			curr := s.effectiveIntervals()
			samplesPerBatch := curr.MetricsS / curr.SampleS
			if samplesPerBatch < 1 {
				samplesPerBatch = 1
			}
			statusD := time.Duration(curr.StatusS) * time.Second
			dailyD := time.Duration(curr.DailyS) * time.Second

			// Métricas: ¿suficientes muestras acumuladas?
			if len(s.samples) >= samplesPerBatch {
				mr := collector.AggregateSamples(s.samples, s.periodStart, now.UTC(), s.srvCfg.CriticalServices)
				s.samples = nil
				s.periodStart = now.UTC()
				s.doSend(ctx, []report.Report{mr})
			}

			// Status
			if time.Since(s.lastStatusSent) >= statusD {
				s.doSendStatus(ctx)
				s.lastStatusSent = time.Now()
			}

			// Tarea pesada (solo tras warmup)
			if warmupDone {
				// ¿Toca hacer la tarea y aún no está pendiente?
				if !s.heavyPending && time.Since(s.lastDailySent) >= dailyD {
					s.scheduleHeavy(ctx)
				}
				// ¿Está pendiente? Intentar si las condiciones se cumplen o si se pasó el plazo.
				if s.heavyPending {
					forceDue := !s.heavyDeadline.IsZero() && time.Now().After(s.heavyDeadline)
					if forceDue {
						s.log.Printf("plazo de tarea pesada alcanzado (6 h), ejecutando igualmente")
						s.doHeavyCollection(ctx)
					} else if s.heavyReady() {
						s.doHeavyCollection(ctx)
					}
				}
			}
		}
	}
}

// scheduleHeavy marca la tarea pesada como pendiente y establece el plazo de 6 h.
// Si las condiciones ya son buenas, la ejecuta de inmediato.
func (s *Scheduler) scheduleHeavy(ctx context.Context) {
	s.heavyPending = true
	s.heavyDeadline = time.Now().Add(6 * time.Hour)
	if s.heavyReady() {
		s.doHeavyCollection(ctx)
	} else {
		s.log.Printf("tarea pesada aplazada (CPU>30%% o batería); plazo en 6 h")
	}
}

// heavyReady devuelve true si las condiciones permiten ejecutar la tarea pesada:
// no en batería y CPU < 30%.
func (s *Scheduler) heavyReady() bool {
	if s.onBattery {
		return false
	}
	pct := collector.QuickCPUPercent()
	if pct >= 30.0 {
		s.log.Printf("tarea pesada: CPU %.1f%% (>30%%), aplazando", pct)
		return false
	}
	return true
}

// doHeavyCollection recoge inventario y daily, los envía y gestiona request_inventory.
func (s *Scheduler) doHeavyCollection(ctx context.Context) {
	s.heavyPending = false
	s.heavyDeadline = time.Time{}

	inv, invHash := collector.CollectInventory()
	s.invHash = invHash
	invCopy := inv
	s.invData = &invCopy

	daily := collector.CollectDaily()
	rsp := s.doSend(ctx, []report.Report{daily})
	s.lastDailySent = time.Now()

	if rsp != nil && rsp.RequestInventory {
		s.log.Printf("servidor solicita inventario completo, enviando...")
		s.doSend(ctx, []report.Report{s.invData})
	}
}

// doSendStatus recoge y envía un informe de estado; actualiza onBattery y metered.
func (s *Scheduler) doSendStatus(ctx context.Context) {
	status := collector.CollectStatus(s.invHash)
	s.onBattery = status.OnBattery
	s.metered = status.MeteredConnection
	rsp := s.doSend(ctx, []report.Report{status})
	if rsp != nil && rsp.RequestInventory && s.invData != nil {
		s.log.Printf("servidor solicita inventario completo, enviando...")
		s.doSend(ctx, []report.Report{s.invData})
	}
}

// doSend construye un Envelope, lo envía y gestiona la respuesta y los errores.
// Devuelve la respuesta del servidor o nil si el envío falló.
func (s *Scheduler) doSend(ctx context.Context, reports []report.Report) *report.ReportsResponse {
	if s.stopped {
		return nil
	}
	env := &report.Envelope{
		SchemaVersion: 1,
		AgentVersion:  s.agentVer,
		SentAt:        time.Now().UTC().Format(time.RFC3339),
		Reports:       reports,
	}
	// En pausa (401/429): guardar en caché sin intentar enviar
	if !s.blockedUntil.IsZero() && time.Now().Before(s.blockedUntil) {
		s.saveToCache(env)
		return nil
	}

	outcome, rsp, err := s.hc.SendReports(env)
	switch outcome.Result {
	case client.SendOK:
		s.log.Printf("enviado OK (%d informe(s))", len(reports))
		if rsp.ConfigVersion > s.srvCfg.ConfigVersion {
			s.log.Printf("config nueva disponible (v%d→v%d), descargando...", s.srvCfg.ConfigVersion, rsp.ConfigVersion)
			if cfg, err := s.hc.GetConfig(); err == nil {
				s.applyConfig(cfg)
			} else {
				s.log.Printf("error al descargar config: %v", err)
			}
		}
		s.drainCache(ctx)
		return rsp

	case client.Send401:
		s.log.Printf("credencial revocada (401); pausa 6 h. %v", err)
		s.blockedUntil = time.Now().Add(6 * time.Hour)
		s.saveToCache(env)

	case client.Send410:
		s.log.Printf("equipo eliminado en el panel (410). El agente dejará de enviar datos.")
		s.stopped = true

	case client.Send429:
		s.log.Printf("tasa limitada (429); pausa %s. %v", outcome.RetryAfter, err)
		s.blockedUntil = time.Now().Add(outcome.RetryAfter)
		s.saveToCache(env)

	default: // SendRetry: 5xx o sin red
		s.log.Printf("error temporal (%v); guardando en caché", err)
		s.saveToCache(env)
	}
	return nil
}

// sendEvent envía un evento de ciclo de vida (best-effort; en caso de fallo, lo guarda en caché).
func (s *Scheduler) sendEvent(ctx context.Context, event string, data map[string]any) {
	env := &report.Envelope{
		SchemaVersion: 1,
		AgentVersion:  s.agentVer,
		SentAt:        time.Now().UTC().Format(time.RFC3339),
		Reports: []report.Report{report.Event{
			Type:       "event",
			Event:      event,
			OccurredAt: time.Now().UTC().Format(time.RFC3339),
			Data:       data,
		}},
	}
	outcome, _, err := s.hc.SendReports(env)
	if outcome.Result == client.SendOK {
		s.log.Printf("evento '%s' enviado", event)
	} else {
		s.log.Printf("evento '%s' no enviado (%v); guardado en caché", event, err)
		s.saveToCache(env)
	}
}

// drainCache intenta enviar los archivos de caché acumulados (del más antiguo al más nuevo).
func (s *Scheduler) drainCache(ctx context.Context) {
	files, err := client.CacheFiles()
	if err != nil || len(files) == 0 {
		return
	}
	s.log.Printf("drenando caché: %d archivo(s)...", len(files))
	drained := 0
	for _, f := range files {
		select {
		case <-ctx.Done():
			return
		default:
		}
		raw, err := client.ReadCacheFile(f)
		if err != nil {
			s.log.Printf("caché corrupto %s: %v (eliminando)", f, err)
			_ = client.DeleteCacheFile(f)
			continue
		}
		outcome, _, err := s.hc.SendCachedFile(raw)
		switch outcome.Result {
		case client.SendOK:
			_ = client.DeleteCacheFile(f)
			drained++
		case client.Send422:
			s.log.Printf("sobre inválido %s (422); moviendo a invalid/", f)
			if mvErr := client.MoveToInvalid(f); mvErr != nil {
				s.log.Printf("error al mover a invalid: %v", mvErr)
				_ = client.DeleteCacheFile(f)
			}
		default:
			s.log.Printf("no se pudo vaciar caché (%v); reintentará en el siguiente ciclo", err)
			return
		}
	}
	if drained > 0 {
		s.log.Printf("caché vaciada: %d archivo(s) enviados", drained)
	}
}

func (s *Scheduler) saveToCache(env *report.Envelope) {
	maxMB := s.srvCfg.OfflineCacheMaxMB
	if maxMB <= 0 {
		maxMB = 10
	}
	if err := client.SaveToCache(env, maxMB); err != nil {
		s.log.Printf("error al guardar en caché: %v", err)
	}
}

func (s *Scheduler) applyConfig(cfg *report.ConfigResponse) {
	s.srvCfg = *cfg
	s.localCfg.ConfigVersion = cfg.ConfigVersion
	if err := client.SaveConfig(s.localCfg); err != nil {
		s.log.Printf("advertencia: no se pudo guardar config_version: %v", err)
	}
	s.log.Printf("config actualizada: v%d (sample=%ds metrics=%ds status=%ds daily=%ds)",
		cfg.ConfigVersion, cfg.Intervals.SampleS, cfg.Intervals.MetricsS,
		cfg.Intervals.StatusS, cfg.Intervals.DailyS)
}

// effectiveIntervals devuelve los intervalos activos, ajustados si la conexión es medida.
// En conexión medida, se multiplican MetricsS y StatusS (no el daily ni las muestras).
func (s *Scheduler) effectiveIntervals() report.ConfigIntervals {
	if s.fast {
		return report.ConfigIntervals{
			SampleS:  30,
			MetricsS: 60,
			StatusS:  60,
			DailyS:   300,
		}
	}
	i := s.srvCfg.Intervals
	if i.SampleS <= 0 {
		i.SampleS = 30
	}
	if i.MetricsS <= 0 {
		i.MetricsS = 300
	}
	if i.StatusS <= 0 {
		i.StatusS = 3600
	}
	if i.DailyS <= 0 {
		i.DailyS = 86400
	}
	// Conexión medida: multiplicar métricas y estado (no las muestras ni el daily).
	if s.metered && s.srvCfg.MeteredIntervalMult > 1 {
		mult := s.srvCfg.MeteredIntervalMult
		i.MetricsS *= mult
		i.StatusS *= mult
	}
	return i
}


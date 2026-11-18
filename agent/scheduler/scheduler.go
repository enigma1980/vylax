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

	// heavyRunning indica que la recogida pesada está en marcha en segundo plano.
	// heavyResultCh recibe el resultado cuando termina.
	heavyRunning  bool
	heavyResultCh chan heavyResult

	// resumeWarmupUntil retrasa las tareas pesadas 10 min tras una reanudación.
	resumeWarmupUntil time.Time
	// resumeCh recibe una señal cuando el servicio detecta PBT_APMRESUME*.
	resumeCh chan struct{}
}

// heavyResult empaqueta los datos recogidos en segundo plano por doHeavyCollection.
type heavyResult struct {
	inv     report.Inventory
	invHash string
	daily   report.Daily
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
		hc:            hc,
		localCfg:      localCfg,
		srvCfg:        defaultSrvConfig,
		log:           log,
		agentVer:      agentVer,
		fast:          fast,
		heavyResultCh: make(chan heavyResult, 1),
		resumeCh:      make(chan struct{}, 1),
	}
	if localCfg.ConfigVersion > 0 {
		s.srvCfg.ConfigVersion = localCfg.ConfigVersion
	}
	// Cargar fecha del último daily para no repetirlo si el agente se reinicia
	// antes de que hayan pasado 24 h.
	if ts, err := client.LoadTimestamps(); err == nil && ts != nil && ts.LastDailyAt != "" {
		if t, err := time.Parse(time.RFC3339, ts.LastDailyAt); err == nil {
			s.lastDailySent = t
			log.Printf("timestamps cargados: último daily %s", t.Format(time.RFC3339))
		}
	}
	return s
}

// NotifyResume señala al scheduler que el sistema ha reanudado tras una suspensión.
// Se llama desde el handler del servicio en respuesta a PBT_APMRESUME*.
// No bloquea: si el canal ya tiene una señal pendiente, se descarta la nueva.
func (s *Scheduler) NotifyResume() {
	select {
	case s.resumeCh <- struct{}{}:
	default:
	}
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

		case <-s.resumeCh:
			s.log.Printf("RESUME: enviando status inmediato y aplicando warmup de 10 min para tareas pesadas")
			s.doSendStatus(ctx)
			s.lastStatusSent = time.Now()
			s.resumeWarmupUntil = time.Now().Add(10 * time.Minute)

		case hr := <-s.heavyResultCh:
			// La goroutine de recogida pesada ha terminado.
			s.heavyRunning = false
			invCopy := hr.inv
			s.invData = &invCopy
			s.invHash = hr.invHash
			rsp := s.doSend(ctx, []report.Report{hr.daily})
			s.lastDailySent = time.Now()
			// Persistir la fecha para no repetir el daily si el agente se reinicia.
			if ts, err := client.LoadTimestamps(); err == nil {
				if ts == nil {
					ts = &client.Timestamps{}
				}
				ts.LastDailyAt = s.lastDailySent.UTC().Format(time.RFC3339)
				if s.invData != nil {
					ts.LastInventoryAt = s.lastDailySent.UTC().Format(time.RFC3339)
				}
				if err := client.SaveTimestamps(ts); err != nil {
					s.log.Printf("advertencia: no se pudo guardar timestamps: %v", err)
				}
			}
			if rsp != nil && rsp.RequestInventory && s.invData != nil {
				s.log.Printf("servidor solicita inventario completo, enviando...")
				s.doSend(ctx, []report.Report{s.invData})
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
				// ¿Toca hacer la tarea, no está pendiente y no está ya en curso?
				if !s.heavyPending && !s.heavyRunning && time.Since(s.lastDailySent) >= dailyD {
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
// no en batería, CPU < 30% y fuera del período de warmup post-resume.
func (s *Scheduler) heavyReady() bool {
	if s.onBattery {
		return false
	}
	if !s.resumeWarmupUntil.IsZero() && time.Now().Before(s.resumeWarmupUntil) {
		return false
	}
	pct := collector.QuickCPUPercent()
	if pct >= 30.0 {
		s.log.Printf("tarea pesada: CPU %.1f%% (>30%%), aplazando", pct)
		return false
	}
	return true
}

// doHeavyCollection lanza la recogida de inventario y daily en segundo plano
// para no bloquear el bucle principal de métricas. El resultado llega al select
// de Run() a través de heavyResultCh. Los envíos de red se hacen siempre desde
// el bucle principal, donde no hay concurrencia sobre el estado del scheduler.
func (s *Scheduler) doHeavyCollection(ctx context.Context) {
	if s.heavyRunning {
		s.log.Printf("AVISO: recogida pesada anterior aún en curso; omitiendo nueva solicitud")
		return
	}
	s.heavyRunning = true
	s.heavyPending = false
	s.heavyDeadline = time.Time{}

	s.log.Printf("iniciando recogida pesada en segundo plano (inventory + daily)...")
	go func() {
		inv, invHash := collector.CollectInventory()
		daily := collector.CollectDaily()
		select {
		case s.heavyResultCh <- heavyResult{inv: inv, invHash: invHash, daily: daily}:
		case <-ctx.Done():
			// El scheduler se está apagando; resultado descartado.
		}
	}()
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

	case client.Send422:
		// 422 no es transitorio: el sobre no mejorará reintentando.
		// Se mueve directamente a cache\invalid\ para no reintentar.
		s.log.Printf("informe rechazado como inválido (422): %v", err)
		if err2 := client.SaveInvalidDirect(env); err2 != nil {
			s.log.Printf("error al guardar en invalid/: %v", err2)
		}

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


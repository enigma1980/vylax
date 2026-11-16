//go:build windows

package collector

import (
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"
	"unsafe"

	"github.com/enigma1980/vylax/agent/report"
	"github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
	"github.com/yusufpapurcu/wmi"
)

func CollectDaily() report.Daily {
	now := time.Now().UTC()
	return report.Daily{
		Type:          "daily",
		CollectedAt:   now.Format(time.RFC3339),
		PhysicalDisks: collectDiskHealth(),
		WindowsUpdate: collectWindowsUpdate(),
	}
}

// --- SMART / salud de discos ---

type msftPhysicalDisk struct {
	DeviceId     string // número de disco ("0", "1"…)
	SerialNumber string
	HealthStatus uint16
}

type msftReliabilityCounter struct {
	DeviceId    string // coincide con MSFT_PhysicalDisk.DeviceId
	Temperature uint32
	Wear        uint32
}

type msStorageFailurePredict struct {
	PredictFailure bool
	InstanceName   string
}

var healthStatusNames = map[uint16]string{
	0: "Healthy", 1: "Warning", 2: "Unhealthy",
}

func collectDiskHealth() []report.DiskHealth {
	var disks []msftPhysicalDisk
	if err := wmi.QueryNamespace(
		"SELECT DeviceId, SerialNumber, HealthStatus FROM MSFT_PhysicalDisk",
		&disks, `ROOT\Microsoft\Windows\Storage`); err != nil {
		log.Printf("aviso daily: MSFT_PhysicalDisk: %v", err)
		return nil
	}

	// Contadores de fiabilidad. DeviceId en ambas tablas identifica el mismo disco.
	var reliab []msftReliabilityCounter
	if err := wmi.QueryNamespace(
		"SELECT DeviceId, Temperature, Wear FROM MSFT_StorageReliabilityCounter",
		&reliab, `ROOT\Microsoft\Windows\Storage`); err != nil {
		log.Printf("aviso daily: MSFT_StorageReliabilityCounter: %v", err)
	}
	// Indexamos por DeviceId normalizado (sin espacios) para robustez.
	reliabMap := make(map[string]msftReliabilityCounter, len(reliab))
	for _, r := range reliab {
		reliabMap[strings.TrimSpace(r.DeviceId)] = r
	}

	// Predicción de fallo SMART. InstanceName contiene el modelo/serie del disco.
	var failPred []msStorageFailurePredict
	if err := wmi.QueryNamespace(
		"SELECT PredictFailure, InstanceName FROM MSStorageDriver_FailurePredictStatus",
		&failPred, `ROOT\WMI`); err != nil {
		log.Printf("aviso daily: MSStorageDriver_FailurePredictStatus: %v", err)
	}
	// Indexamos por serial: buscamos el serial de cada disco en el InstanceName.
	failBySerial := make(map[string]bool, len(failPred))
	for _, f := range failPred {
		failBySerial[strings.ToLower(f.InstanceName)] = f.PredictFailure
	}

	out := make([]report.DiskHealth, 0, len(disks))
	for _, d := range disks {
		health := healthStatusNames[d.HealthStatus]
		if health == "" {
			health = "Unknown"
		}

		// Predict failure: buscamos si algún InstanceName contiene el serial del disco.
		serial := strings.TrimSpace(d.SerialNumber)
		predictFail := false
		if serial != "" {
			lserial := strings.ToLower(serial)
			for instKey, pf := range failBySerial {
				if strings.Contains(instKey, lserial) {
					predictFail = pf
					break
				}
			}
		}

		dh := report.DiskHealth{
			Serial:         serial,
			Health:         health,
			PredictFailure: predictFail,
		}

		if rc, ok := reliabMap[strings.TrimSpace(d.DeviceId)]; ok {
			// Temperature > 0 significa que el disco expone el dato SMART.
			if rc.Temperature > 0 {
				t := int(rc.Temperature)
				dh.TemperatureC = &t
			}
			// Wear: se envía aunque sea 0 (disco nuevo) si el campo está disponible.
			// WMI devuelve 0 cuando el disco no soporta el contador; comprobamos
			// si Temperature también fue 0 para decidir si el contador existe.
			if rc.Temperature > 0 {
				w := int(rc.Wear)
				dh.WearPct = &w
			}
		}

		out = append(out, dh)
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Serial < out[j].Serial })
	return out
}

// --- Windows Update via COM (IUpdateSearcher.QueryHistory) ---

func collectWindowsUpdate() report.WindowsUpdate {
	// Intentamos la API COM primero; si falla, Win32_QuickFixEngineering como fallback.
	wu, err := windowsUpdateViaCOM()
	if err != nil {
		log.Printf("aviso daily: Windows Update COM: %v; usando Win32_QuickFixEngineering", err)
		return windowsUpdateViaQFE()
	}
	return wu
}

func windowsUpdateViaCOM() (report.WindowsUpdate, error) {
	// IUpdateSearcher es un objeto STA; usar ApartmentThreaded.
	hr := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED)
	if hr != nil {
		oleErr, ok := hr.(*ole.OleError)
		if !ok || (oleErr.Code() != 0x80010106 && oleErr.Code() != 1) {
			// 0x80010106 = ya inicializado en este hilo; 1 = S_FALSE (ya inicializado)
			return report.WindowsUpdate{}, fmt.Errorf("CoInitializeEx: %w", hr)
		}
	}
	defer ole.CoUninitialize()

	unknown, err := oleutil.CreateObject("Microsoft.Update.Session")
	if err != nil {
		return report.WindowsUpdate{}, fmt.Errorf("crear Microsoft.Update.Session: %w", err)
	}
	defer unknown.Release()

	session, err := unknown.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		return report.WindowsUpdate{}, fmt.Errorf("QueryInterface IDispatch: %w", err)
	}
	defer session.Release()

	searcherV, err := oleutil.CallMethod(session, "CreateUpdateSearcher")
	if err != nil {
		return report.WindowsUpdate{}, fmt.Errorf("CreateUpdateSearcher: %w", err)
	}
	searcher := searcherV.ToIDispatch()
	defer searcher.Release()

	// QueryHistory(startIndex=0, count=50): primeros 50 registros del historial.
	histV, err := oleutil.CallMethod(searcher, "QueryHistory", int32(0), int32(50))
	if err != nil {
		return report.WindowsUpdate{}, fmt.Errorf("QueryHistory: %w", err)
	}
	hist := histV.ToIDispatch()
	defer hist.Release()

	countV, err := oleutil.GetProperty(hist, "Count")
	if err != nil {
		return report.WindowsUpdate{}, fmt.Errorf("Count: %w", err)
	}
	count := int(countV.Val)
	if count == 0 {
		return report.WindowsUpdate{}, nil
	}

	var latest time.Time
	var latestKB string

	for i := 0; i < count; i++ {
		itemV, err := oleutil.CallMethod(hist, "Item", int32(i))
		if err != nil {
			continue
		}
		item := itemV.ToIDispatch()

		// ResultCode: 2 = Succeeded, 3 = SucceededWithErrors
		rcV, err := oleutil.GetProperty(item, "ResultCode")
		if err != nil {
			item.Release()
			continue
		}
		if rc := int(rcV.Val); rc != 2 && rc != 3 {
			item.Release()
			continue
		}

		dateV, err := oleutil.GetProperty(item, "Date")
		if err != nil {
			item.Release()
			continue
		}
		titleV, _ := oleutil.GetProperty(item, "Title")

		// Date puede llegar como VT_DATE (float64 OLE) o VT_BSTR (cadena ISO).
		var t2 time.Time
		switch dateV.VT {
		case ole.VT_DATE:
			oleDate := *(*float64)(unsafe.Pointer(&dateV.Val))
			t2 = oleDate2Time(oleDate)
		case ole.VT_BSTR:
			s := dateV.ToString()
			for _, layout := range []string{
				time.RFC3339, "2006-01-02T15:04:05", "2006-01-02",
			} {
				if tt, err := time.Parse(layout, s); err == nil {
					t2 = tt
					break
				}
			}
		default:
			if i == 0 {
				log.Printf("aviso daily: WU COM Date VT inesperado: %d (val=%v)",
					dateV.VT, dateV.Val)
			}
		}
		if !t2.IsZero() && t2.After(latest) {
			latest = t2
			latestKB = extractKB(titleV.ToString())
		}

		item.Release()
	}

	if latest.IsZero() {
		return report.WindowsUpdate{}, fmt.Errorf("historial COM no devolvió actualizaciones correctas (count=%d)", count)
	}
	return report.WindowsUpdate{
		LastInstalledAt: latest.UTC().Format(time.RFC3339),
		LastKB:          latestKB,
	}, nil
}

// oleDate2Time convierte un OLE DATE (float64) a time.Time.
// OLE DATE = días desde 30/12/1899 00:00:00.
func oleDate2Time(oleDate float64) time.Time {
	const oleEpoch = -2209161600 // Unix timestamp de 30/12/1899
	days := int64(oleDate)
	frac := oleDate - float64(days)
	secs := int64(frac * 86400)
	total := oleEpoch + days*86400 + secs
	return time.Unix(total, 0)
}

func extractKB(title string) string {
	// Extrae "KB1234567" del título de la actualización
	for i := 0; i < len(title)-2; i++ {
		if title[i] == 'K' && title[i+1] == 'B' {
			j := i + 2
			for j < len(title) && title[j] >= '0' && title[j] <= '9' {
				j++
			}
			if j > i+2 {
				return title[i:j]
			}
		}
	}
	return ""
}

// --- Fallback: Win32_QuickFixEngineering ---

type win32QFE struct {
	HotFixID    string
	InstalledOn string
}

func windowsUpdateViaQFE() report.WindowsUpdate {
	var qfes []win32QFE
	if err := wmi.Query("SELECT HotFixID, InstalledOn FROM Win32_QuickFixEngineering", &qfes); err != nil {
		log.Printf("aviso daily: Win32_QuickFixEngineering: %v", err)
		return report.WindowsUpdate{}
	}

	var latest time.Time
	var latestKB string

	for _, q := range qfes {
		// InstalledOn tiene formato "M/D/YYYY" o vacío
		t := parseQFEDate(q.InstalledOn)
		if t.After(latest) {
			latest = t
			latestKB = q.HotFixID
		}
	}

	if latest.IsZero() {
		return report.WindowsUpdate{}
	}
	return report.WindowsUpdate{
		LastInstalledAt: latest.UTC().Format(time.RFC3339),
		LastKB:          latestKB,
	}
}

func parseQFEDate(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}

	// Formatos con separador conocido.
	for _, layout := range []string{
		"1/2/2006", "1/2/2006 15:04:05", // americano M/D/YYYY
		"2/1/2006", "2/1/2006 15:04:05", // europeo D/M/YYYY
		"2006-01-02",                     // ISO
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}

	// Formato genérico con separadores / o - : intentamos detectar si es
	// D/M/YYYY o M/D/YYYY comprobando si el primer número > 12 (solo puede ser día).
	parts := strings.FieldsFunc(s, func(r rune) bool { return r == '/' || r == '-' })
	if len(parts) == 3 {
		p0, _ := strconv.Atoi(parts[0])
		p1, _ := strconv.Atoi(parts[1])
		year, _ := strconv.Atoi(parts[2])
		if year < 100 {
			year += 2000
		}
		// Si el primer campo > 12, es el día (formato europeo D/M/YYYY).
		// Si el segundo campo > 12, es el día (formato americano M/D/YYYY).
		day, month := p0, p1
		if p0 <= 12 && p1 <= 12 {
			// Ambiguo: asumimos europeo (D/M) para localización en español.
			day, month = p0, p1
		} else if p0 > 12 {
			day, month = p0, p1
		} else {
			day, month = p1, p0
		}
		if month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 {
			return time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
		}
	}

	return time.Time{}
}

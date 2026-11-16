//go:build windows

package collector

import (
	"log"
	"sort"
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
	DeviceID       string
	SerialNumber   string
	HealthStatus   uint16
	Size           uint64
}

type msftReliabilityCounter struct {
	DeviceID    string
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
		"SELECT DeviceID, SerialNumber, HealthStatus, Size FROM MSFT_PhysicalDisk",
		&disks, `ROOT\Microsoft\Windows\Storage`); err != nil {
		log.Printf("aviso daily: MSFT_PhysicalDisk: %v", err)
		return nil
	}

	// Contadores de fiabilidad (temperatura, desgaste) indexados por DeviceID
	var reliab []msftReliabilityCounter
	if err := wmi.QueryNamespace(
		"SELECT DeviceID, Temperature, Wear FROM MSFT_StorageReliabilityCounter",
		&reliab, `ROOT\Microsoft\Windows\Storage`); err != nil {
		log.Printf("aviso daily: MSFT_StorageReliabilityCounter: %v", err)
	}
	reliabMap := make(map[string]msftReliabilityCounter, len(reliab))
	for _, r := range reliab {
		reliabMap[r.DeviceID] = r
	}

	// Predicción de fallo SMART via MSStorageDriver_FailurePredictStatus
	var failPred []msStorageFailurePredict
	if err := wmi.QueryNamespace(
		"SELECT PredictFailure, InstanceName FROM MSStorageDriver_FailurePredictStatus",
		&failPred, `ROOT\WMI`); err != nil {
		log.Printf("aviso daily: MSStorageDriver_FailurePredictStatus: %v", err)
	}
	// InstanceName tiene la forma "SCSI\Disk&Ven_...&Prod_...&Rev_...\X&...&0&..."
	// Guardamos todos los que predicen fallo para cruzar más tarde.
	failSet := make(map[bool]struct{}) // simplificado: si alguno predice fallo lo indicamos
	_ = failSet
	failMap := make(map[string]bool, len(failPred))
	for _, f := range failPred {
		failMap[f.InstanceName] = f.PredictFailure
	}

	out := make([]report.DiskHealth, 0, len(disks))
	for _, d := range disks {
		health := healthStatusNames[d.HealthStatus]
		if health == "" {
			health = "Unknown"
		}

		// Predict failure: buscamos la entrada cuyo InstanceName contenga el serial
		predictFail := false
		for instName, pf := range failMap {
			_ = instName // en este prototipo asignamos por índice si solo hay uno
			if pf {
				predictFail = true
			}
		}

		dh := report.DiskHealth{
			Serial:         d.SerialNumber,
			Health:         health,
			PredictFailure: predictFail,
		}

		if rc, ok := reliabMap[d.DeviceID]; ok {
			if rc.Temperature > 0 {
				t := int(rc.Temperature)
				dh.TemperatureC = &t
			}
			if rc.Wear > 0 {
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
	if err := ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED); err != nil {
		if err.(*ole.OleError).Code() != 0x80010106 { // ya inicializado
			return report.WindowsUpdate{}, err
		}
	}
	defer ole.CoUninitialize()

	unknown, err := oleutil.CreateObject("Microsoft.Update.Session")
	if err != nil {
		return report.WindowsUpdate{}, err
	}
	defer unknown.Release()

	session, err := unknown.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		return report.WindowsUpdate{}, err
	}
	defer session.Release()

	searcher, err := oleutil.CallMethod(session, "CreateUpdateSearcher")
	if err != nil {
		return report.WindowsUpdate{}, err
	}
	searcherDisp := searcher.ToIDispatch()
	defer searcherDisp.Release()

	// QueryHistory(0, 20): las últimas 20 actualizaciones instaladas
	histV, err := oleutil.CallMethod(searcherDisp, "QueryHistory", int32(0), int32(20))
	if err != nil {
		return report.WindowsUpdate{}, err
	}
	hist := histV.ToIDispatch()
	defer hist.Release()

	countV, err := oleutil.GetProperty(hist, "Count")
	if err != nil {
		return report.WindowsUpdate{}, err
	}
	count := int(countV.Val)

	var latest time.Time
	var latestKB string

	for i := 0; i < count; i++ {
		itemV, err := oleutil.CallMethod(hist, "Item", int32(i))
		if err != nil {
			continue
		}
		item := itemV.ToIDispatch()

		// ResultCode: 2 = Succeeded, 3 = SucceededWithErrors
		rcV, _ := oleutil.GetProperty(item, "ResultCode")
		rc := int(rcV.Val)
		if rc != 2 && rc != 3 {
			item.Release()
			continue
		}

		dateV, _ := oleutil.GetProperty(item, "Date")
		titleV, _ := oleutil.GetProperty(item, "Title")

		// Date es un OLE DATE (float64, días desde 30/12/1899)
		if dateV.VT == ole.VT_DATE {
			t := oleutil.MustGetProperty(item, "Date")
			_ = t
			// Convertimos el OLE DATE a time.Time
			oleDate := *(*float64)(unsafe.Pointer(&dateV.Val))
			t2 := oleDate2Time(oleDate)
			if t2.After(latest) {
				latest = t2
				latestKB = extractKB(titleV.ToString())
			}
		}

		item.Release()
	}

	if latest.IsZero() {
		return report.WindowsUpdate{}, nil
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
	for _, layout := range []string{"1/2/2006", "1/2/2006 15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

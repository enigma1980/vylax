//go:build windows

package collector

import (
	"fmt"
	"log"
	"net"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/enigma1980/vylax/agent/report"
	"github.com/yusufpapurcu/wmi"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

func CollectStatus(inventoryHash string) report.Status {
	now := time.Now().UTC()
	bt := collectBootTime()
	rebootPending, reasons := collectRebootPending()
	av := collectAntivirus()
	user := collectLoggedOnUser()
	net := collectNetwork()
	metered := collectMeteredConnection()
	onBat := collectOnBattery()

	return report.Status{
		Type:                 "status",
		CollectedAt:          now.Format(time.RFC3339),
		LastBootAt:           bt,
		RebootPending:        rebootPending,
		RebootPendingReasons: reasons,
		Antivirus:            av,
		LoggedOnUser:         user,
		Network:              net,
		MeteredConnection:    metered,
		OnBattery:            onBat,
		InventoryHash:        inventoryHash,
	}
}

func collectBootTime() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SYSTEM\CurrentControlSet\Control\Windows`, registry.QUERY_VALUE)
	if err != nil {
		log.Printf("aviso status: boot time registro: %v", err)
		return ""
	}
	defer k.Close()
	// ShutdownTime no es el boot; usamos gopsutil para el uptime y calculamos
	// la fecha de arranque a partir de ahora − uptime.
	upSecs := collectUptime()
	if upSecs == 0 {
		return ""
	}
	bootTime := time.Now().UTC().Add(-time.Duration(upSecs) * time.Second)
	return bootTime.Format(time.RFC3339)
}

// collectRebootPending detecta si hay un reinicio pendiente.
// Solo WindowsUpdate\RebootRequired y CBS\RebootPending activan reboot_pending=true.
// PendingFileRenameOperations añade el motivo pero no activa el flag.
func collectRebootPending() (bool, []string) {
	var reasons []string
	pending := false

	wuKey := `SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, wuKey, registry.QUERY_VALUE); err == nil {
		k.Close()
		pending = true
		reasons = append(reasons, "windows_update")
	}

	cbsKey := `SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, cbsKey, registry.QUERY_VALUE); err == nil {
		k.Close()
		pending = true
		reasons = append(reasons, "component_based_servicing")
	}

	pfroKey := `SYSTEM\CurrentControlSet\Control\Session Manager`
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, pfroKey, registry.QUERY_VALUE); err == nil {
		defer k.Close()
		vals, _, err := k.GetStringsValue("PendingFileRenameOperations")
		if err == nil && len(vals) > 0 {
			reasons = append(reasons, "pending_file_rename")
		}
	}

	return pending, reasons
}

// --- Antivirus via SecurityCenter2 ---

type avProduct struct {
	DisplayName  string
	ProductState uint32
}

// decodeProductState interpreta el campo ProductState de AntiVirusProduct.
// Formato de 24 bits (en hex): 0xSSRR00
//
//	bits 19-16 (nibble S alto): estado de protección en tiempo real (1=activo)
//	bits 15-12 (nibble S bajo): ídem
//	bits 11-8  (nibble R alto): estado de firmas (0x00=al día, 0x10=desactualizado)
//	bits 7-0   (byte bajo):     flags de producto
func decodeProductState(state uint32) (enabled, upToDate bool) {
	rtState := (state >> 12) & 0xF
	sigNibble := (state >> 4) & 0xF
	enabled = rtState == 1
	// sigNibble==0 → firmas al día; cualquier otro valor → desactualizadas.
	upToDate = sigNibble == 0
	return
}

type msftMpStatus struct {
	AntivirusSignatureAge int32
}

// defenderSignatureUpToDate comprueba si las firmas de Defender están al día
// consultando directamente ROOT\Microsoft\Windows\Defender MSFT_MpComputerStatus.
// Devuelve (upToDate, ok): ok=false si la consulta falla.
func defenderSignatureUpToDate() (bool, bool) {
	var rows []msftMpStatus
	q := "SELECT AntivirusSignatureAge FROM MSFT_MpComputerStatus"
	if err := wmi.QueryNamespace(q, &rows, `ROOT\Microsoft\Windows\Defender`); err != nil {
		log.Printf("aviso status: MSFT_MpComputerStatus: %v", err)
		return false, false
	}
	if len(rows) == 0 {
		return false, false
	}
	// Age en días; 0 = actualizado hoy, <=3 se considera al día (igual que AV estándar).
	return rows[0].AntivirusSignatureAge <= 3, true
}

func collectAntivirus() []report.Antivirus {
	var products []avProduct
	q := "SELECT DisplayName, ProductState FROM AntiVirusProduct"
	if err := wmi.QueryNamespace(q, &products, `ROOT\SecurityCenter2`); err != nil {
		log.Printf("aviso status: SecurityCenter2 no disponible (¿servidor?): %v", err)
		return nil
	}

	// Leer estado de Defender una sola vez si hay algún producto Defender.
	defenderChecked := false
	defenderUpToDate := false

	out := make([]report.Antivirus, 0, len(products))
	for _, p := range products {
		enabled, upToDate := decodeProductState(p.ProductState)

		// Para Windows Defender usamos MSFT_MpComputerStatus que es más fiable.
		if strings.Contains(strings.ToLower(p.DisplayName), "windows defender") ||
			strings.Contains(strings.ToLower(p.DisplayName), "microsoft defender") {
			if !defenderChecked {
				defenderUpToDate, defenderChecked = defenderSignatureUpToDate()
			}
			if defenderChecked {
				upToDate = defenderUpToDate
			}
		}

		out = append(out, report.Antivirus{
			Product:  p.DisplayName,
			Enabled:  enabled,
			UpToDate: upToDate,
		})
	}
	return out
}

// --- Usuario conectado via WTS ---

var (
	wtsapi32              = windows.NewLazySystemDLL("wtsapi32.dll")
	procWTSEnumSessions   = wtsapi32.NewProc("WTSEnumerateSessionsW")
	procWTSQueryInfo      = wtsapi32.NewProc("WTSQuerySessionInformationW")
	procWTSFreeMemory     = wtsapi32.NewProc("WTSFreeMemory")
)

const (
	wtsCurrentServerHandle = 0
	wtsUserName            = 5
	wtsDomainName          = 7
	wtsConnectStateActive  = 0
)

type wtsSessionInfo struct {
	SessionID      uint32
	WinStationName *uint16
	State          uint32
}

func collectLoggedOnUser() string {
	var pSessions uintptr
	var count uint32
	ret, _, err := procWTSEnumSessions.Call(
		wtsCurrentServerHandle, 0, 1,
		uintptr(unsafe.Pointer(&pSessions)),
		uintptr(unsafe.Pointer(&count)),
	)
	if ret == 0 {
		log.Printf("aviso status: WTSEnumerateSessions: %v", err)
		return ""
	}
	defer procWTSFreeMemory.Call(pSessions)

	const size = unsafe.Sizeof(wtsSessionInfo{})
	for i := uint32(0); i < count; i++ {
		si := (*wtsSessionInfo)(unsafe.Pointer(pSessions + uintptr(i)*size))
		if si.State != wtsConnectStateActive {
			continue
		}
		domain := wtsQueryString(si.SessionID, wtsDomainName)
		user := wtsQueryString(si.SessionID, wtsUserName)
		if user == "" {
			continue
		}
		if domain != "" {
			return domain + `\` + user
		}
		return user
	}
	return ""
}

func wtsQueryString(sessionID uint32, infoClass uint32) string {
	var pBuffer uintptr
	var bytesReturned uint32
	ret, _, err := procWTSQueryInfo.Call(
		wtsCurrentServerHandle,
		uintptr(sessionID),
		uintptr(infoClass),
		uintptr(unsafe.Pointer(&pBuffer)),
		uintptr(unsafe.Pointer(&bytesReturned)),
	)
	if ret == 0 {
		log.Printf("aviso status: WTSQuerySessionInformation class %d: %v", infoClass, err)
		return ""
	}
	defer procWTSFreeMemory.Call(pBuffer)
	if bytesReturned < 2 {
		return ""
	}
	return windows.UTF16PtrToString((*uint16)(unsafe.Pointer(pBuffer)))
}

// --- Red via GetAdaptersAddresses ---

func collectNetwork() report.Network {
	adapters, err := getAdaptersInfo()
	if err != nil {
		log.Printf("aviso status: red: %v", err)
		return report.Network{}
	}
	return report.Network{Adapters: adapters}
}

func getAdaptersInfo() ([]report.NetworkAdapter, error) {
	const (
		flagIncludeGateways = 0x0080 // GAA_FLAG_INCLUDE_GATEWAYS
	)
	flags := uint32(flagIncludeGateways)

	var size uint32
	windows.GetAdaptersAddresses(windows.AF_UNSPEC, flags, 0, nil, &size)
	if size == 0 {
		return nil, fmt.Errorf("GetAdaptersAddresses: tamaño 0")
	}
	// Añadimos margen por si la lista crece entre las dos llamadas.
	size += 4096
	buf := make([]byte, size)
	head := (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0]))
	if err := windows.GetAdaptersAddresses(windows.AF_UNSPEC, flags, 0, head, &size); err != nil {
		return nil, err
	}

	const (
		ifTypeSoftwareLoopback = 24
		ifTypeTunnel           = 131
	)

	var out []report.NetworkAdapter
	for aa := head; aa != nil; aa = aa.Next {
		// Solo adaptadores activos y físicos/virtuales reales.
		if aa.OperStatus != windows.IfOperStatusUp {
			continue
		}
		// Excluir loopback y túneles.
		if aa.IfType == ifTypeSoftwareLoopback || aa.IfType == ifTypeTunnel {
			continue
		}

		var ipv4s []string
		for ua := aa.FirstUnicastAddress; ua != nil; ua = ua.Next {
			sa := ua.Address.Sockaddr
			if sa == nil {
				continue
			}
			if ip4 := sockaddrToIPv4(sa); ip4 != "" {
				ipv4s = append(ipv4s, ip4)
			}
		}
		if len(ipv4s) == 0 {
			continue
		}

		name := windows.UTF16PtrToString(aa.FriendlyName)

		var gw string
		for ga := aa.FirstGatewayAddress; ga != nil; ga = ga.Next {
			if ip4 := sockaddrToIPv4(ga.Address.Sockaddr); ip4 != "" {
				gw = ip4
				break
			}
		}

		var dnsServers []string
		seen := map[string]bool{}
		for da := aa.FirstDnsServerAddress; da != nil; da = da.Next {
			if ip4 := sockaddrToIPv4(da.Address.Sockaddr); ip4 != "" && !seen[ip4] {
				dnsServers = append(dnsServers, ip4)
				seen[ip4] = true
			}
		}

		linkMbps := aa.TransmitLinkSpeed / 1_000_000

		out = append(out, report.NetworkAdapter{
			Name:          name,
			IPv4:          ipv4s,
			Gateway:       gw,
			DNS:           dnsServers,
			LinkSpeedMbps: linkMbps,
		})
	}
	return out, nil
}

func sockaddrToIPv4(sa *syscall.RawSockaddrAny) string {
	if sa == nil {
		return ""
	}
	if sa.Addr.Family == syscall.AF_INET {
		ip4 := (*syscall.RawSockaddrInet4)(unsafe.Pointer(sa))
		return net.IP(ip4.Addr[:]).String()
	}
	return ""
}

// --- Conexión de uso medido ---

func collectMeteredConnection() bool {
	// HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\DefaultMediaCost
	// Valor "Default": 1=no medido, 2=medido fijo, 3=variable, 4=sin límite (medido), 5=desconocido
	k, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\DefaultMediaCost`,
		registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	v, _, err := k.GetIntegerValue("Default")
	if err != nil {
		return false
	}
	return v >= 2
}

// --- Batería ---

type systemPowerStatus struct {
	ACLineStatus        byte
	BatteryFlag         byte
	BatteryLifePercent  byte
	SystemStatusFlag    byte
	BatteryLifeTime     uint32
	BatteryFullLifeTime uint32
}

var procGetSystemPowerStatus = dllKernel32.NewProc("GetSystemPowerStatus")

func collectOnBattery() bool {
	var status systemPowerStatus
	ret, _, err := procGetSystemPowerStatus.Call(uintptr(unsafe.Pointer(&status)))
	if ret == 0 {
		log.Printf("aviso status: GetSystemPowerStatus: %v", err)
		return false
	}
	// ACLineStatus: 0 = con batería, 1 = CA, 255 = desconocido
	return status.ACLineStatus == 0
}

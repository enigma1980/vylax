//go:build windows

package collector

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/enigma1980/vylax/agent/report"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/yusufpapurcu/wmi"
	"golang.org/x/sys/windows/registry"
)

type win32ComputerSystem struct {
	Manufacturer string
	Model        string
}

type win32BIOS struct {
	SMBIOSBIOSVersion string
}

type win32SystemEnclosure struct {
	ChassisTypes []int32
}

type win32ComputerSystemProduct struct {
	UUID string
}

type win32Processor struct {
	Name                      string
	NumberOfCores             int32
	NumberOfLogicalProcessors int32
}

type msftPhysicalDiskInv struct {
	Model        string
	SerialNumber string
	MediaType    uint16
	BusType      uint16
	Size         uint64 // en bytes
}

// placeholders de relleno que los fabricantes dejan en los campos BIOS/DMI.
var hwPlaceholders = map[string]struct{}{
	"system serial number":    {},
	"to be filled by o.e.m.": {},
	"default string":          {},
	"0123456789":              {},
	"all series":              {},
	"n/a":                     {},
	"none":                    {},
	"not applicable":          {},
	"not specified":           {},
	"chassis serial number":   {},
	"base board serial number":{},
	"ffffffff":                {},
}

func cleanHWString(s string) string {
	s = strings.TrimSpace(s)
	if _, ok := hwPlaceholders[strings.ToLower(s)]; ok {
		return ""
	}
	return s
}

var chassisTypeNames = map[uint16]string{
	1: "other", 2: "unknown", 3: "desktop", 4: "low-profile-desktop",
	5: "pizza-box", 6: "mini-tower", 7: "tower", 8: "portable",
	9: "laptop", 10: "notebook", 11: "hand-held", 12: "docking-station",
	13: "all-in-one", 14: "sub-notebook", 15: "space-saving", 16: "lunch-box",
	17: "main-server-chassis", 18: "expansion-chassis", 19: "sub-chassis",
	20: "bus-expansion-chassis", 21: "peripheral-chassis", 22: "raid-chassis",
	23: "rack-mount-chassis", 24: "sealed-case-pc", 25: "multi-system-chassis",
	26: "compact-pci", 27: "advanced-tca", 28: "blade", 29: "blade-enclosure",
	30: "tablet", 31: "convertible", 32: "detachable", 33: "iot-gateway",
	34: "embedded-pc", 35: "mini-pc", 36: "stick-pc",
}

var mediaTypeNames = map[uint16]string{
	0: "unspecified", 3: "HDD", 4: "SSD", 5: "SCM",
}

var busTypeNames = map[uint16]string{
	0: "unknown", 1: "SCSI", 2: "ATAPI", 3: "ATA", 4: "IEEE 1394",
	5: "SSA", 6: "FC", 7: "USB", 8: "RAID", 9: "iSCSI", 10: "SAS",
	11: "SATA", 12: "SD", 13: "MMC", 14: "virtual", 15: "File-Backed Virtual",
	16: "Storage Spaces", 17: "NVMe",
}

// wmiQuery ejecuta una consulta WMI con tiempo máximo de 30 s.
// Registra el error si lo hay y devuelve nil si se supera el tiempo o hay error.
func wmiQuery[T any](name, query string) []T {
	return withTimeout(name, 30*time.Second, func() []T {
		var rows []T
		if err := wmi.Query(query, &rows); err != nil {
			log.Printf("aviso inventory: %s: %v", name, err)
			return nil
		}
		return rows
	}, nil)
}

// wmiQueryNS es igual que wmiQuery pero en un namespace distinto del por defecto.
func wmiQueryNS[T any](name, query, ns string) []T {
	return withTimeout(name, 30*time.Second, func() []T {
		var rows []T
		if err := wmi.QueryNamespace(query, &rows, ns); err != nil {
			log.Printf("aviso inventory: %s: %v", name, err)
			return nil
		}
		return rows
	}, nil)
}

func CollectInventory() (report.Inventory, string) {
	var inv report.Inventory
	inv.Type = "inventory"

	// Sistema (fabricante, modelo)
	type win32BIOSSerial struct {
		SMBIOSBIOSVersion string
		SerialNumber      string
	}

	if cs := wmiQuery[win32ComputerSystem]("Win32_ComputerSystem",
		"SELECT Manufacturer, Model FROM Win32_ComputerSystem"); len(cs) > 0 {
		inv.System.Manufacturer = cleanHWString(cs[0].Manufacturer)
		inv.System.Model = cleanHWString(cs[0].Model)
	}

	// BIOS y número de serie
	if bios := wmiQuery[win32BIOSSerial]("Win32_BIOS",
		"SELECT SMBIOSBIOSVersion, SerialNumber FROM Win32_BIOS"); len(bios) > 0 {
		inv.System.BIOSVersion = cleanHWString(bios[0].SMBIOSBIOSVersion)
		inv.System.SerialNumber = cleanHWString(bios[0].SerialNumber)
	}

	// Chasis
	if enc := wmiQuery[win32SystemEnclosure]("Win32_SystemEnclosure",
		"SELECT ChassisTypes FROM Win32_SystemEnclosure"); len(enc) > 0 && len(enc[0].ChassisTypes) > 0 {
		ct := uint16(enc[0].ChassisTypes[0])
		if name, ok := chassisTypeNames[ct]; ok {
			inv.System.Chassis = name
		} else {
			inv.System.Chassis = fmt.Sprintf("type-%d", ct)
		}
	}

	// UUID SMBIOS
	if csp := wmiQuery[win32ComputerSystemProduct]("Win32_ComputerSystemProduct",
		"SELECT UUID FROM Win32_ComputerSystemProduct"); len(csp) > 0 {
		inv.System.SMBIOSuuid = csp[0].UUID
	}

	// CPU
	if procs := wmiQuery[win32Processor]("Win32_Processor",
		"SELECT Name, NumberOfCores, NumberOfLogicalProcessors FROM Win32_Processor"); len(procs) > 0 {
		inv.CPU.Model = procs[0].Name
		inv.CPU.Cores = procs[0].NumberOfCores
		inv.CPU.Threads = procs[0].NumberOfLogicalProcessors
	}

	// RAM total
	if vmem, err := mem.VirtualMemory(); err != nil {
		log.Printf("aviso inventory: RAM: %v", err)
	} else {
		inv.MemoryTotalBytes = vmem.Total
	}

	// SO desde el registro (más fiable que gopsutil para DisplayVersion)
	inv.OS = collectOSInfo()

	// Discos físicos
	inv.PhysicalDisks = collectPhysicalDisksForInventory()

	// Hash canónico del inventario
	hash := inventoryHash(inv)
	inv.Hash = "sha256:" + hash

	return inv, inv.Hash
}

func collectOSInfo() report.OSInfo {
	var info report.OSInfo
	k, err := registry.OpenKey(registry.LOCAL_MACHINE,
		`SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err != nil {
		log.Printf("aviso inventory: registro SO: %v", err)
		return info
	}
	defer k.Close()

	if v, _, err := k.GetStringValue("ProductName"); err == nil {
		info.Name = v
	}
	if v, _, err := k.GetStringValue("DisplayVersion"); err == nil {
		info.DisplayVer = v
	}

	build, _, _ := k.GetStringValue("CurrentBuild")
	ubr, _, _ := k.GetIntegerValue("UBR")
	if build != "" {
		info.Build = fmt.Sprintf("%s.%d", build, ubr)
	}

	// Versión kernel: CurrentMajorVersionNumber.CurrentMinorVersionNumber.CurrentBuild
	maj, _, _ := k.GetIntegerValue("CurrentMajorVersionNumber")
	min, _, _ := k.GetIntegerValue("CurrentMinorVersionNumber")
	if maj > 0 {
		info.Version = fmt.Sprintf("%d.%d.%s", maj, min, build)
	}

	// Fecha de instalación (epoch UNIX en DWORD)
	if epoch, _, err := k.GetIntegerValue("InstallDate"); err == nil && epoch > 0 {
		t := time.Unix(int64(epoch), 0).UTC()
		info.InstallDate = t.Format("2006-01-02")
	}

	return info
}

func collectPhysicalDisksForInventory() []report.PhysicalDisk {
	rows := wmiQueryNS[msftPhysicalDiskInv]("MSFT_PhysicalDisk_inv",
		"SELECT Model, SerialNumber, MediaType, BusType, Size FROM MSFT_PhysicalDisk",
		`ROOT\Microsoft\Windows\Storage`)
	if rows == nil {
		return nil
	}

	out := make([]report.PhysicalDisk, 0, len(rows))
	for _, r := range rows {
		media := mediaTypeNames[r.MediaType]
		if media == "" {
			media = fmt.Sprintf("type-%d", r.MediaType)
		}
		bus := busTypeNames[r.BusType]
		if bus == "" {
			bus = fmt.Sprintf("bus-%d", r.BusType)
		}
		out = append(out, report.PhysicalDisk{
			Model:     cleanHWString(r.Model),
			Serial:    cleanHWString(r.SerialNumber),
			Media:     media,
			Bus:       bus,
			SizeBytes: r.Size,
		})
	}
	return out
}

// inventoryHash serializa el inventario con claves ordenadas y devuelve el hex del SHA-256.
func inventoryHash(inv report.Inventory) string {
	// Serialización canónica: ordenamos slices por serial/model para estabilidad.
	disks := make([]report.PhysicalDisk, len(inv.PhysicalDisks))
	copy(disks, inv.PhysicalDisks)
	sort.Slice(disks, func(i, j int) bool { return disks[i].Serial < disks[j].Serial })

	canonical := struct {
		System  report.SystemInfo   `json:"system"`
		CPU     report.CPUInfo      `json:"cpu"`
		MemTotal uint64             `json:"memory_total_bytes"`
		OS      report.OSInfo       `json:"os"`
		Disks   []report.PhysicalDisk `json:"physical_disks"`
	}{
		System:   inv.System,
		CPU:      inv.CPU,
		MemTotal: inv.MemoryTotalBytes,
		OS:       inv.OS,
		Disks:    disks,
	}
	b, _ := json.Marshal(canonical)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}

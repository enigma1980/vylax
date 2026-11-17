//go:build windows

package collector

import (
	"time"

	"golang.org/x/sys/windows"
)

// Handles de DLLs compartidas entre colectores.
var (
	dllKernel32              = windows.NewLazySystemDLL("kernel32.dll")
	procQueryDosDeviceW      = dllKernel32.NewProc("QueryDosDeviceW")
	procGetFinalPathByHandle = dllKernel32.NewProc("GetFinalPathNameByHandleW")
	procGetTickCount64       = dllKernel32.NewProc("GetTickCount64")
	procGetLogicalDrives     = dllKernel32.NewProc("GetLogicalDrives")
)

// WindowsUptime devuelve el tiempo transcurrido desde el arranque del sistema.
// Usado en el scheduler para calcular el warmup relativo al uptime de Windows,
// no al tiempo de vida del agente.
func WindowsUptime() time.Duration {
	r, _, _ := procGetTickCount64.Call()
	return time.Duration(r) * time.Millisecond
}

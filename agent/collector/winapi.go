//go:build windows

package collector

import "golang.org/x/sys/windows"

// Handles de DLLs compartidas entre colectores.
var (
	dllKernel32           = windows.NewLazySystemDLL("kernel32.dll")
	procQueryDosDeviceW   = dllKernel32.NewProc("QueryDosDeviceW")
	procGetFinalPathByHandle = dllKernel32.NewProc("GetFinalPathNameByHandleW")
)

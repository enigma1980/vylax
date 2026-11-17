//go:build windows

package client

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Rutas del directorio de datos del agente.
const (
	DataDir         = `C:\ProgramData\Vylax`
	ConfigFile      = `C:\ProgramData\Vylax\config.json`
	CredFile        = `C:\ProgramData\Vylax\credential.bin`
	CacheDir        = `C:\ProgramData\Vylax\cache`
	InvalidCacheDir = `C:\ProgramData\Vylax\cache\invalid`
	LogFile         = `C:\ProgramData\Vylax\vylax-agent.log`
)

// LocalConfig almacena la configuración local persistente del agente.
type LocalConfig struct {
	ServerURL     string `json:"server_url"`
	DeviceID      string `json:"device_id"`
	ConfigVersion int    `json:"config_version"`
}

// --- handles de DLL ---

var (
	modCrypt32  = windows.NewLazySystemDLL("crypt32.dll")
	modAdvapi32 = windows.NewLazySystemDLL("advapi32.dll")
	modKernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procCryptProtectData   = modCrypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = modCrypt32.NewProc("CryptUnprotectData")
	procLocalFree          = modKernel32.NewProc("LocalFree")
	procConvertStringSD    = modAdvapi32.NewProc("ConvertStringSecurityDescriptorToSecurityDescriptorW")
	procGetSDDacl          = modAdvapi32.NewProc("GetSecurityDescriptorDacl")
	procSetNamedSecInfo    = modAdvapi32.NewProc("SetNamedSecurityInfoW")
	procGetNamedSecInfo    = modAdvapi32.NewProc("GetNamedSecurityInfoW")
	procSDToString         = modAdvapi32.NewProc("ConvertSecurityDescriptorToStringSecurityDescriptorW")
)

const (
	seFileObject                     = 1
	daclSecurityInformation          = 0x4
	protectedDaclSecurityInformation = 0x80000000
	sddlRevision1                    = 1
	cryptProtectLocalMachine         = 0x4 // cifrar con clave de máquina (cualquier usuario admin puede descifrar)
)

// dataBlob es el tipo DATA_BLOB de la API DPAPI.
type dataBlob struct {
	cbData uint32
	pbData *byte
}

// --- Gestión del directorio de datos ---

// SetupDataDir crea C:\ProgramData\Vylax con ACL restrictiva:
// solo SYSTEM y BA (Administradores) tienen acceso, sin herencia.
// Usa SDDL con SIDs en lugar de nombres de cuenta, por lo que funciona
// en cualquier idioma de Windows.
func SetupDataDir() error {
	for _, dir := range []string{DataDir, CacheDir} {
		if err := ensureDir(dir); err != nil {
			return fmt.Errorf("crear %s: %w", dir, err)
		}
	}
	// Aplicar ACL tanto si la carpeta es nueva como si ya existía.
	return applyRestrictiveACL(DataDir)
}

// ensureDir crea path si no existe. Es idempotente: si ya existe como
// directorio, no hace nada. Evita os.MkdirAll, que en Windows puede
// devolver ERROR_ALREADY_EXISTS aunque el directorio sí exista.
func ensureDir(path string) error {
	fi, err := os.Stat(path)
	if err == nil {
		if fi.IsDir() {
			return nil
		}
		return fmt.Errorf("%s existe pero no es un directorio", path)
	}
	if !os.IsNotExist(err) {
		return err
	}
	return os.MkdirAll(path, 0750)
}

// applyRestrictiveACL aplica D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA) al directorio.
// SY = NT AUTHORITY\SYSTEM, BA = BUILTIN\Administrators.
// :P protege la DACL (elimina la herencia del padre).
func applyRestrictiveACL(dir string) error {
	// Convertir la cadena SDDL a un security descriptor
	sddlW, err := syscall.UTF16PtrFromString("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)")
	if err != nil {
		return err
	}
	var pSD uintptr
	r, _, _ := procConvertStringSD.Call(
		uintptr(unsafe.Pointer(sddlW)),
		uintptr(sddlRevision1),
		uintptr(unsafe.Pointer(&pSD)),
		0,
	)
	if r == 0 {
		return fmt.Errorf("ConvertStringSecurityDescriptorToSecurityDescriptorW falló")
	}
	defer procLocalFree.Call(pSD)

	// Extraer la DACL del security descriptor
	var daclPresent, daclDefaulted int32
	var pDacl uintptr
	r, _, _ = procGetSDDacl.Call(
		pSD,
		uintptr(unsafe.Pointer(&daclPresent)),
		uintptr(unsafe.Pointer(&pDacl)),
		uintptr(unsafe.Pointer(&daclDefaulted)),
	)
	if r == 0 {
		return fmt.Errorf("GetSecurityDescriptorDacl falló")
	}

	// Aplicar la DACL al directorio (DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION)
	dirW, err := syscall.UTF16PtrFromString(dir)
	if err != nil {
		return err
	}
	r, _, _ = procSetNamedSecInfo.Call(
		uintptr(unsafe.Pointer(dirW)),
		uintptr(seFileObject),
		uintptr(daclSecurityInformation|protectedDaclSecurityInformation),
		0, 0, // owner, group (sin cambios)
		pDacl,
		0, // sacl (sin cambios)
	)
	if r != 0 {
		return fmt.Errorf("SetNamedSecurityInfoW: error 0x%x", r)
	}
	return nil
}

// CheckDirACL verifica que el directorio de datos no tenga acceso de usuarios normales.
// Llama a GetNamedSecurityInfo para obtener el SDDL y busca SIDs no autorizados.
func CheckDirACL() error {
	if _, err := os.Stat(DataDir); os.IsNotExist(err) {
		return nil // directorio aún no existe (antes de enroll)
	}
	sddl, err := getDirSddl(DataDir)
	if err != nil {
		return fmt.Errorf("leer ACL de %s: %w", DataDir, err)
	}
	// Buscar ACEs de grupos no privilegiados: BU=BUILTIN\Users, WD=Everyone,
	// AU=Authenticated Users, IU=Interactive Users.
	for _, sid := range []string{";;;BU)", ";;;WD)", ";;;AU)", ";;;IU)"} {
		if strings.Contains(sddl, sid) {
			name := strings.Trim(sid, ";)")
			return fmt.Errorf(
				"ACL insegura en %s (contiene %s).\n"+
					"Para restaurarla ejecuta como administrador:\n"+
					`  icacls "%s" /inheritance:r /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" /grant:r "BUILTIN\Administrators:(OI)(CI)F" /T`,
				DataDir, name, DataDir,
			)
		}
	}
	return nil
}

// getDirSddl obtiene el SDDL de la DACL del directorio usando GetNamedSecurityInfoW.
func getDirSddl(path string) (string, error) {
	pathW, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return "", err
	}
	var pSD uintptr
	var pDacl uintptr
	r, _, _ := procGetNamedSecInfo.Call(
		uintptr(unsafe.Pointer(pathW)),
		uintptr(seFileObject),
		uintptr(daclSecurityInformation),
		0, 0, // ppsidOwner, ppsidGroup (no necesarios)
		uintptr(unsafe.Pointer(&pDacl)),
		0, // ppSacl
		uintptr(unsafe.Pointer(&pSD)),
	)
	if r != 0 {
		return "", fmt.Errorf("GetNamedSecurityInfo: error 0x%x", r)
	}
	defer procLocalFree.Call(pSD)

	var pStr uintptr
	r, _, _ = procSDToString.Call(
		pSD,
		uintptr(sddlRevision1),
		uintptr(daclSecurityInformation),
		uintptr(unsafe.Pointer(&pStr)),
		0,
	)
	if r == 0 {
		return "", fmt.Errorf("ConvertSecurityDescriptorToStringSecurityDescriptor falló")
	}
	defer procLocalFree.Call(pStr)

	return windows.UTF16PtrToString((*uint16)(unsafe.Pointer(pStr))), nil
}

// --- DPAPI (cifrado con clave de máquina) ---

// dpApiEncrypt cifra plaintext con DPAPI en ámbito de máquina.
func dpApiEncrypt(plaintext []byte) ([]byte, error) {
	if len(plaintext) == 0 {
		return nil, fmt.Errorf("dpApiEncrypt: datos vacíos")
	}
	in := dataBlob{cbData: uint32(len(plaintext)), pbData: &plaintext[0]}
	var out dataBlob
	r, _, _ := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0, 0, 0, 0,
		uintptr(cryptProtectLocalMachine),
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, fmt.Errorf("CryptProtectData falló")
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))
	result := make([]byte, out.cbData)
	copy(result, (*[1 << 20]byte)(unsafe.Pointer(out.pbData))[:out.cbData])
	return result, nil
}

// dpApiDecrypt descifra datos cifrados con DPAPI en ámbito de máquina.
func dpApiDecrypt(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 {
		return nil, fmt.Errorf("dpApiDecrypt: datos vacíos")
	}
	in := dataBlob{cbData: uint32(len(ciphertext)), pbData: &ciphertext[0]}
	var out dataBlob
	r, _, _ := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0, 0, 0, 0,
		uintptr(cryptProtectLocalMachine),
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, fmt.Errorf("CryptUnprotectData falló (¿se ejecuta en la misma máquina?)")
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))
	result := make([]byte, out.cbData)
	copy(result, (*[1 << 20]byte)(unsafe.Pointer(out.pbData))[:out.cbData])
	return result, nil
}

// --- config.json ---

// LoadConfig lee C:\ProgramData\Vylax\config.json.
func LoadConfig() (*LocalConfig, error) {
	data, err := os.ReadFile(ConfigFile)
	if err != nil {
		return nil, err
	}
	var cfg LocalConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// SaveConfig escribe C:\ProgramData\Vylax\config.json.
func SaveConfig(cfg *LocalConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ConfigFile, data, 0640)
}

// --- credencial (DPAPI) ---

// CredentialExists informa si ya existe una credencial guardada.
func CredentialExists() bool {
	_, err := os.Stat(CredFile)
	return err == nil
}

// SaveCredential cifra secret con DPAPI (ámbito máquina) y lo guarda en credential.bin.
func SaveCredential(secret string) error {
	encrypted, err := dpApiEncrypt([]byte(secret))
	if err != nil {
		return err
	}
	return os.WriteFile(CredFile, encrypted, 0640)
}

// LoadCredential descifra y devuelve el device_secret del equipo.
func LoadCredential() (string, error) {
	data, err := os.ReadFile(CredFile)
	if err != nil {
		return "", err
	}
	plain, err := dpApiDecrypt(data)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

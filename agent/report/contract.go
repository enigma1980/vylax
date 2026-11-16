package report

// Sobre principal que se envía a POST /v1/reports.
type Envelope struct {
	SchemaVersion int      `json:"schema_version"`
	AgentVersion  string   `json:"agent_version"`
	SentAt        string   `json:"sent_at"`
	Reports       []Report `json:"reports"`
}

type Report interface{ reportType() }

// --- metrics ---

type Metrics struct {
	Type        string        `json:"type"`
	PeriodStart string        `json:"period_start"`
	PeriodEnd   string        `json:"period_end"`
	Samples     int           `json:"samples"`
	CPU         MetricsCPU    `json:"cpu"`
	Memory      MetricsMemory `json:"memory"`
	Volumes     []Volume      `json:"volumes"`
	Services    Services      `json:"services"`
	UptimeSecs  int64         `json:"uptime_seconds"`
	Agent       AgentSelf     `json:"agent"`
}

func (Metrics) reportType() {}

type MetricsCPU struct {
	AvgPct float64 `json:"avg_pct"`
	MaxPct float64 `json:"max_pct"`
}

type MetricsMemory struct {
	TotalBytes  uint64  `json:"total_bytes"`
	UsedAvgPct  float64 `json:"used_avg_pct"`
	UsedMaxPct  float64 `json:"used_max_pct"`
}

type Volume struct {
	Mount      string `json:"mount"`
	Label      string `json:"label,omitempty"`
	FS         string `json:"fs"`
	TotalBytes uint64 `json:"total_bytes"`
	FreeBytes  uint64 `json:"free_bytes"`
}

type Services struct {
	Critical       []CriticalService       `json:"critical,omitempty"`
	AutoNotRunning []AutoNotRunningService  `json:"auto_not_running,omitempty"`
}

type CriticalService struct {
	Name  string `json:"name"`
	State string `json:"state"`
}

type AutoNotRunningService struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	Start       string `json:"start"`     // "auto" | "delayed"
	ExitCode    uint32 `json:"exit_code"`
}

type AgentSelf struct {
	CPUAvgPct float64 `json:"cpu_avg_pct"`
	MemBytes  uint64  `json:"mem_bytes"`
}

// --- status ---

type Status struct {
	Type                 string      `json:"type"`
	CollectedAt          string      `json:"collected_at"`
	LastBootAt           string      `json:"last_boot_at"`
	RebootPending        bool        `json:"reboot_pending"`
	RebootPendingReasons []string    `json:"reboot_pending_reasons,omitempty"`
	Antivirus            []Antivirus `json:"antivirus,omitempty"`
	LoggedOnUser         string      `json:"logged_on_user,omitempty"`
	Network              Network     `json:"network"`
	MeteredConnection    bool        `json:"metered_connection"`
	OnBattery            bool        `json:"on_battery"`
	InventoryHash        string      `json:"inventory_hash"`
}

func (Status) reportType() {}

type Antivirus struct {
	Product   string `json:"product"`
	Enabled   bool   `json:"enabled"`
	UpToDate  bool   `json:"up_to_date"`
}

type Network struct {
	Adapters []NetworkAdapter `json:"adapters,omitempty"`
}

type NetworkAdapter struct {
	Name          string   `json:"name"`
	IPv4          []string `json:"ipv4,omitempty"`
	Gateway       string   `json:"gateway,omitempty"`
	DNS           []string `json:"dns,omitempty"`
	LinkSpeedMbps uint64   `json:"link_speed_mbps,omitempty"`
}

// --- daily ---

type Daily struct {
	Type          string        `json:"type"`
	CollectedAt   string        `json:"collected_at"`
	PhysicalDisks []DiskHealth  `json:"physical_disks,omitempty"`
	WindowsUpdate WindowsUpdate `json:"windows_update"`
}

func (Daily) reportType() {}

type DiskHealth struct {
	Serial        string  `json:"serial"`
	Health        string  `json:"health"`
	PredictFailure bool   `json:"predict_failure"`
	TemperatureC  *int    `json:"temperature_c,omitempty"`
	WearPct       *int    `json:"wear_pct,omitempty"`
}

type WindowsUpdate struct {
	LastInstalledAt string `json:"last_installed_at,omitempty"`
	LastKB          string `json:"last_kb,omitempty"`
}

// --- inventory ---

type Inventory struct {
	Type            string         `json:"type"`
	Hash            string         `json:"hash"`
	System          SystemInfo     `json:"system"`
	CPU             CPUInfo        `json:"cpu"`
	MemoryTotalBytes uint64        `json:"memory_total_bytes"`
	OS              OSInfo         `json:"os"`
	PhysicalDisks   []PhysicalDisk `json:"physical_disks,omitempty"`
}

func (Inventory) reportType() {}

type SystemInfo struct {
	Manufacturer string `json:"manufacturer,omitempty"`
	Model        string `json:"model,omitempty"`
	SerialNumber string `json:"serial_number,omitempty"`
	BIOSVersion  string `json:"bios_version,omitempty"`
	Chassis      string `json:"chassis,omitempty"`
	SMBIOSuuid   string `json:"smbios_uuid,omitempty"`
}

type CPUInfo struct {
	Model   string `json:"model,omitempty"`
	Cores   int32  `json:"cores"`
	Threads int32  `json:"threads"`
}

type OSInfo struct {
	Name        string `json:"name,omitempty"`
	Version     string `json:"version,omitempty"`
	Build       string `json:"build,omitempty"`
	DisplayVer  string `json:"display_version,omitempty"`
	InstallDate string `json:"install_date,omitempty"`
}

type PhysicalDisk struct {
	Model     string `json:"model,omitempty"`
	Serial    string `json:"serial,omitempty"`
	Media     string `json:"media,omitempty"`
	Bus       string `json:"bus,omitempty"`
	SizeBytes uint64 `json:"size_bytes"`
}

// --- event ---

// Event notifica un evento del ciclo de vida del agente.
type Event struct {
	Type       string         `json:"type"`
	Event      string         `json:"event"`
	OccurredAt string         `json:"occurred_at"`
	Data       map[string]any `json:"data,omitempty"`
}

func (Event) reportType() {}

// --- tipos de petición y respuesta de la API ---

// EnrollRequest es el cuerpo de POST /v1/enroll.
type EnrollRequest struct {
	SchemaVersion   int        `json:"schema_version"`
	EnrollmentToken string     `json:"enrollment_token"`
	AgentVersion    string     `json:"agent_version"`
	HardwareID      HardwareID `json:"hardware_id"`
	Hostname        string     `json:"hostname"`
	OS              EnrollOS   `json:"os"`
	DeviceTypeHint  string     `json:"device_type_hint,omitempty"`
}

// HardwareID identifica el hardware del equipo en el momento del alta.
type HardwareID struct {
	SMBIOSuuid   string `json:"smbios_uuid,omitempty"`
	SerialNumber string `json:"serial_number,omitempty"`
}

// EnrollOS describe el SO en el momento del alta.
type EnrollOS struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Build   string `json:"build"`
	Arch    string `json:"arch"`
}

// EnrollResponse es la respuesta de POST /v1/enroll.
type EnrollResponse struct {
	DeviceID     string         `json:"device_id"`
	DeviceSecret string         `json:"device_secret"`
	Status       string         `json:"status"`
	Config       ConfigResponse `json:"config"`
}

// ReportsResponse es la respuesta de POST /v1/reports.
type ReportsResponse struct {
	Accepted         int  `json:"accepted"`
	ConfigVersion    int  `json:"config_version"`
	RequestInventory bool `json:"request_inventory"`
}

// ConfigResponse es la respuesta de GET /v1/config.
type ConfigResponse struct {
	ConfigVersion       int             `json:"config_version"`
	Intervals           ConfigIntervals `json:"intervals"`
	JitterS             int             `json:"jitter_s"`
	MeteredIntervalMult int             `json:"metered_interval_multiplier"`
	CriticalServices    []string        `json:"critical_services"`
	SelfLimits          SelfLimits      `json:"self_limits"`
	OfflineCacheMaxMB   int             `json:"offline_cache_max_mb"`
}

// ConfigIntervals contiene los intervalos de envío configurados por el servidor.
type ConfigIntervals struct {
	SampleS  int `json:"sample_s"`
	MetricsS int `json:"metrics_s"`
	StatusS  int `json:"status_s"`
	DailyS   int `json:"daily_s"`
}

// SelfLimits son los límites de consumo del propio agente.
type SelfLimits struct {
	CPUAvgPct float64 `json:"cpu_avg_pct"`
	MemMB     int     `json:"mem_mb"`
}

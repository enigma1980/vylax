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
	Critical      []CriticalService `json:"critical,omitempty"`
	AutoNotRunning []string         `json:"auto_not_running,omitempty"`
}

type CriticalService struct {
	Name  string `json:"name"`
	State string `json:"state"`
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
	Model      string `json:"model,omitempty"`
	Serial     string `json:"serial,omitempty"`
	Media      string `json:"media,omitempty"`
	Bus        string `json:"bus,omitempty"`
	SizeBytes  uint64 `json:"size_bytes"`
}

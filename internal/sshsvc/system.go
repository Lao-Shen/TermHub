package sshsvc

import (
	"strconv"
	"strings"
)

// DiskInfo 磁盘挂载点信息(df 解析结果)。
type DiskInfo struct {
	Filesystem string  `json:"filesystem"`
	Size       string  `json:"size"`
	Used       string  `json:"used"`
	Avail      string  `json:"avail"`
	UsePct     float64 `json:"usePct"`
	Mount      string  `json:"mount"`
}

// SystemInfo 远端系统运行状态汇总(部分命令失败时对应字段为零值)。
type SystemInfo struct {
	OS          string     `json:"os"`
	Kernel      string     `json:"kernel"`
	Hostname    string     `json:"hostname"`
	IPs         []string   `json:"ips"`
	// PublicIP 公网出口 IP(curl -4 ifconfig.me);无外网/失败时为空。
	PublicIP    string     `json:"publicIp"`
	CPUCores    int        `json:"cpuCores"`
	CPUUsage    float64    `json:"cpuUsage"`
	Load1       float64    `json:"load1"`
	Load5       float64    `json:"load5"`
	Load15      float64    `json:"load15"`
	UptimeSecs  int64      `json:"uptimeSecs"`
	MemTotalMB  int64      `json:"memTotalMb"`
	MemUsedMB   int64      `json:"memUsedMb"`
	MemUsage    float64    `json:"memUsage"`
	SwapTotalMB int64      `json:"swapTotalMb"`
	SwapUsedMB  int64      `json:"swapUsedMb"`
	Disks       []DiskInfo `json:"disks"`
}

// ListSystemInfo 采集远端系统运行状态。
// 各命令独立执行、尽力而为:个别失败不影响其余字段,全部失败才返回错误。
func (m *Manager) ListSystemInfo(sessionID string) (SystemInfo, error) {
	ts, err := m.Get(sessionID)
	if err != nil {
		return SystemInfo{}, err
	}

	var info SystemInfo
	failures := 0
	run := func(cmd string, fn func(string)) {
		out, err := ts.Exec(cmd)
		if err != nil {
			failures++
			return
		}
		fn(out)
	}

	run("grep PRETTY_NAME /etc/os-release", func(o string) { info.OS = extractQuoted(o) })
	run("uname -sr", func(o string) {
		f := strings.Fields(o)
		if len(f) >= 2 {
			info.Kernel = f[1]
		} else if len(f) == 1 {
			info.Kernel = f[0]
		}
	})
	run("hostname", func(o string) { info.Hostname = strings.TrimSpace(o) })
	run("hostname -I", func(o string) { info.IPs = parseHostnameI(o) })
	// 公网出口 IP:外部请求,带超时防止拖慢整体采集;失败留空
	run("curl -4 -s --max-time 8 ifconfig.me", func(o string) { info.PublicIP = parsePublicIP(o) })
	run("nproc", func(o string) { info.CPUCores, _ = strconv.Atoi(strings.TrimSpace(o)) })
	run("cat /proc/loadavg", func(o string) {
		f := strings.Fields(o)
		if len(f) >= 3 {
			info.Load1, _ = strconv.ParseFloat(f[0], 64)
			info.Load5, _ = strconv.ParseFloat(f[1], 64)
			info.Load15, _ = strconv.ParseFloat(f[2], 64)
		}
	})
	run("cat /proc/uptime", func(o string) {
		f := strings.Fields(o)
		if len(f) >= 1 {
			secs, _ := strconv.ParseFloat(f[0], 64)
			info.UptimeSecs = int64(secs)
		}
	})
	run("free -m", func(o string) { parseFree(o, &info) })
	run("df -hP", func(o string) { info.Disks = parseDf(o) })
	// CPU 占用:两次采样(间隔 1s)计算增量
	run("cat /proc/stat; sleep 1; cat /proc/stat", func(o string) {
		info.CPUUsage = cpuUsageFromSamples(o)
	})

	// hostname -I 可能也包含公网 IP(VPS 常见),从内网列表剔除
	if info.PublicIP != "" {
		filtered := info.IPs[:0]
		for _, ip := range info.IPs {
			if ip != info.PublicIP {
				filtered = append(filtered, ip)
			}
		}
		info.IPs = filtered
	}

	if failures >= 10 {
		return info, ErrSessionClosed
	}
	return info, nil
}

// ---- 解析器 ----

// extractQuoted 提取行中第一个双引号内容(PRETTY_NAME="..." )。
func extractQuoted(line string) string {
	i := strings.IndexByte(line, '"')
	if i < 0 {
		return ""
	}
	rest := line[i+1:]
	j := strings.IndexByte(rest, '"')
	if j < 0 {
		return rest
	}
	return rest[:j]
}

// parsePublicIP 校验并提取 IPv4 文本(仅数字与点,防脏输出)。
func parsePublicIP(out string) string {
	s := strings.TrimSpace(out)
	if s == "" {
		return ""
	}
	for _, r := range s {
		if r != '.' && (r < '0' || r > '9') {
			return ""
		}
	}
	return s
}

// parseHostnameI 解析 hostname -I 的空格分隔 IP 列表。
func parseHostnameI(out string) []string {
	fields := strings.Fields(out)
	ips := make([]string, 0, len(fields))
	for _, f := range fields {
		if f != "" && !strings.Contains(f, ":") { // 仅 IPv4,IPv6 暂不展示
			ips = append(ips, f)
		}
	}
	return ips
}

// parseFree 解析 `free -m` 的 Mem/Swap 行(单位 MB)。
func parseFree(out string, info *SystemInfo) {
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		switch f[0] {
		case "Mem:":
			info.MemTotalMB, _ = strconv.ParseInt(f[1], 10, 64)
			info.MemUsedMB, _ = strconv.ParseInt(f[2], 10, 64)
		case "Swap:":
			info.SwapTotalMB, _ = strconv.ParseInt(f[1], 10, 64)
			info.SwapUsedMB, _ = strconv.ParseInt(f[2], 10, 64)
		}
	}
	if info.MemTotalMB > 0 {
		info.MemUsage = float64(info.MemUsedMB) / float64(info.MemTotalMB) * 100
	}
}

// parseDf 解析 `df -hP` 输出(跳过标题行)。
func parseDf(out string) []DiskInfo {
	var disks []DiskInfo
	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 6 || f[0] == "Filesystem" {
			continue
		}
		pct := strings.TrimSuffix(f[4], "%")
		use, _ := strconv.ParseFloat(pct, 64)
		disks = append(disks, DiskInfo{
			Filesystem: f[0],
			Size:       f[1],
			Used:       f[2],
			Avail:      f[3],
			UsePct:     use,
			Mount:      f[5],
		})
	}
	return disks
}

// cpuUsageFromSamples 从两次 /proc/stat 采样计算 CPU 占用百分比。
// cpu 行字段:user nice system idle iowait irq softirq steal ...
func cpuUsageFromSamples(out string) float64 {
	var totals []float64
	var idles []float64
	for _, line := range strings.Split(out, "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		f := strings.Fields(line)
		if len(f) < 5 {
			continue
		}
		var total, idle float64
		for i, v := range f[1:] {
			n, _ := strconv.ParseFloat(v, 64)
			total += n
			if i == 3 { // idle 列
				idle = n
			}
		}
		totals = append(totals, total)
		idles = append(idles, idle)
	}
	if len(totals) < 2 {
		return 0
	}
	dt := totals[len(totals)-1] - totals[0]
	di := idles[len(idles)-1] - idles[0]
	if dt <= 0 {
		return 0
	}
	return (1 - di/dt) * 100
}

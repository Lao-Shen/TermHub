package sshsvc

import (
	"strconv"
	"strings"
	"sync"
	"time"
)

// TrafficSample 某一时刻某网卡的流量采样。
// RX/TX 为累计字节,RXRate/TXRate 为相对上一采样的速率(bytes/s)。
type TrafficSample struct {
	Iface   string  `json:"iface"`
	RXBytes int64   `json:"rxBytes"`
	TXBytes int64   `json:"txBytes"`
	RXRate  float64 `json:"rxRate"`
	TXRate  float64 `json:"txRate"`
}

// trafficHistoryMax 滚动历史长度(默认 2s 间隔 → 约 10 分钟)。
const trafficHistoryMax = 300

// defaultTrafficInterval 采样间隔。
const defaultTrafficInterval = 2 * time.Second

// trafficMonitor 单会话的流量采样器:周期读 /proc/net/dev,
// 计算各网卡速率并滚动保留历史;会话关闭时停止。
type trafficMonitor struct {
	sessionID string
	interval  time.Duration

	mu      sync.Mutex
	last    map[string]lastTraffic // iface → 上次采样(字节 + 时间)
	history []TrafficSample

	// onSample 每 tick 回调当前速率快照(由 Manager 注入)。
	onSample func(sessionID string, samples []TrafficSample)
	stopCh   chan struct{}
}

type lastTraffic struct {
	rx, tx int64
	at     time.Time
}

// startTrafficMonitor 启动会话流量采样(幂等)。
func (m *Manager) startTrafficMonitor(ts *TerminalSession) {
	m.mu.Lock()
	if _, ok := m.monitors[ts.ID]; ok {
		m.mu.Unlock()
		return
	}
	mon := &trafficMonitor{
		sessionID: ts.ID,
		interval:  m.trafficInterval,
		last:      make(map[string]lastTraffic),
		onSample:  m.OnTraffic,
		stopCh:    make(chan struct{}),
	}
	m.monitors[ts.ID] = mon
	m.mu.Unlock()

	go mon.loop(ts)
}

// stopTrafficMonitor 停止采样并清理(会话关闭路径)。
func (m *Manager) stopTrafficMonitor(sessionID string) {
	m.mu.Lock()
	mon, ok := m.monitors[sessionID]
	if ok {
		delete(m.monitors, sessionID)
	}
	m.mu.Unlock()
	if ok {
		close(mon.stopCh)
	}
}

// GetTrafficSnapshot 返回会话的滚动历史(按时间顺序,展开为逐接口采样)。
func (m *Manager) GetTrafficSnapshot(sessionID string) ([]TrafficSample, error) {
	m.mu.Lock()
	mon, ok := m.monitors[sessionID]
	m.mu.Unlock()
	if !ok {
		return nil, ErrSessionNotFound
	}
	mon.mu.Lock()
	defer mon.mu.Unlock()
	out := make([]TrafficSample, len(mon.history))
	copy(out, mon.history)
	return out, nil
}

// loop 采样主循环:读取 /proc/net/dev → 计算速率 → 回调 → 滚动历史。
func (mon *trafficMonitor) loop(ts *TerminalSession) {
	ticker := time.NewTicker(mon.interval)
	defer ticker.Stop()
	for {
		select {
		case <-mon.stopCh:
			return
		case <-ticker.C:
		}
		if ts.isClosed() {
			return
		}
		out, err := ts.Exec("cat /proc/net/dev")
		if err != nil {
			continue // 单次失败跳过,下一轮重试
		}
		now := time.Now()
		devs := parseNetDev(out)

		mon.mu.Lock()
		var current []TrafficSample
		for iface, bytes := range devs {
			sample := TrafficSample{Iface: iface, RXBytes: bytes[0], TXBytes: bytes[1]}
			if prev, ok := mon.last[iface]; ok && now.After(prev.at) {
				dt := now.Sub(prev.at).Seconds()
				sample.RXRate = float64(bytes[0]-prev.rx) / dt
				sample.TXRate = float64(bytes[1]-prev.tx) / dt
			}
			mon.last[iface] = lastTraffic{rx: bytes[0], tx: bytes[1], at: now}
			current = append(current, sample)
			mon.history = append(mon.history, sample)
		}
		if len(mon.history) > trafficHistoryMax*len(current)+len(current) {
			mon.history = mon.history[len(current):]
		}
		mon.mu.Unlock()

		if len(current) > 0 && mon.onSample != nil {
			mon.onSample(mon.sessionID, current)
		}
	}
}

// parseNetDev 解析 /proc/net/dev:iface → {rxBytes, txBytes}。
// 行格式:iface: 后跟 16 个数字,前 8 个接收(bytes 在首位),后 8 个发送。
func parseNetDev(out string) map[string][2]int64 {
	devs := make(map[string][2]int64)
	for _, line := range strings.Split(out, "\n") {
		if !strings.Contains(line, ":") {
			continue // 头部行(Inter-| face |...)与空行
		}
		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}
		iface := strings.TrimSuffix(fields[0], ":")
		if iface == "" {
			continue
		}
		rx, _ := strconv.ParseInt(fields[1], 10, 64)
		tx, _ := strconv.ParseInt(fields[9], 10, 64)
		devs[iface] = [2]int64{rx, tx}
	}
	return devs
}

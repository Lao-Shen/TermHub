package sshsvc

import (
	"fmt"
	"regexp"
	"strings"
)

// ServiceInfo 远端 systemd 服务条目。
type ServiceInfo struct {
	// Name 单元名(含 .service 后缀)。
	Name string `json:"name"`
	// Load 加载状态(loaded/not-found...)。
	Load string `json:"load"`
	// Active 运行状态(active/inactive/failed/activating...)。
	Active string `json:"active"`
	// Sub 子状态(running/dead/...)。
	Sub string `json:"sub"`
	// Enabled 自启状态(enabled/disabled/static/masked/...),空为未知。
	Enabled string `json:"enabled"`
	// Description 服务描述。
	Description string `json:"description"`
}

// serviceNameRe 单元名白名单(防命令注入):字母数字 + @ . _ : -
var serviceNameRe = regexp.MustCompile(`^[A-Za-z0-9@._:-]+$`)

// ListServices 列出远端服务:运行状态(systemctl list-units)与自启状态
// (systemctl list-unit-files)两条命令合并;无 systemd 时返回友好错误。
func (m *Manager) ListServices(sessionID string) ([]ServiceInfo, error) {
	ts, err := m.Get(sessionID)
	if err != nil {
		return nil, err
	}

	unitsOut, err := ts.Exec("systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null")
	if err != nil {
		return nil, err
	}
	enabledOut, err := ts.Exec("systemctl list-unit-files --type=service --no-pager --no-legend --plain 2>/dev/null")
	if err != nil {
		// 自启状态拉取失败不阻断(老 systemd),仅运行状态
		enabledOut = ""
	}

	enabled := parseUnitFiles(enabledOut)
	list := parseListUnits(unitsOut, enabled)
	if len(list) == 0 {
		return nil, fmt.Errorf("未获取到服务列表(服务器可能不是 systemd 或 systemctl 不可用)")
	}
	return list, nil
}

// ControlService 对远端服务执行操作:
// start / stop / restart / enable / disable。
func (m *Manager) ControlService(sessionID, name, action string) error {
	if !serviceNameRe.MatchString(name) || len(name) > 256 {
		return fmt.Errorf("无效的服务名: %s", name)
	}
	switch action {
	case "start", "stop", "restart", "enable", "disable":
	default:
		return fmt.Errorf("不支持的操作: %s", action)
	}
	ts, err := m.Get(sessionID)
	if err != nil {
		return err
	}
	cmd := fmt.Sprintf("systemctl %s %s", action, name)
	out, err := ts.Exec(cmd)
	if err == nil {
		return nil
	}

	// 权限不足等场景:尝试 sudo -n(免密 sudo,不会挂起等密码)
	sudoOut, sudoErr := ts.Exec("sudo -n " + cmd)
	if sudoErr == nil {
		return nil
	}
	detail := strings.TrimSpace(out)
	if strings.TrimSpace(sudoOut) != "" {
		detail = strings.TrimSpace(sudoOut)
	}
	if detail == "" {
		detail = sudoErr.Error()
	}
	return fmt.Errorf(
		"%s 失败: %s(当前用户可能无权操作该服务;可在服务器配置 sudo 免密,或使用 root 登录)",
		action, detail,
	)
}

// parseListUnits 解析 `systemctl list-units --plain --no-legend` 输出:
// 列:UNIT LOAD ACTIVE SUB DESCRIPTION(描述含空格,为剩余部分)。
func parseListUnits(out string, enabled map[string]string) []ServiceInfo {
	var list []ServiceInfo
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		if !strings.HasSuffix(fields[0], ".service") {
			continue
		}
		desc := ""
		if len(fields) > 4 {
			desc = strings.Join(fields[4:], " ")
		}
		list = append(list, ServiceInfo{
			Name:        fields[0],
			Load:        fields[1],
			Active:      fields[2],
			Sub:         fields[3],
			Enabled:     enabled[fields[0]],
			Description: desc,
		})
	}
	return list
}

// parseUnitFiles 解析 `systemctl list-unit-files --plain --no-legend` 输出:
// 列:UNIT STATE。
func parseUnitFiles(out string) map[string]string {
	enabled := make(map[string]string)
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		enabled[fields[0]] = fields[1]
	}
	return enabled
}

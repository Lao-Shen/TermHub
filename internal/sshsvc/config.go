// Package sshsvc 是 TermHub 的 SSH 领域服务层:连接配置、会话管理、主机密钥校验。
// 本包不依赖任何 UI 框架(Wails/前端),保持纯 Go,可独立测试;
// 会话输出与退出事件通过回调抛给上层,由桥接层(bridge)决定如何分发。
package sshsvc

import "fmt"

// AuthMethod 认证方式。
type AuthMethod string

const (
	// AuthPassword 密码认证。
	AuthPassword AuthMethod = "password"
	// AuthPrivateKey 私钥文件认证(暂不支持带密码短语的密钥)。
	AuthPrivateKey AuthMethod = "private_key"
)

// ProxyType 传输层代理类型(如本地 Clash 的 127.0.0.1:7897)。
type ProxyType string

const (
	// ProxyTypeSOCKS5 SOCKS5 代理。
	ProxyTypeSOCKS5 ProxyType = "socks5"
	// ProxyTypeHTTP HTTP CONNECT 隧道代理。
	ProxyTypeHTTP ProxyType = "http"
)

// TransportProxy 传输层代理配置:本机发出的 SSH TCP 连接先经过它。
// 与跳板机(ProxyJump)正交,可叠加使用。
type TransportProxy struct {
	Type ProxyType `json:"type"`
	Host string    `json:"host"`
	Port int       `json:"port"`
}

// ProxyJumpConfig 跳板机(ProxyJump)配置:先 SSH 连跳板,
// 再经其 TCP 转发通道直连目标机(等价 OpenSSH -J)。
type ProxyJumpConfig struct {
	Host string `json:"host"`
	Port int    `json:"port"`
	User string `json:"user"`
	Auth AuthMethod `json:"auth"`

	// Password 跳板机密码,仅 AuthPassword 时使用。
	Password string `json:"password,omitempty"`
	// KeyPath 跳板机私钥路径,仅 AuthPrivateKey 时使用。
	KeyPath string `json:"keyPath,omitempty"`
	// TrustedHostKey 跳板机自身的主机密钥指纹(TOFU,同目标机)。
	TrustedHostKey string `json:"trustedHostKey,omitempty"`
}

// PortOrDefault 返回有效端口,未设置时默认 22。
func (p ProxyJumpConfig) PortOrDefault() int {
	if p.Port == 0 {
		return 22
	}
	return p.Port
}

// ConnectionConfig 描述一条 SSH 连接。
// 该结构会跨 Wails 绑定序列化为 JSON,字段名即前端接口。
type ConnectionConfig struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Description 备注描述(可选),展示在服务器卡片上。
	Description string `json:"description,omitempty"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	User        string `json:"user"`
	Auth        AuthMethod `json:"auth"`

	// Password 密码,仅 AuthPassword 时使用。
	// M1 阶段由前端会话级传递,不落盘;持久化加密存储见 M3。
	Password string `json:"password,omitempty"`
	// KeyPath 私钥文件路径,仅 AuthPrivateKey 时使用。
	KeyPath string `json:"keyPath,omitempty"`
	// TrustedHostKey 已信任的主机密钥指纹(SHA256:...)。
	// 为空表示首次连接:握手后返回指纹,由用户确认(TOFU)。
	TrustedHostKey string `json:"trustedHostKey,omitempty"`
	// Proxy 传输层代理(可选,如本地 Clash SOCKS5/HTTP)。
	Proxy *TransportProxy `json:"proxy,omitempty"`
	// ProxyJump 跳板机配置(可选)。
	ProxyJump *ProxyJumpConfig `json:"proxyJump,omitempty"`
}

// PortOrDefault 返回有效端口,未设置时默认 22。
func (c ConnectionConfig) PortOrDefault() int {
	if c.Port == 0 {
		return 22
	}
	return c.Port
}

// Validate 校验配置合法性,返回面向用户的中文错误信息。
func (c ConnectionConfig) Validate() error {
	if c.Host == "" {
		return fmt.Errorf("主机不能为空")
	}
	if c.PortOrDefault() < 1 || c.PortOrDefault() > 65535 {
		return fmt.Errorf("端口无效: %d", c.Port)
	}
	if c.User == "" {
		return fmt.Errorf("用户名不能为空")
	}
	switch c.Auth {
	case AuthPassword:
		if c.Password == "" {
			return fmt.Errorf("密码不能为空")
		}
	case AuthPrivateKey:
		if c.KeyPath == "" {
			return fmt.Errorf("私钥文件路径不能为空")
		}
	default:
		return fmt.Errorf("未知的认证方式: %s", c.Auth)
	}

	if c.Proxy != nil {
		if c.Proxy.Host == "" {
			return fmt.Errorf("代理主机不能为空")
		}
		if c.Proxy.Port < 1 || c.Proxy.Port > 65535 {
			return fmt.Errorf("代理端口无效: %d", c.Proxy.Port)
		}
		switch c.Proxy.Type {
		case ProxyTypeSOCKS5, ProxyTypeHTTP:
		default:
			return fmt.Errorf("不支持的代理类型: %s", c.Proxy.Type)
		}
	}

	if c.ProxyJump != nil {
		if c.ProxyJump.Host == "" {
			return fmt.Errorf("跳板机主机不能为空")
		}
		if c.ProxyJump.User == "" {
			return fmt.Errorf("跳板机用户名不能为空")
		}
		switch c.ProxyJump.Auth {
		case AuthPassword:
			if c.ProxyJump.Password == "" {
				return fmt.Errorf("跳板机密码不能为空")
			}
		case AuthPrivateKey:
			if c.ProxyJump.KeyPath == "" {
				return fmt.Errorf("跳板机私钥文件路径不能为空")
			}
		default:
			return fmt.Errorf("跳板机未知的认证方式: %s", c.ProxyJump.Auth)
		}
	}
	return nil
}

package sshsvc

import (
	"fmt"
	"net"
	"strings"

	"golang.org/x/crypto/ssh"
)

// ErrHostKeyUnknown 表示首次连接:主机密钥尚未被信任,携带指纹等待用户确认。
// 上层捕获后应让用户核对指纹,确认后携 TrustedHostKey 重新连接。
// IsProxy 区分该指纹属于跳板机还是目标机,前端据此存入配置的对应字段。
type ErrHostKeyUnknown struct {
	Fingerprint string
	// Host/Port 指纹所属主机(跳板机或目标机),用于前端展示。
	Host string
	Port int
	// IsProxy 为 true 表示这是跳板机的指纹(存入 Proxy.TrustedHostKey)。
	IsProxy bool
}

func (e ErrHostKeyUnknown) Error() string {
	scope := "目标主机"
	if e.IsProxy {
		scope = "跳板机"
	}
	return fmt.Sprintf("首次连接,请确认%s(%s)的主机密钥指纹: %s", scope, e.Host, e.Fingerprint)
}

// hostKeyCallback 构造握手用 HostKeyCallback。
// got 会收到本次握手实际看到的主机密钥指纹;
// 若配置中已有受信指纹且不一致,直接拒绝连接(防中间人)。
func (c ConnectionConfig) hostKeyCallback(got *string) ssh.HostKeyCallback {
	return func(_ string, _ net.Addr, key ssh.PublicKey) error {
		*got = ssh.FingerprintSHA256(key)
		if c.TrustedHostKey == "" {
			return nil
		}
		if !strings.EqualFold(c.TrustedHostKey, *got) {
			return fmt.Errorf(
				"主机密钥与已信任指纹不符(期望 %s,实际 %s),已中止连接以防中间人攻击",
				c.TrustedHostKey, *got,
			)
		}
		return nil
	}
}

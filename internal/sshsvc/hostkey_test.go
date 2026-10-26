package sshsvc

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func testKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("生成测试密钥失败: %v", err)
	}
	key, err := ssh.NewPublicKey(pub)
	if err != nil {
		t.Fatalf("转换测试密钥失败: %v", err)
	}
	return key
}

func TestHostKeyCallbackTOFU(t *testing.T) {
	key := testKey(t)
	fp := ssh.FingerprintSHA256(key)

	t.Run("首次连接记录指纹并放行", func(t *testing.T) {
		cfg := ConnectionConfig{Host: "example.com"}
		var got string
		err := cfg.hostKeyCallback(&got)("example.com", nil, key)
		if err != nil {
			t.Fatalf("首次连接不应拒绝: %v", err)
		}
		if got != fp {
			t.Fatalf("指纹未记录: got=%q want=%q", got, fp)
		}
	})

	t.Run("已信任且指纹一致放行", func(t *testing.T) {
		cfg := ConnectionConfig{Host: "example.com", TrustedHostKey: fp}
		var got string
		if err := cfg.hostKeyCallback(&got)("example.com", nil, key); err != nil {
			t.Fatalf("指纹一致不应拒绝: %v", err)
		}
	})

	t.Run("指纹不一致拒绝(防中间人)", func(t *testing.T) {
		other := testKey(t)
		otherFP := ssh.FingerprintSHA256(other)
		cfg := ConnectionConfig{Host: "example.com", TrustedHostKey: fp}
		var got string
		err := cfg.hostKeyCallback(&got)("example.com", nil, other)
		if err == nil {
			t.Fatal("指纹不一致必须拒绝")
		}
		if !strings.Contains(err.Error(), otherFP) {
			t.Fatalf("错误信息应包含实际指纹: %v", err)
		}
	})
}

func TestConnectionConfigValidate(t *testing.T) {
	cases := []struct {
		name    string
		cfg     ConnectionConfig
		wantErr bool
	}{
		{"密码认证合法", ConnectionConfig{Host: "h", Port: 22, User: "u", Auth: AuthPassword, Password: "p"}, false},
		{"端口缺省为 22", ConnectionConfig{Host: "h", User: "u", Auth: AuthPassword, Password: "p"}, false},
		{"缺主机", ConnectionConfig{User: "u", Auth: AuthPassword, Password: "p"}, true},
		{"缺用户", ConnectionConfig{Host: "h", Auth: AuthPassword, Password: "p"}, true},
		{"密码认证缺密码", ConnectionConfig{Host: "h", User: "u", Auth: AuthPassword}, true},
		{"私钥认证缺路径", ConnectionConfig{Host: "h", User: "u", Auth: AuthPrivateKey}, true},
		{"端口越界", ConnectionConfig{Host: "h", Port: 70000, User: "u", Auth: AuthPassword, Password: "p"}, true},
		{"未知认证方式", ConnectionConfig{Host: "h", User: "u", Auth: AuthMethod("bogus")}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.cfg.Validate()
			if (err != nil) != tc.wantErr {
				t.Fatalf("Validate() err=%v, wantErr=%v", err, tc.wantErr)
			}
		})
	}
}

func TestErrHostKeyUnknownAs(t *testing.T) {
	err := ErrHostKeyUnknown{Fingerprint: "SHA256:abc"}
	var target ErrHostKeyUnknown
	if !errors.As(err, &target) {
		t.Fatal("ErrHostKeyUnknown 应可被 errors.As 提取")
	}
	if target.Fingerprint != "SHA256:abc" {
		t.Fatalf("指纹透传失败: %v", target)
	}
}

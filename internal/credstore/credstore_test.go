package credstore

import (
	"testing"

	"github.com/zalando/go-keyring"
)

func TestPasswordRoundTrip(t *testing.T) {
	keyring.MockInit() // 内存实现,不触碰真实钥匙串
	s := New()

	// 未保存时返回空串
	v, err := s.GetPassword("conn-1")
	if err != nil || v != "" {
		t.Fatalf("未保存应返回空串: v=%q err=%v", v, err)
	}

	if err := s.SetPassword("conn-1", "s3cret"); err != nil {
		t.Fatalf("保存失败: %v", err)
	}
	v, err = s.GetPassword("conn-1")
	if err != nil || v != "s3cret" {
		t.Fatalf("读取失败: v=%q err=%v", v, err)
	}

	// 覆盖保存
	if err := s.SetPassword("conn-1", "new"); err != nil {
		t.Fatalf("覆盖保存失败: %v", err)
	}
	v, _ = s.GetPassword("conn-1")
	if v != "new" {
		t.Fatalf("覆盖后应为 new,实际: %q", v)
	}

	if err := s.DeletePassword("conn-1"); err != nil {
		t.Fatalf("删除失败: %v", err)
	}
	v, _ = s.GetPassword("conn-1")
	if v != "" {
		t.Fatalf("删除后应返回空串,实际: %q", v)
	}
	// 重复删除幂等
	if err := s.DeletePassword("conn-1"); err != nil {
		t.Fatalf("重复删除应成功: %v", err)
	}
}

func TestHostKeyRoundTripAndIsolation(t *testing.T) {
	keyring.MockInit()
	s := New()

	if err := s.SetTrustedHostKey("conn-a", "SHA256:aaa"); err != nil {
		t.Fatalf("保存指纹失败: %v", err)
	}
	if err := s.SetTrustedHostKey("conn-b", "SHA256:bbb"); err != nil {
		t.Fatalf("保存指纹失败: %v", err)
	}

	a, err := s.GetTrustedHostKey("conn-a")
	if err != nil || a != "SHA256:aaa" {
		t.Fatalf("读取 a 失败: %q %v", a, err)
	}
	b, _ := s.GetTrustedHostKey("conn-b")
	if b != "SHA256:bbb" {
		t.Fatalf("读取 b 失败: %q", b)
	}

	// 密码与指纹互不干扰
	if err := s.SetPassword("conn-a", "pwd"); err != nil {
		t.Fatalf("保存密码失败: %v", err)
	}
	a, _ = s.GetTrustedHostKey("conn-a")
	if a != "SHA256:aaa" {
		t.Fatalf("保存密码后指纹不应变化: %q", a)
	}

	// DeleteAll 清空全部
	s.DeleteAll("conn-a")
	if v, _ := s.GetPassword("conn-a"); v != "" {
		t.Fatalf("DeleteAll 后密码应为空: %q", v)
	}
	if v, _ := s.GetTrustedHostKey("conn-a"); v != "" {
		t.Fatalf("DeleteAll 后指纹应为空: %q", v)
	}
	if b, _ := s.GetTrustedHostKey("conn-b"); b != "SHA256:bbb" {
		t.Fatalf("DeleteAll 不应影响其他连接: %q", b)
	}
}

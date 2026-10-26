//go:build windows

package hostcmd

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// TestConsoleDecodeChinese 验证子进程输出的中文(按系统 OEM 代码页编码)
// 被正确解码为 UTF-8。仅在中文系统(OEM=936)下有意义,其它代码页跳过。
func TestConsoleDecodeChinese(t *testing.T) {
	if cp := consoleCodePage(); cp != 936 {
		t.Skipf("系统 OEM 代码页为 %d(非 936),跳过中文解码测试", cp)
	}
	r := NewRunner()
	var (
		mu   sync.Mutex
		out  strings.Builder
		done = make(chan struct{})
	)
	r.OnOutput = func(_, _ string, data string) {
		mu.Lock()
		out.WriteString(data)
		mu.Unlock()
	}
	r.OnDone = func(_ string, _ int, _ string) { close(done) }

	r.Run(r.NextID(), "echo 中文测试", "")
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("命令执行超时")
	}
	mu.Lock()
	defer mu.Unlock()
	if !strings.Contains(out.String(), "中文测试") {
		t.Fatalf("中文未正确解码,输出: %q", out.String())
	}
}

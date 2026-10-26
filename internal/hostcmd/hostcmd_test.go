package hostcmd

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// waitDone 等待某次运行结束,返回退出码与错误信息。
func waitDone(t *testing.T, r *Runner, runID, command, cwd string) (string, int, string) {
	t.Helper()
	var (
		mu     sync.Mutex
		out    strings.Builder
		exit   int
		errMsg string
		doneCh = make(chan struct{})
	)
	r.OnOutput = func(_ string, _ string, data string) {
		mu.Lock()
		out.WriteString(data)
		mu.Unlock()
	}
	r.OnDone = func(_ string, code int, em string) {
		exit, errMsg = code, em
		close(doneCh)
	}
	r.Run(runID, command, cwd)
	select {
	case <-doneCh:
	case <-time.After(10 * time.Second):
		t.Fatal("命令执行超时")
	}
	mu.Lock()
	defer mu.Unlock()
	return out.String(), exit, errMsg
}

func TestRunnerEchoAndExitZero(t *testing.T) {
	r := NewRunner()
	out, code, em := waitDone(t, r, r.NextID(), "echo hello_hostcmd", "")
	if code != 0 || em != "" {
		t.Fatalf("期望退出码 0、无错误,得到 code=%d err=%q", code, em)
	}
	if !strings.Contains(out, "hello_hostcmd") {
		t.Fatalf("输出未包含预期内容: %q", out)
	}
}

func TestRunnerNonZeroExit(t *testing.T) {
	r := NewRunner()
	_, code, _ := waitDone(t, r, r.NextID(), "exit 3", "")
	if code != 3 {
		t.Fatalf("期望退出码 3,得到 %d", code)
	}
}

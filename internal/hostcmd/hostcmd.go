// Package hostcmd 在宿主机(本地机器)上执行 shell 命令(对应命令的"外部"类型)。
// 与 SSH 领域层无关:进程由本应用直接创建,cmd.Wait() 返回即代表执行结束,
// 并能拿到退出码 —— 所以"执行是否完成"是精确可靠的(不像远端交互终端要猜提示符)。
package hostcmd

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os/exec"
	"runtime"
	"strconv"
	"sync"
)

// Runner 管理本机命令运行:每次运行一个 goroutine,输出流式回调、
// 结束回调携带退出码;支持取消(结束整棵进程树)。
type Runner struct {
	mu   sync.Mutex
	runs map[string]context.CancelFunc
	seq  uint64

	// OnOutput 输出回调(stream: "stdout" | "stderr");在读取 goroutine 中调用,须非阻塞。
	OnOutput func(runID, stream, data string)
	// OnDone 结束回调(exitCode<0 且 errMsg!="" 表示启动/运行异常);在运行 goroutine 中调用。
	OnDone func(runID string, exitCode int, errMsg string)
}

// NewRunner 构造运行管理器。
func NewRunner() *Runner {
	return &Runner{runs: make(map[string]context.CancelFunc)}
}

// NextID 生成运行 ID。
func (r *Runner) NextID() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seq++
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "host-" + strconv.FormatUint(r.seq, 10) + "-" + hex.EncodeToString(b)
}

// Run 异步执行命令文本(command 经 cmd /C 或 sh -c 执行;cwd 为空用当前工作目录)。
func (r *Runner) Run(runID, command, cwd string) {
	ctx, cancel := context.WithCancel(context.Background())
	r.mu.Lock()
	r.runs[runID] = cancel
	r.mu.Unlock()

	go func() {
		defer func() {
			r.mu.Lock()
			delete(r.runs, runID)
			r.mu.Unlock()
			cancel()
		}()

		cmd := shellCommand(ctx, command)
		if cwd != "" {
			cmd.Dir = cwd
		}
		// 取消时结束整棵进程树:Windows 下 cmd 拉起的子进程不会随父进程一起退出。
		cmd.Cancel = func() error {
			if runtime.GOOS == "windows" && cmd.Process != nil {
				_ = exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid)).Run()
				return nil
			}
			if cmd.Process != nil {
				return cmd.Process.Kill()
			}
			return nil
		}

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			r.emitDone(runID, -1, err.Error())
			return
		}
		stderr, err := cmd.StderrPipe()
		if err != nil {
			r.emitDone(runID, -1, err.Error())
			return
		}
		if err := cmd.Start(); err != nil {
			r.emitDone(runID, -1, err.Error())
			return
		}

		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); r.pump(runID, "stdout", newConsoleReader(stdout)) }()
		go func() { defer wg.Done(); r.pump(runID, "stderr", newConsoleReader(stderr)) }()
		waitErr := cmd.Wait()
		wg.Wait()

		exitCode := 0
		errMsg := ""
		if waitErr != nil {
			var ee *exec.ExitError
			if errors.As(waitErr, &ee) {
				exitCode = ee.ExitCode()
			} else {
				exitCode = -1
				errMsg = waitErr.Error()
			}
		}
		r.emitDone(runID, exitCode, errMsg)
	}()
}

// Cancel 取消指定运行(结束进程树);返回是否找到该运行。
func (r *Runner) Cancel(runID string) bool {
	r.mu.Lock()
	cancel, ok := r.runs[runID]
	r.mu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

func (r *Runner) emitDone(runID string, exitCode int, errMsg string) {
	if r.OnDone != nil {
		r.OnDone(runID, exitCode, errMsg)
	}
}

// pump 按块读取输出(不按行,保留无换行的进度类输出)。
func (r *Runner) pump(runID, stream string, rc io.Reader) {
	buf := make([]byte, 32*1024)
	for {
		n, err := rc.Read(buf)
		if n > 0 && r.OnOutput != nil {
			r.OnOutput(runID, stream, string(buf[:n]))
		}
		if err != nil {
			return
		}
	}
}

// shellCommand 构造平台 shell 命令:Windows 用 cmd /C,其他用 sh -c。
func shellCommand(ctx context.Context, command string) *exec.Cmd {
	if runtime.GOOS == "windows" {
		return exec.CommandContext(ctx, "cmd", "/C", command)
	}
	return exec.CommandContext(ctx, "/bin/sh", "-c", command)
}

package sshsvc

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// openTestSession 建立一条带 SFTP 子系统的测试会话(完成 TOFU)。
func openTestSession(t *testing.T, mgr *Manager, addr string) *TerminalSession {
	t.Helper()
	cfg := testCfg(addr)
	_, err := mgr.OpenTerminal(cfg)
	var unknown ErrHostKeyUnknown
	if !errors.As(err, &unknown) {
		t.Fatalf("首次连接应返回 ErrHostKeyUnknown,实际: %v", err)
	}
	cfg.TrustedHostKey = unknown.Fingerprint
	ts, err := mgr.OpenTerminal(cfg)
	if err != nil {
		t.Fatalf("建立会话失败: %v", err)
	}
	return ts
}

// newTestTransferManager 构造传输管理器并预注册完成回调
// (必须先于发起任务注册,否则小文件任务瞬间完成、事件丢失)。
func newTestTransferManager(t *testing.T, mgr *Manager) (*TransferManager, <-chan TransferInfo) {
	t.Helper()
	tm := NewTransferManager(NewRemoteFS(mgr))
	done := make(chan TransferInfo, 8)
	tm.OnDone = func(info TransferInfo) { done <- info }
	return tm, done
}

// waitDone 等待传输终态,返回最终快照。
func waitDone(t *testing.T, done <-chan TransferInfo, timeout time.Duration) TransferInfo {
	t.Helper()
	select {
	case info := <-done:
		return info
	case <-time.After(timeout):
		t.Fatal("等待传输完成超时")
		return TransferInfo{}
	}
}

// writeFile 写本地文件(自动建父目录)。
func writeFile(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("建目录失败: %v", err)
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("写文件失败: %v", err)
	}
}

// assertTreeEqual 断言两棵目录树内容一致(逐文件字节比较)。
func assertTreeEqual(t *testing.T, a, b string) {
	t.Helper()
	var filesA, filesB []string
	_ = filepath.Walk(a, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			rel, _ := filepath.Rel(a, p)
			filesA = append(filesA, rel)
		}
		return nil
	})
	_ = filepath.Walk(b, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			rel, _ := filepath.Rel(b, p)
			filesB = append(filesB, rel)
		}
		return nil
	})
	if len(filesA) != len(filesB) {
		t.Fatalf("文件数量不一致: %d vs %d (%v vs %v)", len(filesA), len(filesB), filesA, filesB)
	}
	for _, rel := range filesA {
		ca, err := os.ReadFile(filepath.Join(a, rel))
		if err != nil {
			t.Fatalf("读取 %s 失败: %v", rel, err)
		}
		cb, err := os.ReadFile(filepath.Join(b, rel))
		if err != nil {
			t.Fatalf("读取 %s 失败: %v", rel, err)
		}
		if !bytes.Equal(ca, cb) {
			t.Fatalf("文件内容不一致: %s", rel)
		}
	}
}

// posixRemoteRoot 把 Windows 本地路径转成 pkg/sftp 服务器可解析的 POSIX 形式
// (测试服务器无 chroot,绝对路径按盘符解析,见 manager_test.go 子系统注释)。
func posixRemoteRoot(localRoot string) string {
	return "/" + filepath.ToSlash(localRoot)
}

// TestDirUploadAndDownload 目录上传 + 下载端到端:嵌套结构、内容一致、总大小聚合。
func TestDirUploadAndDownload(t *testing.T) {
	addr, sftpRoot := startTestServer(t, nil)
	mgr := NewManager()
	ts := openTestSession(t, mgr, addr)
	defer mgr.Close(ts.ID)

	tm, done := newTestTransferManager(t, mgr)
	remoteRoot := posixRemoteRoot(sftpRoot)

	// 本地目录树:根文件 + 嵌套子目录 + 深层文件
	localDir := t.TempDir()
	src := filepath.Join(localDir, "site")
	writeFile(t, filepath.Join(src, "index.html"), bytes.Repeat([]byte("hello html "), 100))
	writeFile(t, filepath.Join(src, "assets", "logo.png"), []byte{0x89, 'P', 'N', 'G', 1, 2, 3})
	writeFile(t, filepath.Join(src, "js", "deep", "app.js"), bytes.Repeat([]byte("console.log(1);"), 500))
	var wantTotal int64
	_ = filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			wantTotal += info.Size()
		}
		return nil
	})

	// 上传目录到远端根
	info, err := tm.Upload(ts.ID, src, remoteRoot, nil)
	if err != nil {
		t.Fatalf("发起目录上传失败: %v", err)
	}
	if !info.IsDir || info.Size != wantTotal {
		t.Fatalf("上传任务元数据异常: isDir=%v size=%d want=%d", info.IsDir, info.Size, wantTotal)
	}
	final := waitDone(t, done, 10*time.Second)
	if final.Status != TransferDone {
		t.Fatalf("目录上传未完成: status=%s err=%s", final.Status, final.Error)
	}
	if final.Transferred != wantTotal {
		t.Fatalf("聚合进度异常: %d want %d", final.Transferred, wantTotal)
	}
	// 远端落盘校验(服务器 SFTP 根即本地目录)
	assertTreeEqual(t, src, filepath.Join(sftpRoot, "site"))

	// 下载该目录回来
	dlDir := filepath.Join(localDir, "dl")
	info2, err := tm.Download(ts.ID, remoteRoot+"/site", dlDir, nil)
	if err != nil {
		t.Fatalf("发起目录下载失败: %v", err)
	}
	if !info2.IsDir {
		t.Fatal("下载任务应为目录类型")
	}
	final2 := waitDone(t, done, 10*time.Second)
	if final2.Status != TransferDone {
		t.Fatalf("目录下载未完成: status=%s err=%s", final2.Status, final2.Error)
	}
	assertTreeEqual(t, src, filepath.Join(dlDir, "site"))
}

// TestSingleFileUploadAndDownload 单文件往返(回归:重构后单文件路径不受影响)。
func TestSingleFileUploadAndDownload(t *testing.T) {
	addr, sftpRoot := startTestServer(t, nil)
	mgr := NewManager()
	ts := openTestSession(t, mgr, addr)
	defer mgr.Close(ts.ID)

	tm, done := newTestTransferManager(t, mgr)
	remoteRoot := posixRemoteRoot(sftpRoot)

	content := bytes.Repeat([]byte("data "), 512*1024) // 2MB,覆盖并发写管道(>32KB 分包)路径
	local := t.TempDir()
	src := filepath.Join(local, "big.txt")
	writeFile(t, src, content)

	info, err := tm.Upload(ts.ID, src, remoteRoot, nil)
	if err != nil {
		t.Fatalf("上传失败: %v", err)
	}
	if info.IsDir {
		t.Fatal("单文件任务不应是目录类型")
	}
	final := waitDone(t, done, 10*time.Second)
	if final.Status != TransferDone || final.Transferred != int64(len(content)) {
		t.Fatalf("上传异常: status=%s transferred=%d", final.Status, final.Transferred)
	}
	up, err := os.ReadFile(filepath.Join(sftpRoot, "big.txt"))
	if err != nil || !bytes.Equal(up, content) {
		t.Fatalf("远端文件内容不一致: %v", err)
	}

	dl := filepath.Join(local, "dl")
	info2, err := tm.Download(ts.ID, remoteRoot+"/big.txt", dl, nil)
	if err != nil {
		t.Fatalf("下载失败: %v", err)
	}
	if info2.Size != int64(len(content)) {
		t.Fatalf("下载大小应已知: %d want %d", info2.Size, len(content))
	}
	final2 := waitDone(t, done, 10*time.Second)
	if final2.Status != TransferDone {
		t.Fatalf("下载异常: status=%s err=%s", final2.Status, final2.Error)
	}
	down, err := os.ReadFile(filepath.Join(dl, "big.txt"))
	if err != nil || !bytes.Equal(down, content) {
		t.Fatalf("本地文件内容不一致: %v", err)
	}
}

// TestUploadBytes 内容直传端到端(拖拽上传路径):落盘校验 + 大小上限。
func TestUploadBytes(t *testing.T) {
	addr, sftpRoot := startTestServer(t, nil)
	mgr := NewManager()
	ts := openTestSession(t, mgr, addr)
	defer mgr.Close(ts.ID)

	tm, done := newTestTransferManager(t, mgr)
	remoteRoot := posixRemoteRoot(sftpRoot)

	content := []byte("dragged file content")
	_, err := tm.UploadBytes(ts.ID, remoteRoot, "dropped.txt", "", content)
	if err != nil {
		t.Fatalf("发起失败: %v", err)
	}
	final := waitDone(t, done, 10*time.Second)
	if final.Status != TransferDone || final.Transferred != int64(len(content)) {
		t.Fatalf("上传异常: status=%s transferred=%d", final.Status, final.Transferred)
	}
	got, err := os.ReadFile(filepath.Join(sftpRoot, "dropped.txt"))
	if err != nil || !bytes.Equal(got, content) {
		t.Fatalf("远端落盘校验失败: %v", err)
	}

	// 子目录层级(目录拖入)
	info2, err := tm.UploadBytes(ts.ID, remoteRoot, "file2.txt", "sub/deep", []byte("nested"))
	if err != nil {
		t.Fatalf("带层级发起失败: %v", err)
	}
	if info2.RemotePath != remoteRoot+"/sub/deep/file2.txt" {
		t.Fatalf("目标路径异常: %s", info2.RemotePath)
	}
	final2 := waitDone(t, done, 10*time.Second)
	if final2.Status != TransferDone {
		t.Fatalf("带层级上传异常: %s", final2.Error)
	}
	if got, _ := os.ReadFile(filepath.Join(sftpRoot, "sub", "deep", "file2.txt")); string(got) != "nested" {
		t.Fatalf("带层级落盘校验失败: %q", got)
	}

	// 参数与大小校验
	if _, err := tm.UploadBytes(ts.ID, remoteRoot, "", "", []byte("x")); err == nil {
		t.Fatal("空文件名应报错")
	}
	if _, err := tm.UploadBytes(ts.ID, remoteRoot, "big.bin", "", make([]byte, MaxUploadBytes+1)); err == nil {
		t.Fatal("超大内容应报错")
	}
}

// TestTransferErrors 错误路径:远端路径不存在、本地目录不可访问。
func TestTransferErrors(t *testing.T) {
	addr, _ := startTestServer(t, nil)
	mgr := NewManager()
	ts := openTestSession(t, mgr, addr)
	defer mgr.Close(ts.ID)

	tm := NewTransferManager(NewRemoteFS(mgr)) // 仅测同步错误路径,无需完成回调

	if _, err := tm.Upload(ts.ID, filepath.Join(t.TempDir(), "不存在"), "/", nil); err == nil {
		t.Fatal("不存在的本地路径应报错")
	}
	if _, err := tm.Download(ts.ID, "/no-such-remote-file", t.TempDir(), nil); err == nil {
		t.Fatal("不存在的远端路径应报错")
	}
	// 本地目标是既有文件(非目录)时报错
	filePath := filepath.Join(t.TempDir(), "afile")
	writeFile(t, filePath, []byte("x"))
	if _, err := tm.Download(ts.ID, "/whatever", filePath, nil); err == nil {
		t.Fatal("本地目标不是目录应报错")
	}
}

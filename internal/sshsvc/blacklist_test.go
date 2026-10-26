package sshsvc

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestIsExcludedPaths 黑名单路径匹配:命中自身与子树,不误伤前缀相似的同名项。
func TestIsExcludedPaths(t *testing.T) {
	sep := string(os.PathSeparator)
	root := "C:" + sep + "data"
	local := []string{root + sep + "secret", root + sep + "a.env"}
	if !isExcludedLocal(root+sep+"secret", local) {
		t.Fatal("目录自身应命中")
	}
	if !isExcludedLocal(root+sep+"secret"+sep+"k.txt", local) {
		t.Fatal("被排除目录下的文件应命中")
	}
	if !isExcludedLocal(root+sep+"a.env", local) {
		t.Fatal("被排除文件应命中")
	}
	if isExcludedLocal(root+sep+"ok.txt", local) {
		t.Fatal("无关文件不应命中")
	}
	if isExcludedLocal(root+sep+"secret2", local) {
		t.Fatal("前缀相似的同级目录不应误命中")
	}

	remote := []string{"/var/log", "/etc/passwd"}
	if !isExcludedRemote("/var/log", remote) || !isExcludedRemote("/var/log/syslog", remote) {
		t.Fatal("远端目录及其子文件应命中")
	}
	if !isExcludedRemote("/etc/passwd", remote) {
		t.Fatal("远端文件应命中")
	}
	if isExcludedRemote("/var/logs/x", remote) {
		t.Fatal("前缀相似目录不应命中")
	}
	if isExcludedRemote("/etc/passwd.bak", remote) {
		t.Fatal("后缀相似文件不应命中")
	}
}

// TestTransferBlacklistExcludes 端到端:黑名单中的文件/目录(含子树)不参与上传与下载,
// 总大小也只统计未排除的文件。
func TestTransferBlacklistExcludes(t *testing.T) {
	addr, sftpRoot := startTestServer(t, nil)
	mgr := NewManager()
	ts := openTestSession(t, mgr, addr)
	defer mgr.Close(ts.ID)

	tm, done := newTestTransferManager(t, mgr)
	remoteRoot := posixRemoteRoot(sftpRoot)

	// 本地目录树:一个保留文件 + 一个被排除文件 + 一个被排除目录
	localDir := t.TempDir()
	src := filepath.Join(localDir, "site")
	writeFile(t, filepath.Join(src, "keep.txt"), []byte("keep"))
	writeFile(t, filepath.Join(src, "secret.env"), []byte("secret"))
	writeFile(t, filepath.Join(src, "node_modules", "pkg", "index.js"), []byte("js"))

	exclude := []string{filepath.Join(src, "secret.env"), filepath.Join(src, "node_modules")}
	info, err := tm.Upload(ts.ID, src, remoteRoot, exclude)
	if err != nil {
		t.Fatalf("发起上传失败: %v", err)
	}
	if info.Size != 4 {
		t.Fatalf("总大小应只统计未排除文件(keep=4),实际 %d", info.Size)
	}
	if final := waitDone(t, done, 10*time.Second); final.Status != TransferDone {
		t.Fatalf("上传未完成: status=%s err=%s", final.Status, final.Error)
	}
	if _, err := os.Stat(filepath.Join(sftpRoot, "site", "keep.txt")); err != nil {
		t.Fatalf("keep.txt 应已上传: %v", err)
	}
	if _, err := os.Stat(filepath.Join(sftpRoot, "site", "secret.env")); !os.IsNotExist(err) {
		t.Fatal("secret.env 不应被上传")
	}
	if _, err := os.Stat(filepath.Join(sftpRoot, "site", "node_modules")); !os.IsNotExist(err) {
		t.Fatal("node_modules 不应被上传")
	}

	// 单文件直接命中黑名单:应拒绝发起
	if _, err := tm.Upload(ts.ID, filepath.Join(src, "secret.env"), remoteRoot, exclude); err == nil {
		t.Fatal("黑名单中的单文件应拒绝上传")
	}

	// 下载:先原样上传完整树,再带黑名单下载
	full := filepath.Join(localDir, "full")
	writeFile(t, filepath.Join(full, "keep.log"), []byte("keep-log"))
	writeFile(t, filepath.Join(full, "skip.log"), []byte("skip-log"))
	writeFile(t, filepath.Join(full, "sub", "keep2.log"), []byte("keep2"))
	if _, err := tm.Upload(ts.ID, full, remoteRoot, nil); err != nil {
		t.Fatalf("完整上传失败: %v", err)
	}
	if final := waitDone(t, done, 10*time.Second); final.Status != TransferDone {
		t.Fatalf("完整上传未完成: %s", final.Status)
	}

	remoteFull := remoteRoot + "/full"
	dl := t.TempDir()
	if _, err := tm.Download(ts.ID, remoteFull, dl, []string{remoteFull + "/skip.log"}); err != nil {
		t.Fatalf("发起下载失败: %v", err)
	}
	if final := waitDone(t, done, 10*time.Second); final.Status != TransferDone {
		t.Fatalf("下载未完成: status=%s err=%s", final.Status, final.Error)
	}
	dlDir := filepath.Join(dl, "full")
	if _, err := os.Stat(filepath.Join(dlDir, "keep.log")); err != nil {
		t.Fatalf("keep.log 应已下载: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dlDir, "sub", "keep2.log")); err != nil {
		t.Fatalf("sub/keep2.log 应已下载: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dlDir, "skip.log")); !os.IsNotExist(err) {
		t.Fatal("skip.log 不应被下载")
	}

	// 命令"传输":file 语义拒绝黑名单源文件;dir 语义排除命中子树
	if _, err := tm.UploadFileTo(ts.ID, filepath.Join(src, "secret.env"), remoteRoot+"/cmd.env", exclude); err == nil {
		t.Fatal("黑名单中的源文件应拒绝 file 传输")
	}
	remoteCmd := remoteRoot + "/cmd"
	if _, err := tm.UploadDirContents(ts.ID, src, remoteCmd, exclude); err != nil {
		t.Fatalf("dir 传输发起失败: %v", err)
	}
	if final := waitDone(t, done, 10*time.Second); final.Status != TransferDone {
		t.Fatalf("dir 传输未完成: status=%s err=%s", final.Status, final.Error)
	}
	if _, err := os.Stat(filepath.Join(sftpRoot, "cmd", "keep.txt")); err != nil {
		t.Fatalf("keep.txt 应随 dir 传输上传: %v", err)
	}
	if _, err := os.Stat(filepath.Join(sftpRoot, "cmd", "secret.env")); !os.IsNotExist(err) {
		t.Fatal("secret.env 不应随 dir 传输上传")
	}
	if _, err := os.Stat(filepath.Join(sftpRoot, "cmd", "node_modules")); !os.IsNotExist(err) {
		t.Fatal("node_modules 不应随 dir 传输上传")
	}
}

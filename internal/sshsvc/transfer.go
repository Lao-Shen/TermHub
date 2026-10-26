package sshsvc

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
)

// TransferKind 传输方向。
type TransferKind string

const (
	TransferUpload   TransferKind = "upload"
	TransferDownload TransferKind = "download"
)

// TransferStatus 传输状态。
type TransferStatus string

const (
	TransferRunning  TransferStatus = "running"
	TransferDone     TransferStatus = "done"
	TransferError    TransferStatus = "error"
	TransferCanceled TransferStatus = "canceled"
)

// TransferInfo 传输任务快照(经绑定/事件暴露给前端)。
type TransferInfo struct {
	ID         string       `json:"id"`
	Kind       TransferKind `json:"kind"`
	SessionID  string       `json:"sessionId"`
	LocalPath  string       `json:"localPath"`
	RemotePath string       `json:"remotePath"`
	// IsDir 为 true 表示目录递归传输,Size/Transferred 为整棵树的字节聚合。
	IsDir       bool           `json:"isDir"`
	Size        int64          `json:"size"`
	Transferred int64          `json:"transferred"`
	Status      TransferStatus `json:"status"`
	Error       string         `json:"error,omitempty"`
}

var errTransferCanceled = errors.New("已取消")

// TransferManager 传输任务池:上传/下载(单文件或目录树)在独立 goroutine 中执行,
// 进度与结果经回调上抛(由桥接层转发为事件);任务可取消。
type TransferManager struct {
	fs *RemoteFS

	mu    sync.Mutex
	tasks map[string]*transferTask

	// OnProgress 进度回调,已做节流(每任务约 10 次/秒)。
	OnProgress func(t TransferInfo)
	// OnDone 终态回调(done/error/canceled)。
	OnDone func(t TransferInfo)
}

type transferTask struct {
	info   TransferInfo
	cancel chan struct{}
	// lastNotify 节流进度通知。
	lastNotify time.Time
	// runner 传输执行体(单文件/目录树)。
	runner func(task *transferTask)
}

// NewTransferManager 构造传输管理器。
func NewTransferManager(fs *RemoteFS) *TransferManager {
	return &TransferManager{fs: fs, tasks: make(map[string]*transferTask)}
}

// Upload 上传本地文件或目录树到会话的远端目录,立即返回任务快照。
// 目录上传的远端目标为 remoteDir/<本地目录名>。
// exclude 为黑名单路径(绝对路径);命中的文件/目录(含其整个子树)不参与传输。
func (m *TransferManager) Upload(sessionID, localPath, remoteDir string, exclude []string) (TransferInfo, error) {
	st, err := os.Stat(localPath)
	if err != nil {
		return TransferInfo{}, fmt.Errorf("本地路径不可访问: %w", err)
	}
	if st.IsDir() {
		files, total, err := scanLocalDir(localPath, exclude)
		if err != nil {
			return TransferInfo{}, fmt.Errorf("扫描本地目录失败: %w", err)
		}
		if len(files) == 0 {
			return TransferInfo{}, errors.New("目录为空,没有可上传的文件(可能全被黑名单排除)")
		}
		info := TransferInfo{
			ID:         newID(),
			Kind:       TransferUpload,
			SessionID:  sessionID,
			LocalPath:  localPath,
			RemotePath: JoinRemotePath(remoteDir, filepath.Base(localPath)),
			IsDir:      true,
			Size:       total,
			Status:     TransferRunning,
		}
		m.start(info, func(task *transferTask) { m.runDirUpload(task, files) })
		return info, nil
	}
	if isExcludedLocal(localPath, exclude) {
		return TransferInfo{}, fmt.Errorf("该文件在黑名单中,已跳过: %s", filepath.Base(localPath))
	}
	info := TransferInfo{
		ID:         newID(),
		Kind:       TransferUpload,
		SessionID:  sessionID,
		LocalPath:  localPath,
		RemotePath: JoinRemotePath(remoteDir, filepath.Base(localPath)),
		Size:       st.Size(),
		Status:     TransferRunning,
	}
	m.start(info, func(task *transferTask) { m.runUpload(task) })
	return info, nil
}

// UploadFileTo 上传单个本地文件到远端"完整目标文件路径"(支持改名),远端父目录自动创建。
// 与 Upload 的区别:Upload 的目标是目录(保留原文件名),本方法目标是完整文件路径。
// exclude 为本地黑名单路径:源文件命中时直接拒绝。
func (m *TransferManager) UploadFileTo(sessionID, localPath, remotePath string, exclude []string) (TransferInfo, error) {
	st, err := os.Stat(localPath)
	if err != nil {
		return TransferInfo{}, fmt.Errorf("本地路径不可访问: %w", err)
	}
	if st.IsDir() {
		return TransferInfo{}, errors.New("本地路径是目录,请使用 dir 传输")
	}
	if isExcludedLocal(localPath, exclude) {
		return TransferInfo{}, fmt.Errorf("该文件在黑名单中,已跳过: %s", filepath.Base(localPath))
	}
	info := TransferInfo{
		ID:         newID(),
		Kind:       TransferUpload,
		SessionID:  sessionID,
		LocalPath:  localPath,
		RemotePath: remotePath,
		Size:       st.Size(),
		Status:     TransferRunning,
	}
	m.start(info, func(task *transferTask) { m.runUploadTo(task) })
	return info, nil
}

// UploadDirContents 把本地目录的"内容"上传到远端目录(保留子目录结构),不包含目录本身;
// 远端目录(含父目录)不存在时自动创建。与 Upload 的区别:Upload 会在远端目录下再建一层本地目录名。
// exclude 为本地黑名单路径:命中的文件/目录(含子树)不参与传输。
func (m *TransferManager) UploadDirContents(sessionID, localDir, remoteDir string, exclude []string) (TransferInfo, error) {
	st, err := os.Stat(localDir)
	if err != nil {
		return TransferInfo{}, fmt.Errorf("本地路径不可访问: %w", err)
	}
	if !st.IsDir() {
		return TransferInfo{}, errors.New("本地路径不是目录,请使用 file 传输")
	}
	files, total, err := scanLocalDir(localDir, exclude)
	if err != nil {
		return TransferInfo{}, fmt.Errorf("扫描本地目录失败: %w", err)
	}
	if len(files) == 0 {
		return TransferInfo{}, errors.New("目录为空,没有可上传的文件(可能全被黑名单排除)")
	}
	info := TransferInfo{
		ID:         newID(),
		Kind:       TransferUpload,
		SessionID:  sessionID,
		LocalPath:  localDir,
		RemotePath: remoteDir,
		IsDir:      true,
		Size:       total,
		Status:     TransferRunning,
	}
	m.start(info, func(task *transferTask) { m.runDirContentsUpload(task, files) })
	return info, nil
}

// Download 下载远端文件或目录树到本地目录,立即返回任务快照。
// 目录下载的本地目标为 localDir/<远端目录名>;localDir 不存在时自动创建(mkdir -p 语义)。
// exclude 为黑名单路径(远端绝对路径);命中的文件/目录(含其整个子树)不参与传输。
func (m *TransferManager) Download(sessionID, remotePath, localDir string, exclude []string) (TransferInfo, error) {
	st, err := os.Stat(localDir)
	if err != nil && os.IsNotExist(err) {
		if mkErr := os.MkdirAll(localDir, 0o755); mkErr != nil {
			return TransferInfo{}, fmt.Errorf("创建本地目录失败: %w", mkErr)
		}
	} else if err != nil || !st.IsDir() {
		return TransferInfo{}, fmt.Errorf("本地目录不可访问: %s", localDir)
	}
	ts, err := m.fs.mgr.Get(sessionID)
	if err != nil {
		return TransferInfo{}, err
	}
	c, err := ts.SFTPClient()
	if err != nil {
		return TransferInfo{}, err
	}
	fi, err := c.Stat(remotePath)
	if err != nil {
		return TransferInfo{}, fmt.Errorf("远端路径不可访问: %w", err)
	}
	if fi.IsDir() {
		info := TransferInfo{
			ID:         newID(),
			Kind:       TransferDownload,
			SessionID:  sessionID,
			LocalPath:  filepath.Join(localDir, path.Base(remotePath)),
			RemotePath: remotePath,
			IsDir:      true,
			Status:     TransferRunning,
		}
		m.start(info, func(task *transferTask) { m.runDirDownload(task, exclude) })
		return info, nil
	}
	if isExcludedRemote(remotePath, exclude) {
		return TransferInfo{}, fmt.Errorf("该文件在黑名单中,已跳过: %s", path.Base(remotePath))
	}
	info := TransferInfo{
		ID:         newID(),
		Kind:       TransferDownload,
		SessionID:  sessionID,
		LocalPath:  filepath.Join(localDir, path.Base(remotePath)),
		RemotePath: remotePath,
		Size:       fi.Size(),
		Status:     TransferRunning,
	}
	m.start(info, func(task *transferTask) { m.runDownload(task) })
	return info, nil
}

// MaxUploadBytes 内容直传(拖拽上传)单文件上限,超出建议走文件传输。
const MaxUploadBytes = 100 * 1024 * 1024

// UploadBytes 直接把内存内容上传为远端文件(拖拽上传路径):
// data 写入 remoteDir/relDir/fileName,relDir 为空表示当前目录。
func (m *TransferManager) UploadBytes(sessionID, remoteDir, fileName, relDir string, data []byte) (TransferInfo, error) {
	if fileName == "" {
		return TransferInfo{}, errors.New("文件名不能为空")
	}
	if len(data) == 0 {
		return TransferInfo{}, errors.New("文件内容为空")
	}
	if len(data) > MaxUploadBytes {
		return TransferInfo{}, fmt.Errorf("文件超过 %dMB,请使用文件传输工具上传", MaxUploadBytes/1024/1024)
	}
	dir := remoteDir
	if relDir != "" {
		dir = path.Join(remoteDir, relDir)
	}
	info := TransferInfo{
		ID:         newID(),
		Kind:       TransferUpload,
		SessionID:  sessionID,
		LocalPath:  fileName,
		RemotePath: JoinRemotePath(dir, fileName),
		Size:       int64(len(data)),
		Status:     TransferRunning,
	}
	m.start(info, func(task *transferTask) { m.runUploadBytes(task, data) })
	return info, nil
}

// runUploadBytes 内存内容上传:建目录 → 创建文件 → 分块写入并推进进度。
func (m *TransferManager) runUploadBytes(task *transferTask, data []byte) {
	c, err := m.openSFTP(task)
	if err != nil {
		return
	}
	dir := path.Dir(task.info.RemotePath)
	if dir != "/" {
		if err := c.MkdirAll(dir); err != nil {
			m.fail(task, fmt.Errorf("创建远端目录失败: %w", err))
			return
		}
	}
	out, err := c.Create(task.info.RemotePath)
	if err != nil {
		m.fail(task, fmt.Errorf("创建远端文件失败: %w", err))
		return
	}
	defer out.Close()
	if err := m.copy(task, out, bytes.NewReader(data)); err != nil {
		m.fail(task, err)
	}
}

// CancelTransfer 取消进行中的任务(尽力而为,下次块边界生效)。
func (m *TransferManager) CancelTransfer(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	task, ok := m.tasks[id]
	if !ok || task.info.Status != TransferRunning {
		return nil // 已完成或不存在,幂等
	}
	select {
	case <-task.cancel:
	default:
		close(task.cancel)
	}
	return nil
}

// Transfers 返回全部任务快照。
func (m *TransferManager) Transfers() []TransferInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]TransferInfo, 0, len(m.tasks))
	for _, t := range m.tasks {
		out = append(out, t.info)
	}
	return out
}

// RunningCount 进行中的任务数(应用退出前提示用)。
func (m *TransferManager) RunningCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, t := range m.tasks {
		if t.info.Status == TransferRunning {
			n++
		}
	}
	return n
}

// ---- 任务执行 ----

func (m *TransferManager) start(info TransferInfo, runner func(*transferTask)) {
	task := &transferTask{info: info, cancel: make(chan struct{}), runner: runner}
	m.mu.Lock()
	m.tasks[info.ID] = task
	m.mu.Unlock()
	go m.run(task)
}

func (m *TransferManager) run(task *transferTask) {
	task.runner(task)

	m.mu.Lock()
	if task.info.Status == TransferRunning {
		task.info.Status = TransferDone
	}
	snapshot := task.info
	delete(m.tasks, task.info.ID)
	m.mu.Unlock()

	if m.OnDone != nil {
		m.OnDone(snapshot)
	}
}

// openSFTP 取会话的 SFTP 通道,失败时标记任务。
func (m *TransferManager) openSFTP(task *transferTask) (*sftp.Client, error) {
	ts, err := m.fs.mgr.Get(task.info.SessionID)
	if err != nil {
		m.fail(task, err)
		return nil, err
	}
	c, err := ts.SFTPClient()
	if err != nil {
		m.fail(task, err)
		return nil, err
	}
	return c, nil
}

func (m *TransferManager) runUpload(task *transferTask) {
	c, err := m.openSFTP(task)
	if err != nil {
		return
	}
	in, err := os.Open(task.info.LocalPath)
	if err != nil {
		m.fail(task, fmt.Errorf("打开本地文件失败: %w", err))
		return
	}
	defer in.Close()
	out, err := c.Create(task.info.RemotePath)
	if err != nil {
		m.fail(task, fmt.Errorf("创建远端文件失败: %w", err))
		return
	}
	defer out.Close()
	if err := m.copy(task, out, in); err != nil {
		m.fail(task, err)
	}
}

func (m *TransferManager) runDownload(task *transferTask) {
	c, err := m.openSFTP(task)
	if err != nil {
		return
	}
	in, err := c.Open(task.info.RemotePath)
	if err != nil {
		m.fail(task, fmt.Errorf("打开远端文件失败: %w", err))
		return
	}
	defer in.Close()
	if fi, err := in.Stat(); err == nil {
		task.info.Size = fi.Size()
	}
	out, err := os.Create(task.info.LocalPath)
	if err != nil {
		m.fail(task, fmt.Errorf("创建本地文件失败: %w", err))
		return
	}
	defer out.Close()
	if err := m.copy(task, out, in); err != nil {
		m.fail(task, err)
	}
}

// localFile 目录扫描结果:绝对路径 + 相对根路径。
type localFile struct {
	fullPath string
	rel      string
}

// scanLocalDir 递归收集目录下全部文件与总字节数(保持 filepath.Walk 顺序)。
// exclude 命中的目录整棵跳过、命中的文件跳过(传输黑名单)。
func scanLocalDir(root string, exclude []string) ([]localFile, int64, error) {
	var files []localFile
	var total int64
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if isExcludedLocal(p, exclude) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if info.IsDir() {
			return nil
		}
		rel, rerr := filepath.Rel(root, p)
		if rerr != nil {
			return rerr
		}
		files = append(files, localFile{fullPath: p, rel: rel})
		total += info.Size()
		return nil
	})
	return files, total, err
}

// normalizeLocalPath 规范化本地路径(取绝对相对均可),Windows 下大小写不敏感。
func normalizeLocalPath(p string) string {
	c := filepath.Clean(strings.TrimSpace(p))
	if runtime.GOOS == "windows" {
		c = strings.ToLower(c)
	}
	return c
}

// isExcludedLocal 判断本地路径是否命中黑名单:等于某项,或位于某个被排除目录之下。
func isExcludedLocal(p string, exclude []string) bool {
	if len(exclude) == 0 {
		return false
	}
	target := normalizeLocalPath(p)
	sep := string(os.PathSeparator)
	for _, e := range exclude {
		if strings.TrimSpace(e) == "" {
			continue
		}
		ex := normalizeLocalPath(e)
		if target == ex || strings.HasPrefix(target, ex+sep) {
			return true
		}
	}
	return false
}

// normalizeRemotePath 规范化远端 POSIX 路径。
func normalizeRemotePath(p string) string {
	return path.Clean(strings.TrimSpace(p))
}

// isExcludedRemote 判断远端路径是否命中黑名单(等于某项或位于其目录之下)。
func isExcludedRemote(p string, exclude []string) bool {
	if len(exclude) == 0 {
		return false
	}
	target := normalizeRemotePath(p)
	for _, e := range exclude {
		if strings.TrimSpace(e) == "" {
			continue
		}
		ex := normalizeRemotePath(e)
		if ex == "." || ex == "/" {
			continue
		}
		if target == ex || strings.HasPrefix(target, ex+"/") {
			return true
		}
	}
	return false
}

// runDirUpload 目录上传:远端按需建目录,逐文件拷贝,进度按整树字节聚合。
func (m *TransferManager) runDirUpload(task *transferTask, files []localFile) {
	c, err := m.openSFTP(task)
	if err != nil {
		return
	}
	root := task.info.RemotePath
	for _, f := range files {
		if task.canceled() {
			m.fail(task, errTransferCanceled)
			return
		}
		remote := path.Join(root, filepath.ToSlash(f.rel))
		if err := c.MkdirAll(path.Dir(remote)); err != nil {
			m.fail(task, fmt.Errorf("创建远端目录失败: %w", err))
			return
		}
		in, err := os.Open(f.fullPath)
		if err != nil {
			m.fail(task, fmt.Errorf("打开本地文件失败: %w", err))
			return
		}
		out, err := c.Create(remote)
		if err != nil {
			in.Close()
			m.fail(task, fmt.Errorf("创建远端文件失败: %w", err))
			return
		}
		cpErr := m.copy(task, out, in)
		_ = out.Close()
		_ = in.Close()
		if cpErr != nil {
			m.fail(task, cpErr)
			return
		}
	}
}

// runUploadTo 单文件上传到完整远端路径:先建父目录,再创建文件写入。
func (m *TransferManager) runUploadTo(task *transferTask) {
	c, err := m.openSFTP(task)
	if err != nil {
		return
	}
	if dir := path.Dir(task.info.RemotePath); dir != "/" && dir != "." {
		if err := c.MkdirAll(dir); err != nil {
			m.fail(task, fmt.Errorf("创建远端目录失败: %w", err))
			return
		}
	}
	in, err := os.Open(task.info.LocalPath)
	if err != nil {
		m.fail(task, fmt.Errorf("打开本地文件失败: %w", err))
		return
	}
	defer in.Close()
	out, err := c.Create(task.info.RemotePath)
	if err != nil {
		m.fail(task, fmt.Errorf("创建远端文件失败: %w", err))
		return
	}
	defer out.Close()
	if err := m.copy(task, out, in); err != nil {
		m.fail(task, err)
	}
}

// runDirContentsUpload 目录内容上传:远端根目录下按相对路径逐文件写入(自动建目录)。
func (m *TransferManager) runDirContentsUpload(task *transferTask, files []localFile) {
	c, err := m.openSFTP(task)
	if err != nil {
		return
	}
	root := task.info.RemotePath
	for _, f := range files {
		if task.canceled() {
			m.fail(task, errTransferCanceled)
			return
		}
		remote := path.Join(root, filepath.ToSlash(f.rel))
		if dir := path.Dir(remote); dir != "/" && dir != "." {
			if err := c.MkdirAll(dir); err != nil {
				m.fail(task, fmt.Errorf("创建远端目录失败: %w", err))
				return
			}
		}
		in, err := os.Open(f.fullPath)
		if err != nil {
			m.fail(task, fmt.Errorf("打开本地文件失败: %w", err))
			return
		}
		out, err := c.Create(remote)
		if err != nil {
			in.Close()
			m.fail(task, fmt.Errorf("创建远端文件失败: %w", err))
			return
		}
		cpErr := m.copy(task, out, in)
		_ = out.Close()
		_ = in.Close()
		if cpErr != nil {
			m.fail(task, cpErr)
			return
		}
	}
}

// runDirDownload 目录下载:先遍历远端树(收集文件与总字节),再逐文件落盘。
// exclude 命中的远端路径(含子树)跳过。
func (m *TransferManager) runDirDownload(task *transferTask, exclude []string) {
	c, err := m.openSFTP(task)
	if err != nil {
		return
	}
	type remoteFile struct {
		remotePath string
		rel        string
	}
	var files []remoteFile
	var total int64
	root := task.info.RemotePath
	walker := c.Walk(root)
	for walker.Step() {
		if err := walker.Err(); err != nil {
			m.fail(task, fmt.Errorf("遍历远端目录失败: %w", err))
			return
		}
		info := walker.Stat()
		if info.IsDir() {
			continue
		}
		if isExcludedRemote(walker.Path(), exclude) {
			continue
		}
		files = append(files, remoteFile{remotePath: walker.Path(), rel: remoteRel(root, walker.Path())})
		total += info.Size()
	}
	if len(files) == 0 {
		m.fail(task, errors.New("远端目录为空,没有可下载的文件(可能全被黑名单排除)"))
		return
	}
	// 总大小在遍历后才知道:进度前端在此之前按不确定模式展示
	m.mu.Lock()
	task.info.Size = total
	m.mu.Unlock()

	localRoot := task.info.LocalPath
	for _, f := range files {
		if task.canceled() {
			m.fail(task, errTransferCanceled)
			return
		}
		local := filepath.Join(localRoot, filepath.FromSlash(f.rel))
		if err := os.MkdirAll(filepath.Dir(local), 0o755); err != nil {
			m.fail(task, fmt.Errorf("创建本地目录失败: %w", err))
			return
		}
		in, err := c.Open(f.remotePath)
		if err != nil {
			m.fail(task, fmt.Errorf("打开远端文件失败: %w", err))
			return
		}
		out, err := os.Create(local)
		if err != nil {
			in.Close()
			m.fail(task, fmt.Errorf("创建本地文件失败: %w", err))
			return
		}
		cpErr := m.copy(task, out, in)
		_ = out.Close()
		_ = in.Close()
		if cpErr != nil {
			m.fail(task, cpErr)
			return
		}
	}
}

// copy 分块拷贝并推进进度;任务取消时返回 errTransferCanceled。
// 缓冲 512KB:配合 SFTP 并发写管道,单次 Write 产生 16 个在途 32KB 包,
// 高延迟链路吞吐不再被往返时间限制。
func (m *TransferManager) copy(task *transferTask, dst io.Writer, src io.Reader) error {
	buf := make([]byte, 512*1024)
	for {
		select {
		case <-task.cancel:
			return errTransferCanceled
		default:
		}
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return fmt.Errorf("写入失败: %w", werr)
			}
			m.advance(task, int64(n))
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("读取失败: %w", err)
		}
	}
}

// advance 累加进度并节流通知。
func (m *TransferManager) advance(task *transferTask, n int64) {
	m.mu.Lock()
	task.info.Transferred += n
	now := time.Now()
	if task.info.Status == TransferRunning && now.Sub(task.lastNotify) >= 100*time.Millisecond {
		task.lastNotify = now
		snapshot := task.info
		m.mu.Unlock()
		if m.OnProgress != nil {
			m.OnProgress(snapshot)
		}
		return
	}
	m.mu.Unlock()
}

// remoteRel 计算 POSIX 路径相对根目录的相对路径(path 包无 Rel,SFTP 路径恒为斜杠)。
func remoteRel(root, p string) string {
	rel := strings.TrimPrefix(p, root)
	return strings.TrimPrefix(rel, "/")
}

// canceled 非阻塞检查任务是否被取消。
func (task *transferTask) canceled() bool {
	select {
	case <-task.cancel:
		return true
	default:
		return false
	}
}

func (m *TransferManager) fail(task *transferTask, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err == errTransferCanceled {
		task.info.Status = TransferCanceled
		task.info.Error = ""
		return
	}
	task.info.Status = TransferError
	task.info.Error = err.Error()
}

package bridge

import (
	"github.com/wailsapp/wails/v3/pkg/application"

	"termhub/internal/sshsvc"
)

// 传输事件名与载荷。进度经事件推给前端,绑定调用只负责发起/取消/查询。
const (
	EventTransferProgress = "termhub:transfer:progress"
	EventTransferDone     = "termhub:transfer:done"
)

func init() {
	application.RegisterEvent[sshsvc.TransferInfo](EventTransferProgress)
	application.RegisterEvent[sshsvc.TransferInfo](EventTransferDone)
}

// SftpService 文件传输绑定服务(控制面):
// 远端文件浏览/管理 + 传输任务发起与取消。
// 进度与终态由事件(EventTransferProgress/EventTransferDone)推送。
type SftpService struct {
	fs *sshsvc.RemoteFS
	tm *sshsvc.TransferManager
}

// NewSftpService 构造文件传输服务;事件发射器由 main 注入。
func NewSftpService(fs *sshsvc.RemoteFS, tm *sshsvc.TransferManager) *SftpService {
	return &SftpService{fs: fs, tm: tm}
}

// ListDir 列出远端目录。
func (s *SftpService) ListDir(sessionID, dir string) ([]sshsvc.FileEntry, error) {
	return s.fs.ListDir(sessionID, dir)
}

// Exists 判断远端路径是否存在。
func (s *SftpService) Exists(sessionID, path string) (bool, error) {
	return s.fs.Exists(sessionID, path)
}

// Mkdir 在 dir 下创建目录。
func (s *SftpService) Mkdir(sessionID, dir, name string) error {
	return s.fs.Mkdir(sessionID, dir, name)
}

// Remove 删除远端文件或空目录。
func (s *SftpService) Remove(sessionID, target string) error {
	return s.fs.Remove(sessionID, target)
}

// Rename 重命名远端条目。
func (s *SftpService) Rename(sessionID, target, newName string) error {
	return s.fs.Rename(sessionID, target, newName)
}

// Upload 发起上传任务,立即返回任务快照。
// exclude 为本地黑名单路径:命中的文件/目录(含子树)不参与传输。
func (s *SftpService) Upload(sessionID, localPath, remoteDir string, exclude []string) (sshsvc.TransferInfo, error) {
	return s.tm.Upload(sessionID, localPath, remoteDir, exclude)
}

// UploadFileTo 上传单个本地文件到远端"完整目标文件路径"(支持改名),远端父目录自动创建。
// 供命令的"传输"类型(file 语义)使用;exclude 为本地黑名单(源文件命中则拒绝)。
func (s *SftpService) UploadFileTo(sessionID, localPath, remotePath string, exclude []string) (sshsvc.TransferInfo, error) {
	return s.tm.UploadFileTo(sessionID, localPath, remotePath, exclude)
}

// UploadDirContents 把本地目录的"内容"上传到远端目录(保留子目录结构),远端目录自动创建。
// 供命令的"传输"类型(dir 语义)使用;exclude 为本地黑名单(命中含子树不上传)。
func (s *SftpService) UploadDirContents(sessionID, localDir, remoteDir string, exclude []string) (sshsvc.TransferInfo, error) {
	return s.tm.UploadDirContents(sessionID, localDir, remoteDir, exclude)
}

// UploadBytes 把内容直接上传为远端文件(拖拽上传)。
// relDir 为相对 remoteDir 的子目录(目录拖入时保留层级),空为当前目录。
func (s *SftpService) UploadBytes(sessionID, remoteDir, fileName, relDir string, data []byte) (sshsvc.TransferInfo, error) {
	return s.tm.UploadBytes(sessionID, remoteDir, fileName, relDir, data)
}

// Download 发起下载任务,立即返回任务快照。
// exclude 为远端黑名单路径:命中的文件/目录(含子树)不参与传输。
func (s *SftpService) Download(sessionID, remotePath, localDir string, exclude []string) (sshsvc.TransferInfo, error) {
	return s.tm.Download(sessionID, remotePath, localDir, exclude)
}

// CancelTransfer 取消进行中的任务。
func (s *SftpService) CancelTransfer(id string) error {
	return s.tm.CancelTransfer(id)
}

// Transfers 当前全部任务快照。
func (s *SftpService) Transfers() []sshsvc.TransferInfo {
	return s.tm.Transfers()
}

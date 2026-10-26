package sshsvc

import (
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/pkg/sftp"
)

// ErrSessionClosed 会话已关闭。
var ErrSessionClosed = errors.New("会话已关闭")

// SFTPClient 懒加载并缓存会话的 SFTP 客户端(复用既有 SSH 连接,
// 与交互式 shell 通道并存,不额外握手)。
func (t *TerminalSession) SFTPClient() (*sftp.Client, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return nil, ErrSessionClosed
	}
	if t.sftp != nil {
		return t.sftp, nil
	}
	c, err := sftp.NewClient(t.client,
		// 并发写管道:默认关闭会把大写入拆成 32KB 包串行等 ACK,
		// 高延迟链路吞吐被 RTT 卡死;开启后最多 64 包在途,吞吐由带宽决定。
		sftp.UseConcurrentWrites(true),
	)
	if err != nil {
		return nil, fmt.Errorf("打开 SFTP 通道失败: %w", err)
	}
	t.sftp = c
	return c, nil
}

// RemoteFS 远端文件操作,基于既有会话的 SFTP 通道。
type RemoteFS struct {
	mgr *Manager
}

// NewRemoteFS 构造远端文件服务。
func NewRemoteFS(mgr *Manager) *RemoteFS {
	return &RemoteFS{mgr: mgr}
}

func (f *RemoteFS) client(sessionID string) (*sftp.Client, error) {
	ts, err := f.mgr.Get(sessionID)
	if err != nil {
		return nil, err
	}
	return ts.SFTPClient()
}

// ListDir 列出远端目录(目录在前,按名称排序);dir 为空时列根目录。
func (f *RemoteFS) ListDir(sessionID, dir string) ([]FileEntry, error) {
	c, err := f.client(sessionID)
	if err != nil {
		return nil, err
	}
	if dir == "" {
		dir = "/"
	}
	infos, err := c.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("读取远端目录失败: %w", err)
	}
	entries := make([]FileEntry, 0, len(infos))
	for _, fi := range infos {
		entries = append(entries, FileEntry{
			Name:    fi.Name(),
			Path:    JoinRemotePath(dir, fi.Name()),
			IsDir:   fi.IsDir(),
			Size:    fi.Size(),
			ModTime: fi.ModTime().Format(time.RFC3339),
		})
	}
	SortFileEntries(entries)
	return entries, nil
}

// Exists 判断远端路径是否存在(传输覆盖确认用)。
func (f *RemoteFS) Exists(sessionID, path string) (bool, error) {
	c, err := f.client(sessionID)
	if err != nil {
		return false, err
	}
	_, err = c.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

// Mkdir 在 dir 下创建名为 name 的目录。
func (f *RemoteFS) Mkdir(sessionID, dir, name string) error {
	c, err := f.client(sessionID)
	if err != nil {
		return err
	}
	if err := c.Mkdir(JoinRemotePath(dir, name)); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}
	return nil
}

// Remove 删除远端文件或空目录。
func (f *RemoteFS) Remove(sessionID, target string) error {
	c, err := f.client(sessionID)
	if err != nil {
		return err
	}
	if err := c.Remove(target); err != nil {
		return fmt.Errorf("删除失败: %w", err)
	}
	return nil
}

// Rename 重命名远端文件/目录(新名称仅含文件名,不换目录)。
func (f *RemoteFS) Rename(sessionID, target, newName string) error {
	c, err := f.client(sessionID)
	if err != nil {
		return err
	}
	dir := pathDir(target)
	if err := c.Rename(target, JoinRemotePath(dir, newName)); err != nil {
		return fmt.Errorf("重命名失败: %w", err)
	}
	return nil
}

func pathDir(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			if i == 0 {
				return "/"
			}
			return p[:i]
		}
	}
	return "/"
}

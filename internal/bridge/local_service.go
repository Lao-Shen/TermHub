package bridge

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"termhub/internal/sshsvc"
)

// LocalService 本地文件系统绑定:浏览目录 + 系统文件选择对话框 + 文本读写。
// WebView 无本地文件访问权,统一经由本服务代理。
type LocalService struct{}

// NewLocalService 构造本地文件服务。
func NewLocalService() *LocalService {
	return &LocalService{}
}

// ListDir 列出本地目录;dir 为空时列出根(Windows 下为驱动器列表)。
func (s *LocalService) ListDir(dir string) ([]sshsvc.FileEntry, error) {
	if dir == "" {
		return s.listRoot()
	}
	infos, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("读取本地目录失败: %w", err)
	}
	entries := make([]sshsvc.FileEntry, 0, len(infos))
	for _, fi := range infos {
		info, err := fi.Info()
		if err != nil {
			continue // 无权限等,跳过单条
		}
		entries = append(entries, sshsvc.FileEntry{
			Name:    fi.Name(),
			Path:    filepath.Join(dir, fi.Name()),
			IsDir:   fi.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().Format(time.RFC3339),
		})
	}
	sshsvc.SortFileEntries(entries)
	return entries, nil
}

// DownloadsDir 用户下载目录(不存在则创建),文件视图右键下载的默认落点。
func (s *LocalService) DownloadsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("获取用户目录失败: %w", err)
	}
	dir := filepath.Join(home, "Downloads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("创建下载目录失败: %w", err)
	}
	return dir, nil
}

// Exists 判断本地路径是否存在(下载覆盖确认用)。
func (s *LocalService) Exists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

// HomeDir 用户主目录(前端本地面板的初始路径)。
func (s *LocalService) HomeDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("获取用户目录失败: %w", err)
	}
	return home, nil
}

// listRoot Windows 下列出全部可用驱动器;其他平台列根目录。
func (s *LocalService) listRoot() ([]sshsvc.FileEntry, error) {
	if runtime.GOOS == "windows" {
		entries := make([]sshsvc.FileEntry, 0, 8)
		for c := 'A'; c <= 'Z'; c++ {
			drive := string(c) + ":\\"
			if st, err := os.Stat(drive); err == nil && st.IsDir() {
				entries = append(entries, sshsvc.FileEntry{
					Name:  string(c) + ":",
					Path:  drive,
					IsDir: true,
				})
			}
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
		return entries, nil
	}
	return s.ListDir("/")
}

// ChooseFile 弹出系统文件选择框,返回所选文件路径;取消返回空串。
func (s *LocalService) ChooseFile(title string) (string, error) {
	p, err := application.Get().Dialog.OpenFile().
		SetTitle(title).
		PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("选择文件失败: %w", err)
	}
	return p, nil
}

// ChooseDirectory 弹出系统目录选择框;取消返回空串。
func (s *LocalService) ChooseDirectory(title string) (string, error) {
	p, err := application.Get().Dialog.OpenFile().
		SetTitle(title).
		CanChooseFiles(false).
		CanChooseDirectories(true).
		PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("选择目录失败: %w", err)
	}
	return p, nil
}

// SaveTextFile 弹出系统保存对话框,把文本以 UTF-8 写入所选文件;取消返回空串。
func (s *LocalService) SaveTextFile(title, defaultName, content string) (string, error) {
	dlg := application.Get().Dialog.SaveFile()
	dlg.SetOptions(&application.SaveFileDialogOptions{
		Title:                title,
		Filename:             defaultName,
		CanCreateDirectories: true,
	})
	dlg.AddFilter("JSON 文件", "*.json")
	path, err := dlg.PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("选择保存位置失败: %w", err)
	}
	if path == "" {
		return "", nil
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("写入文件失败: %w", err)
	}
	return path, nil
}

// OpenTextFile 弹出系统文件选择框并读取 UTF-8 文本,返回路径与内容;取消返回空串。
func (s *LocalService) OpenTextFile(title string) (string, string, error) {
	path, err := application.Get().Dialog.OpenFile().
		SetTitle(title).
		AddFilter("JSON 文件", "*.json").
		PromptForSingleSelection()
	if err != nil {
		return "", "", fmt.Errorf("选择文件失败: %w", err)
	}
	if path == "" {
		return "", "", nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", fmt.Errorf("读取文件失败: %w", err)
	}
	return path, string(data), nil
}

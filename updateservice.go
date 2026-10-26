package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// UpdateInfo 检查更新结果（供前端确认框/更新弹窗展示）
type UpdateInfo struct {
	Available   bool   `json:"available"`
	Version     string `json:"version"`
	Notes       string `json:"notes"`
	Size        int64  `json:"size"`
	PublishedAt string `json:"publishedAt"` // RFC3339；清单未提供时为空串
}

// UpdateService 应用设置与更新（绑定给前端）
type UpdateService struct{}

// CurrentVersion 当前应用版本号（构建时注入，未注入为 dev）
func (s *UpdateService) CurrentVersion() string {
	return currentVersion
}

// AutoUpdateEnabled 是否启用"启动时自动检查更新"
func (s *UpdateService) AutoUpdateEnabled() bool {
	return loadSettings().AutoUpdate
}

// SetAutoUpdateEnabled 设置自动更新开关
func (s *UpdateService) SetAutoUpdateEnabled(enabled bool) error {
	st := loadSettings()
	st.AutoUpdate = enabled
	return saveSettings(st)
}

// CheckUpdate 仅检查是否有新版本，不下载（供前端先确认）
func (s *UpdateService) CheckUpdate() (*UpdateInfo, error) {
	app := application.Get()
	if app == nil || app.Updater == nil {
		return nil, fmt.Errorf("更新器未初始化")
	}
	// 只给清单请求兜底超时；下载在 StartInstall 里另走 CheckAndInstall。
	ctx, cancel := context.WithTimeout(context.Background(), updateCheckTimeout)
	defer cancel()
	rel, err := app.Updater.Check(ctx)
	if err != nil {
		return nil, err
	}
	if rel == nil {
		return &UpdateInfo{Available: false}, nil
	}
	info := &UpdateInfo{
		Available: true,
		Version:   rel.Version,
		Notes:     rel.Notes,
		Size:      rel.Artifact.Size,
	}
	if !rel.PublishedAt.IsZero() {
		info.PublishedAt = rel.PublishedAt.Format(time.RFC3339)
	}
	return info, nil
}

// StartInstall 用户确认后开始下载并安装（后台进行，进度经 wails:updater:* 事件推给前端）
func (s *UpdateService) StartInstall() error {
	app := application.Get()
	if app == nil || app.Updater == nil {
		return fmt.Errorf("更新器未初始化")
	}
	go func() {
		if err := app.Updater.CheckAndInstall(context.Background()); err != nil {
			log.Printf("更新失败: %v", err)
		}
	}()
	return nil
}

// Restart 重启并应用已下载的更新（前端在 update-ready 后确认触发）。
// 内部会拉起 helper 进程完成替换，并让本进程退出。
func (s *UpdateService) Restart() error {
	app := application.Get()
	if app == nil || app.Updater == nil {
		return fmt.Errorf("更新器未初始化")
	}
	return app.Updater.Restart(context.Background())
}

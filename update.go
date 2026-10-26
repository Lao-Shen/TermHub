package main

import (
	"context"
	_ "embed"
	"log"
	"net/http"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/endpoint"
)

// currentVersion 当前应用版本号，构建时由
// -ldflags "-X main.currentVersion=x.y.z" 注入；未注入时为 dev
var currentVersion = "dev"

// updaterPublicKey 更新签名验签公钥（PKIX PEM），随客户端编译固定
//
//go:embed updater.pub
var updaterPublicKey []byte

// updateManifestURL 更新检查地址（本应用 fullname = TermHub，见 project.json）
const updateManifestURL = "https://www.earwind.top/api/v1/update/check?fullname=TermHub"

// UpdateCheckEvent 触发前端"检查更新"流程的事件（payload: bool = 是否静默）
const UpdateCheckEvent = "app:update:check"

// updateCheckTimeout 单次「检查更新」的超时，只约束清单请求。
//
// 底层 HTTP 客户端的超时被放宽到 10 分钟（供大文件下载），若不给检查单独
// 兜底，手动检查在服务端挂起时会一直转圈。下载路径不受此限（见 StartInstall）。
const updateCheckTimeout = 30 * time.Second

func init() {
	application.RegisterEvent[bool](UpdateCheckEvent)
}

// setupUpdater 初始化内置更新器，并挂上启动静默检查
//
//	检查与下载分离：检测到新版本先交给前端确认，确认后才下载。
func setupUpdater(app *application.App) {
	ep, err := endpoint.New(endpoint.Config{
		URL: updateManifestURL,
		// 内置默认客户端 30s 超时会中断大文件下载，放宽到 10 分钟
		HTTPClient: &http.Client{Timeout: 10 * time.Minute},
	})
	if err != nil {
		log.Printf("更新器：创建更新源失败: %v", err)
		return
	}

	if err := app.Updater.Init(updater.Config{
		CurrentVersion: currentVersion,
		Providers:      []updater.Provider{ep},
		PublicKey:      updaterPublicKey,
		// 关掉框架内置更新窗口（英文通用 UI），改由应用内 UpdateDialog
		// 订阅 wails:updater:* 事件自行展示进度 / 重启，风格与主界面一致。
		Window: updater.WindowNone,
	}); err != nil {
		log.Printf("更新器：初始化失败: %v", err)
		return
	}

	// 启动后静默检查：仅在**确有新版本**时才通知前端（避免每次启动都弹设置）
	go func() {
		time.Sleep(4 * time.Second)
		if !loadSettings().AutoUpdate {
			return
		}
		if currentVersion == "" || currentVersion == "dev" {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), updateCheckTimeout)
		defer cancel()
		rel, err := app.Updater.Check(ctx)
		if err != nil || rel == nil {
			return
		}
		app.Event.Emit(UpdateCheckEvent, true)
	}()
}

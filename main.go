// TermHub — 跨平台 SSH 客户端桌面应用(Wails v3)。
//
// 分层:
//
//	internal/sshsvc  SSH 领域层(连接/会话/主机密钥/文件传输,纯 Go,不依赖 Wails)
//	internal/bridge 桥接层(Wails 绑定 + WebSocket 终端桥)
//	frontend/       React 界面(连接管理、多标签终端、双栏文件传输)
//
// 控制面走 Wails 绑定(连接建立/断开、文件浏览/管理、传输任务),
// 终端数据面走 127.0.0.1 本地 WebSocket(高频、低延迟)。
package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"termhub/internal/bridge"
	"termhub/internal/credstore"
	"termhub/internal/sshsvc"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// 领域层:会话管理 + 远端文件 + 传输任务(回调由桥接层接管)。
	mgr := sshsvc.NewManager()
	remoteFS := sshsvc.NewRemoteFS(mgr)
	transfers := sshsvc.NewTransferManager(remoteFS)

	// 桥接层:WebSocket 终端桥 + Wails 绑定服务。
	hub := bridge.NewHub(mgr)
	wsPort, err := hub.Listen()
	if err != nil {
		log.Fatalf("启动终端数据桥失败: %v", err)
	}
	log.Printf("终端数据桥监听 127.0.0.1:%d", wsPort)
	quitGuard := bridge.NewQuitGuard()
	quitGuard.RunningCount = transfers.RunningCount

	svc := bridge.NewTermHubService(hub, mgr, quitGuard)
	sftpSvc := bridge.NewSftpService(remoteFS, transfers)
	localSvc := bridge.NewLocalService()
	credSvc := bridge.NewCredentialService(credstore.New())
	clipSvc := bridge.NewClipboardService()
	toolSvc := bridge.NewToolService(mgr)
	hostCmdSvc := bridge.NewHostCommandService()

	// 单例窗口引用:SingleInstance 回调早于窗口创建注册,经闭包变量访问。
	var mainWindow *application.WebviewWindow

	app := application.New(application.Options{
		Name:        "termhub",
		Description: "TermHub — 现代化 SSH 客户端",
		// 单例:只允许一个 TermHub 进程。二次启动时框架自动退出第二实例,
		// 这里聚焦并还原既有窗口(最小化时还原,后台时置前)。
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.termhub.desktop",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				if mainWindow != nil {
					mainWindow.Show()
					mainWindow.Restore()
					mainWindow.Focus()
				}
			},
		},
		// 退出守卫:有传输任务时先取消退出,请用户确认
		ShouldQuit: quitGuard.ShouldQuit,
		Services: []application.Service{
			application.NewService(svc),
			application.NewService(sftpSvc),
			application.NewService(localSvc),
			application.NewService(credSvc),
			application.NewService(clipSvc),
			application.NewService(toolSvc),
			application.NewService(hostCmdSvc),
			application.NewService(&UpdateService{}), // 应用设置与更新
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// 更新器：内置 updater + 自建更新清单（启动静默检查）
	setupUpdater(app)

	// 会话结束事件 → 前端关闭/标记标签页。
	hub.OnSessionExitEvent = func(sessionID, reason string) {
		app.Event.Emit(bridge.EventSessionExit, bridge.SessionExitEvent{
			SessionID: sessionID,
			Reason:    reason,
		})
	}

	// 传输进度/终态 → 前端进度条。
	transfers.OnProgress = func(t sshsvc.TransferInfo) {
		app.Event.Emit(bridge.EventTransferProgress, t)
	}
	transfers.OnDone = func(t sshsvc.TransferInfo) {
		app.Event.Emit(bridge.EventTransferDone, t)
	}

	// 流量采样 → 前端流量监控曲线。
	mgr.OnTraffic = func(sessionID string, samples []sshsvc.TrafficSample) {
		app.Event.Emit(bridge.EventTrafficSample, bridge.TrafficEvent{
			SessionID: sessionID,
			Samples:   samples,
		})
	}

	// 宿主机命令(外部命令)输出/结束 → 前端。
	hostCmdSvc.OnOutput = func(runID, stream, data string) {
		app.Event.Emit(bridge.EventHostCmdOutput, bridge.HostCmdOutputEvent{
			RunID:  runID,
			Stream: stream,
			Data:   data,
		})
	}
	hostCmdSvc.OnDone = func(runID string, exitCode int, errMsg string) {
		app.Event.Emit(bridge.EventHostCmdDone, bridge.HostCmdDoneEvent{
			RunID:    runID,
			ExitCode: exitCode,
			Error:    errMsg,
		})
	}

	// 退出前有传输任务 → 取消退出并提示前端确认。
	quitGuard.OnPrompt = func(count int) {
		app.Event.Emit(bridge.EventQuitPrompt, bridge.QuitPromptEvent{Count: count})
	}

	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "TermHub",
		Width:            1280,
		Height:           800,
		MinWidth:         940,
		MinHeight:        620,
		BackgroundColour: application.NewRGB(11, 14, 20),
		URL:              "/",
	})
	mainWindow = win
	// 命令组执行期间置顶主窗口(避免被其它窗口遮挡);由前端经 SetAlwaysOnTop 调用。
	svc.ApplyAlwaysOnTop = func(on bool) { win.SetAlwaysOnTop(on) }

	// 窗口关闭钩子:先于内部关闭逻辑执行,有传输任务时取消关闭并提示前端
	// (Windows 上关窗口不经过 App.ShouldQuit,须在窗口级拦截)。
	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if e.IsCancelled() || quitGuard.Allowed() {
			return
		}
		if count := transfers.RunningCount(); count > 0 {
			e.Cancel()
			app.Event.Emit(bridge.EventQuitPrompt, bridge.QuitPromptEvent{Count: count})
		}
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

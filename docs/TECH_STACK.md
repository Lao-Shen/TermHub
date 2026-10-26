# TermHub 技术选型

> 2026-08-15 调研定稿(2026-08-15 修订:界面由 TUI 改为 Wails v3 桌面 GUI)。
> TermHub = 跨平台 SSH 客户端桌面应用:连接服务器、文件传输、可扩展自定义功能。
> 调研方式:核实 GitHub 仓库实际提交状态 + 分析同类运行中项目的 go.mod/package.json(主要参照 Vexo)。

## 总体架构

```
┌─────────────────────────────────────────────┐
│ 前端 (React 19 + TS + Vite, 运行在 WebView2)  │
│  · 连接管理 / 多标签页 / SFTP 文件管理器       │
│  · 终端: @xterm/xterm v6 + 插件               │
└──────────┬──────────────────────────────────┘
           │ 控制面: Wails bindings(连接 CRUD、文件列表、进度)
           │ 终端数据: WebSocket(coder/websocket)双向流
┌──────────┴──────────────────────────────────┐
│ 后端 (Go 1.26, Wails v3)                     │
│  · SSH 会话管理 (x/crypto/ssh, pty xterm-256) │
│  · SFTP 客户端 (pkg/sftp, 复用同一 ssh 连接)  │
│  · 连接配置存储 (sqlite 或 toml)              │
└─────────────────────────────────────────────┘
```

## 选型总表

### 后端 (Go)

| 用途 | 库 | 版本(2026-08) | 理由 |
|---|---|---|---|
| 应用框架 | `github.com/wailsapp/wails/v3` | v3.0.0-alpha2.106 / beta.0 | 用户选定。**注意:v3 官方仍为 beta**(v2.13.0 才是稳定线),但 Vexo(同类 SSH 客户端,2026-07 仍在更新)已在生产使用同版本线,桌面 API 官方称已稳定 |
| SSH 客户端 | `golang.org/x/crypto/ssh` | v0.53+ | 事实标准:认证(密码/密钥/agent)、pty 会话 |
| 终端数据桥 | `github.com/coder/websocket` | v1.8.15 | Vexo/Lumin-SSH/Aether-SSH 的一致选择:终端高频双向数据走本地 WebSocket,不占 Wails IPC;gorilla/websocket 已归档,用 coder 的维护 fork |
| 文件传输 | `github.com/pkg/sftp` | v1.13.10+ | 活跃维护(2026-07 仍在发版),API 仿 os 包,复用 ssh.Client 开 SFTP 客户端 |
| 兜底 SCP | `github.com/bramvdbogaerde/go-scp` | v1.5.0 | 老服务器无 SFTP 子系统时用 |
| 凭据存储 | `github.com/zalando/go-keyring` | — | 密码/密钥短语存系统钥匙串(Windows 凭据管理器),Vexo/PixieTerm 同方案 |
| 配置存储 | `modernc.org/sqlite` 或 `pelletier/go-toml/v2` | — | Vexo 用 sqlite(纯 Go,无 cgo)+ toml;小项目 toml 够用 |
| 配置路径 | `github.com/adrg/xdg` | — | 跨平台标准配置目录 |
| 可选:ProxyJump/转发 | `golang.org/x/crypto/ssh` 原生 + `things-go/go-socks5` | — | Vexo 用 go-socks5 做 SOCKS5 隧道,后续扩展端口转发时参考 |

### 前端 (React + TS)

| 用途 | 库 | 版本 | 理由 |
|---|---|---|---|
| 框架 | React 19 + TypeScript + Vite | react ^19.2 | 用户选定;同类项目绝大多数用 React,参照 Vexo 抄代码最方便 |
| Wails 运行时 | `@wailsio/runtime` | v3.0.0-alpha.94 | 与后端 v3 配对 |
| 终端渲染 | `@xterm/xterm` | ^6.0.0 | 世界最强终端渲染器(VS Code 同款),渲染问题彻底移出 Go 侧 |
| xterm 插件 | fit、webgl、image、search、clipboard、web-links、ligatures、unicode11、attach | — | 与 Vexo 一致:fit 自适应窗口、webgl 加速渲染、image 支持图片输出 |
| UI 组件 | MUI(`@mui/material` v9)或 Ant Design | — | 文件管理器需要树/表格/对话框;Vexo 用 MUI + zustand 状态管理 |
| 路由 | react-router | ^8 | 多页面(连接管理/终端/传输) |

## 关键架构决策(来自 Vexo 实证)

1. **终端数据走本地 WebSocket,不走 Wails events**:`xterm.js onData → WebSocket → session.Write`;`ssh 会话 stdout goroutine → WebSocket → term.write()`。窗口尺寸用 ResizeObserver → `session.WindowChange`。终端吞吐大、延迟敏感,Wails bindings 适合控制面(连接增删改查、文件列表、进度),不适合高频流。
2. **pty 用 xterm-256color**:`session.RequestPty("xterm-256color", rows, cols, ...)`,xterm 前端配 unicode11 插件。
3. **SFTP 复用同一 ssh.Client**,不重复握手;上传下载在 Go 侧起 goroutine,进度通过 Wails events 推给前端。
4. **Windows 10 依赖 WebView2 Runtime**(Edge 预装环境一般已有,打包时检查)。

## 参考项目(已克隆到 Downloads)

| 项目 | 栈 | 值得借鉴 |
|---|---|---|
| [ilaziness/vexo](https://github.com/ilaziness/vexo)(ref-vexo) | **Wails v3 + React 19 + xterm v6 + coder/websocket + pkg/sftp** —— 与 TermHub 目标栈完全一致 | 终端桥接(services/websocket.go、Terminal.tsx)、SFTP 浏览器、多标签、密钥存储、ProxyJump。**主参照,直接读代码** |
| [terminator-ssh/terminator-desktop](https://github.com/terminator-ssh/terminator-desktop) | Wails v3,仿 Termius | 交互设计参考(未克隆,需要时再拉) |
| [ys-ll/uniTerm](https://github.com/ys-ll/uniTerm) | Wails v2 + Vue 3 + xterm.js | 仅当想换 Vue 时参考 |
| ref-SSHlepp / ref-sshmanager | bubbletea TUI | 仅 SFTP 双栏交互设计(F5/F6/F7/F8 键位、多选)还有参考价值 |

## 已排除项

| 项 | 原因 |
|---|---|
| bubbletea / bubbles / vt10x / containerd/console 等 TUI 栈 | 界面改为 Wails GUI 后整体不再需要 |
| `charm.land/wish/v2` | SSH 服务端库,与客户端方向相反 |
| Wails v2 | 用户选定 v3 beta(参考项目证明可行);迁移成本后置 |
| gorilla/websocket | 已归档,用 coder/websocket |

## 本机环境

- Go 1.26.5 windows/amd64 ✅
- Windows 10:需确认 WebView2 Runtime 已装(Edge 自带)

## 建议里程碑

1. **M1 骨架**:`wails3 init` + React 模板 → 连接表单(密码/密钥)→ xterm.js 终端页跑通(SSH 连接 + WebSocket 桥 + resize 同步)
2. **M2 文件传输**:SFTP 双栏文件管理器(浏览/上传/下载/进度条)
3. **M3 体验**:连接配置持久化(toml/sqlite)、密钥环存储、多标签、主题
4. **M4 扩展**:命令面板式自定义工具、ProxyJump、端口转发

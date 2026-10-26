# TermHub

现代化跨平台 SSH 客户端桌面应用(Wails v3 + React 19 + Go)。

- ✅ **M1**:连接管理、SSH 交互式终端(xterm.js + WebGL 加速)、多标签会话
- ✅ **M2**:SFTP 双栏文件传输(本地↔远端浏览、上传/下载/进度/取消、远端新建目录/删除)
- 🔜 M3:凭据钥匙串、多标签持久化、断线重连 · M4:自定义扩展点

## 运行

```bash
wails3 dev          # 开发模式(前端热更新)
wails3 build        # 构建 bin/termhub.exe
go test ./internal/...  # 后端单元测试
```

## 架构

```
┌─ 前端 React(frontend/)──────────────────────────┐
│  components/  UI 组件(终端视图与业务解耦)          │
│  store/       zustand 状态(连接/会话/对话框)       │
│  services/    api.ts 控制面绑定 · terminal.ts 终端数据面 │
└──────────────┬───────────────────────────────────┘
               │ 控制面: Wails 绑定(Connect/Disconnect/Sessions)
               │ 数据面: WebSocket(127.0.0.1 随机端口,/ws/{sessionId})
┌──────────────┴───────────────────────────────────┐
│ 后端 Go                                            │
│  internal/sshsvc  领域层:SSH 会话/主机密钥 TOFU,    │
│                   纯 Go 不依赖 Wails,可单测         │
│  internal/bridge 桥接层:Wails 绑定 + WS 终端桥,     │
│                   是唯一接触 Wails 的包             │
└───────────────────────────────────────────────────┘
```

### 关键设计

- **分层解耦**:`sshsvc` 不 import Wails,输出/退出/传输进度经回调上抛;`bridge` 决定分发方式(WS 直发 + Wails 事件广播)。前端同理:UI 组件不直接碰 WebSocket,`services/` 封装协议与绑定。
- **终端数据走本地 WebSocket** 而非 Wails 绑定:高频、低延迟、背压自然(ws 写阻塞 → 远端输出读暂停)。控制面(建连/断开/列表)走绑定。
- **文件传输**:SFTP 复用既有 SSH 连接(懒加载通道,随会话关闭);传输任务在 Go 侧 goroutine 执行,进度经事件推送(节流 ~10 次/秒),可取消。支持单文件与目录树递归传输(整树字节聚合进度,远端/本地按需自动建目录)。上传/下载任务独立于终端,切走界面照常进行。
- **多标签保持挂载**:所有会话的终端视图常驻内存,切换标签/终端⇄文件仅切换 CSS 显示 —— xterm 滚动历史完整保留、WS 不断连、输出持续流入隐藏终端;隐藏时跳过 fit/resize(避免向 pty 发 0 尺寸),重新可见自动 fit + 聚焦。后端 64KB 输出环形缓冲仍作为真实断线时的兜底回放。
- **保活与断线恢复**:每 30s 发送 keepalive 心跳(5s 看门狗),服务器无响应即判定断线并给出原因;数据通道意外断开自动指数退避重连(1s→5s,后端回放缓冲),会话彻底死亡时退出面板提供一键重连(沿用原配置与已信任指纹)。
- **ProxyJump 跳板机**:先 SSH 连跳板,再经其 TCP 转发通道直连目标(OpenSSH `-J` 语义);跳板连接与目标会话同生命周期,终端/SFTP/保活全部走隧道;两级主机密钥均走 TOFU 确认(确认框标明"跳板机/目标主机"),跳板密码与指纹同样存入系统钥匙串。
- **传输层代理(SOCKS5/HTTP)**:支持本地代理工具(如 Clash 的 127.0.0.1:7897),Xshell 式用法:连接对话框"代理设置"里填类型/主机/端口即可;HTTP CONNECT 为自实现(x/net/proxy 仅内置 SOCKS5);代理与跳板机可叠加(代理 → 跳板 → 目标)。
- **会话工具(进程管理/端口状态)**:在既有会话上另开 SSH 通道执行命令(不动交互终端,15s 看门狗),`ps` 解析为进程表(搜索、右键 SIGTERM/SIGKILL),`ss -tlnp` 解析为端口表(自动回退 `netstat`);界面按会话分屏:左侧终端、右侧工具面板(内部 tabs),工具状态绑定当前标签,切换服务器不误取数据。
- **主机密钥 TOFU**:首次连接只握手取指纹 → 用户确认 → 指纹写入连接配置持久化,之后每次连接自动校验,不一致即拒绝(防中间人)。见 `internal/sshsvc/hostkey.go` 及对应单测。
- **WS 协议**(`internal/bridge/hub.go` ↔ `services/terminal.ts`):
  - 前端→后端:二进制 = 键盘输入;文本 JSON = `{"type":"resize",rows,cols}`
  - 后端→前端:二进制 = 远端输出;文本 JSON = `{"type":"exit",reason}`
- **凭据安全**:密码与主机密钥指纹存系统钥匙串(Windows 凭据管理器,go-keyring 纯 Go),跨启动保留;连接配置(不含秘密)存 localStorage;旧版本明文指纹自动迁移进钥匙串后剥离。前端永不接触明文持久化。
- **服务器数据导出/导入**:设置 →「服务器数据」经系统文件对话框导出/导入 JSON;含服务器配置(不含密码与指纹)、各服务器私有命令库/传输黑名单/路径记忆、公共常用命令库与命令组。导入按 `host+port+user` 去重合并,新条目重新分配 ID,不覆盖既有凭据。

### 目录速查

| 路径 | 说明 |
|---|---|
| `main.go` | 组装入口(领域层 + 桥接层 + 窗口) |
| `internal/sshsvc/` | config 校验 · manager 会话池 · session 生命周期 · hostkey TOFU · sftp 远端文件 · transfer 传输任务 |
| `internal/bridge/` | hub WS 桥(含输出缓冲)· termhub/sftp/local 三组 Wails 绑定 · 事件定义 |
| `frontend/src/services/` | api.ts(终端控制面)· terminal.ts(WS 客户端)· files.ts(SFTP/本地文件) |
| `frontend/src/store/` | appStore.ts(连接/会话)· transferStore.ts(传输任务) |
| `frontend/src/components/` | Sidebar · SessionTabs · ConnectionDialog · HostKeyDialog · terminal/TerminalView · files/TransferView + FileBrowser · Panels |

## 技术栈

Go 1.26 · Wails v3(beta,alpha2.x)· x/crypto/ssh · pkg/sftp(M2)· coder/websocket · React 19 + TypeScript + Vite · @xterm/xterm v6(WebGL)· MUI v9 · zustand

详见 [docs/TECH_STACK.md](docs/TECH_STACK.md)(选型调研与依据)。

## 已知限制(M2)

- 暂不支持加密私钥(带密码短语)、SSH Agent
- 跳板机依赖其开启 TCP 转发(与 OpenSSH `-J` 要求一致);暂不支持多级跳板链
- 传输代理暂不支持代理认证(用户名/密码);HTTP 代理需支持 CONNECT 方法
- 重命名远端条目仅后端就绪,UI 未接
- 钥匙串不可用的平台(如无 Secret Service 的 Linux 桌面)自动降级为每次询问密码

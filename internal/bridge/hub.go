// Package bridge 是 TermHub 的桥接层:把 sshsvc 领域能力以
// Wails 绑定(控制面)+ WebSocket(终端数据面)暴露给前端。
//
// 分层约定:只有本包与 main 允许 import Wails;sshsvc 永远不感知 UI。
package bridge

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"termhub/internal/sshsvc"
)

// wsControlMsg WS 文本帧:前端 → 后端的控制消息(JSON)。
type wsControlMsg struct {
	Type string `json:"type"`
	Rows int    `json:"rows,omitempty"`
	Cols int    `json:"cols,omitempty"`
}

// wsServerMsg WS 文本帧:后端 → 前端的状态消息(JSON)。
type wsServerMsg struct {
	Type   string `json:"type"`
	Reason string `json:"reason,omitempty"`
}

const (
	controlResize = "resize"
	serverExit    = "exit"
)

// wsConn 一个附着在会话上的 WebSocket 连接,写操作串行化。
type wsConn struct {
	conn    *websocket.Conn
	writeMu sync.Mutex
	closed  bool
}

// Hub 终端数据桥:
//   - 监听 127.0.0.1 随机端口,路径 /ws/{sessionID};
//   - 二进制帧 = 终端数据(前端输入 ← → 远端输出);
//   - 文本帧 = 控制/状态消息(resize / exit)。
//
// 同一会话仅保留一个 WS 连接,新连接替换旧连接(天然支持断线重挂)。
// 无连接期间输出暂存于环形缓冲(每会话 64KB),重挂时先回放,
// 保证前端切走(如打开文件视图)后返回不丢终端画面。
type Hub struct {
	mgr *sshsvc.Manager

	mu      sync.Mutex
	conns   map[string]*wsConn
	buffers map[string][]byte // sessionID → 未消费输出
	ln      net.Listener
	port    int

	// OnSessionExitEvent 会话结束时对外(经 Wails 事件)通知前端,由 main 注入。
	OnSessionExitEvent func(sessionID, reason string)
}

// bufferLimit 无连接时每会话保留的输出上限。
const bufferLimit = 64 * 1024

// NewHub 创建 Hub 并接管 Manager 的输出/退出回调。
func NewHub(mgr *sshsvc.Manager) *Hub {
	h := &Hub{mgr: mgr, conns: make(map[string]*wsConn), buffers: make(map[string][]byte)}
	mgr.OnOutput = h.onSessionOutput
	mgr.OnExit = h.onSessionExit
	return h
}

// Listen 在 127.0.0.1 随机端口启动 WS 服务,返回端口号。
// 只绑回环地址,前端 WebView 与后端同机,不存在远程暴露面。
func (h *Hub) Listen() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	h.ln = ln
	h.port = ln.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/", h.handleWS)
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	return h.port, nil
}

// Port 返回 WS 服务端口(Listen 之前为 0)。
func (h *Hub) Port() int {
	return h.port
}

// Close 关闭 WS 服务。
func (h *Hub) Close() error {
	if h.ln != nil {
		return h.ln.Close()
	}
	return nil
}

// handleWS 处理前端终端连接:校验会话存在后升级为 WS。
func (h *Hub) handleWS(w http.ResponseWriter, r *http.Request) {
	sessionID := strings.TrimPrefix(r.URL.Path, "/ws/")
	if sessionID == "" {
		http.Error(w, "missing session id", http.StatusBadRequest)
		return
	}
	if _, err := h.mgr.Get(sessionID); err != nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// 仅监听回环地址,连接者即本机前端,放开 Origin 校验。
		OriginPatterns: []string{"*"},
	})
	if err != nil {
		return
	}
	ws := &wsConn{conn: conn}
	h.attach(sessionID, ws)
	go h.readLoop(sessionID, ws)
}

// attach 把连接挂到会话上,替换并关闭旧连接;
// 若有缓存的未消费输出,先回放给新连接。
func (h *Hub) attach(sessionID string, ws *wsConn) {
	h.mu.Lock()
	if old, ok := h.conns[sessionID]; ok && !old.closed {
		old.closed = true
		_ = old.conn.Close(websocket.StatusGoingAway, "replaced by new connection")
	}
	h.conns[sessionID] = ws
	replay := h.buffers[sessionID]
	delete(h.buffers, sessionID)
	h.mu.Unlock()

	if len(replay) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		ws.writeMu.Lock()
		if err := ws.conn.Write(ctx, websocket.MessageBinary, replay); err != nil {
			ws.closed = true
			_ = ws.conn.Close(websocket.StatusAbnormalClosure, "write failed")
		}
		ws.writeMu.Unlock()
	}
}

// readLoop 消费前端帧:二进制 → 终端输入;文本 JSON → 控制消息。
func (h *Hub) readLoop(sessionID string, ws *wsConn) {
	defer func() {
		ws.closed = true
		_ = ws.conn.Close(websocket.StatusNormalClosure, "")
	}()
	for {
		typ, data, err := ws.conn.Read(context.Background())
		if err != nil {
			return
		}
		switch typ {
		case websocket.MessageBinary:
			if ts, err := h.mgr.Get(sessionID); err == nil {
				_, _ = ts.Write(data)
			}
		case websocket.MessageText:
			var c wsControlMsg
			if json.Unmarshal(data, &c) != nil {
				continue
			}
			if c.Type == controlResize {
				if ts, err := h.mgr.Get(sessionID); err == nil {
					_ = ts.Resize(c.Rows, c.Cols)
				}
			}
		}
	}
}

// onSessionOutput 由领域层输出 goroutine 串行调用:
// 有附着连接则阻塞写(对远端输出施加背压);无连接则暂存缓冲(上限 bufferLimit)。
func (h *Hub) onSessionOutput(sessionID string, data []byte) {
	h.mu.Lock()
	ws := h.conns[sessionID]
	if ws == nil || ws.closed {
		h.bufferOutput(sessionID, data)
		h.mu.Unlock()
		return
	}
	h.mu.Unlock()

	ws.writeMu.Lock()
	defer ws.writeMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := ws.conn.Write(ctx, websocket.MessageBinary, data); err != nil {
		ws.closed = true
		_ = ws.conn.Close(websocket.StatusAbnormalClosure, "write failed")
	}
}

// bufferOutput 把输出追加到会话缓冲,超出上限时丢弃最旧部分。
// 调用方须持有 h.mu。
func (h *Hub) bufferOutput(sessionID string, data []byte) {
	buf := h.buffers[sessionID]
	if len(buf)+len(data) > bufferLimit {
		trim := len(buf) + len(data) - bufferLimit
		if trim >= len(buf) {
			buf = nil
		} else {
			buf = buf[trim:]
		}
	}
	h.buffers[sessionID] = append(buf, data...)
}

// onSessionExit 会话结束:向附着连接发退出帧并关闭,再经事件通道通知前端。
func (h *Hub) onSessionExit(sessionID string, reason string) {
	h.mu.Lock()
	ws := h.conns[sessionID]
	delete(h.conns, sessionID)
	delete(h.buffers, sessionID)
	h.mu.Unlock()

	if ws != nil && !ws.closed {
		msg, _ := json.Marshal(wsServerMsg{Type: serverExit, Reason: reason})
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = ws.conn.Write(ctx, websocket.MessageText, msg)
		_ = ws.conn.Close(websocket.StatusNormalClosure, "session ended")
	}

	if h.OnSessionExitEvent != nil {
		h.OnSessionExitEvent(sessionID, reason)
	}
}

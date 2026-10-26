//go:build !windows

package hostcmd

import "io"

// newConsoleReader 非 Windows 平台输出即 UTF-8,原样返回。
func newConsoleReader(rc io.Reader) io.Reader { return rc }

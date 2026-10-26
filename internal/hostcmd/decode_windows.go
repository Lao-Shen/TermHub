//go:build windows

package hostcmd

import (
	"io"
	"syscall"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/korean"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"golang.org/x/text/transform"
)

var procGetOEMCP = syscall.NewLazyDLL("kernel32.dll").NewProc("GetOEMCP")

// consoleCodePage 返回系统 OEM 代码页(cmd / 控制台默认输出编码)。
func consoleCodePage() int {
	r, _, _ := procGetOEMCP.Call()
	return int(r)
}

// consoleEncoding 按代码页选择解码器;返回 nil 表示无需转换(UTF-8/未知)。
func consoleEncoding(cp int) encoding.Encoding {
	switch cp {
	case 936:
		// CP936 用 GB18030 解码(GBK 超集,兼容性更好)
		return simplifiedchinese.GB18030
	case 950:
		return traditionalchinese.Big5
	case 932:
		return japanese.ShiftJIS
	case 949:
		return korean.EUCKR
	default:
		return nil
	}
}

// newConsoleReader 把子进程输出(系统 OEM 代码页编码)按流式解码为 UTF-8,
// 正确切分跨块的多字节字符;无法识别编码时原样返回。
func newConsoleReader(rc io.Reader) io.Reader {
	enc := consoleEncoding(consoleCodePage())
	if enc == nil {
		return rc
	}
	return transform.NewReader(rc, enc.NewDecoder())
}

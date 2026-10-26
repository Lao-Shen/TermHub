package sshsvc

import (
	"path"
	"sort"
)

// FileEntry 文件/目录条目。远端(SFTP)与本地磁盘共用该结构,
// 经绑定序列化为 JSON 暴露给前端。
type FileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"` // RFC3339,目录为零值字符串
}

// SortFileEntries 目录在前,同类按名称排序。
func SortFileEntries(entries []FileEntry) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return entries[i].Name < entries[j].Name
	})
}

// JoinRemotePath 拼接远端(POSIX)路径。
func JoinRemotePath(dir, name string) string {
	if dir == "" || dir == "/" {
		return "/" + name
	}
	return path.Join(dir, name)
}

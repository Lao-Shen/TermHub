# 待办 / 交接说明

> 新会话请先读本文件,再读 [开发文档.md](开发文档.md)。完成一项就删掉对应小节。

---

当前没有进行中的任务。

## 其他交接事项

- 安装包版本号由用户自行在 [build/installer.iss](../build/installer.iss) 顶部 `MyAppVersion` 修改;构建打包用 `build-release.bat`。
- 冒烟测试只杀自己启动的 PID,禁止 `taskkill //IM termhub.exe`(会杀掉用户正在用的实例)。

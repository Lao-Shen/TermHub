// 文件服务封装:远端 SFTP(需会话)+ 本地磁盘(无需会话)。
// 传输任务:发起/取消走绑定,进度/终态由事件推送(见 transferStore)。
import { LocalService } from '../../bindings/termhub/internal/bridge'
import { SftpService } from '../../bindings/termhub/internal/bridge'
import type { FileEntry, TransferInfo } from '../types'

export const sftp = {
  async listDir(sessionId: string, dir: string): Promise<FileEntry[]> {
    return (await SftpService.ListDir(sessionId, dir)) ?? []
  },
  async exists(sessionId: string, path: string): Promise<boolean> {
    return SftpService.Exists(sessionId, path)
  },
  async mkdir(sessionId: string, dir: string, name: string): Promise<void> {
    await SftpService.Mkdir(sessionId, dir, name)
  },
  async remove(sessionId: string, target: string): Promise<void> {
    await SftpService.Remove(sessionId, target)
  },
  async upload(sessionId: string, localPath: string, remoteDir: string, exclude: string[] = []): Promise<TransferInfo> {
    return SftpService.Upload(sessionId, localPath, remoteDir, exclude)
  },
  /** 上传单个本地文件到远端完整文件路径(支持改名,父目录自动创建)。命令"传输"的 file 语义。 */
  async uploadFileTo(sessionId: string, localPath: string, remotePath: string, exclude: string[] = []): Promise<TransferInfo> {
    return SftpService.UploadFileTo(sessionId, localPath, remotePath, exclude)
  },
  /** 上传本地目录内容到远端目录(保留子目录结构,目录自动创建)。命令"传输"的 dir 语义。 */
  async uploadDirContents(sessionId: string, localDir: string, remoteDir: string, exclude: string[] = []): Promise<TransferInfo> {
    return SftpService.UploadDirContents(sessionId, localDir, remoteDir, exclude)
  },
  /** 内容直传(拖拽上传):data 为 base64。 */
  async uploadBytes(
    sessionId: string,
    remoteDir: string,
    fileName: string,
    relDir: string,
    data: string,
  ): Promise<TransferInfo> {
    return SftpService.UploadBytes(sessionId, remoteDir, fileName, relDir, data)
  },
  async download(sessionId: string, remotePath: string, localDir: string, exclude: string[] = []): Promise<TransferInfo> {
    return SftpService.Download(sessionId, remotePath, localDir, exclude)
  },
  async cancel(id: string): Promise<void> {
    await SftpService.CancelTransfer(id)
  },
  async transfers(): Promise<TransferInfo[]> {
    return (await SftpService.Transfers()) ?? []
  },
}

export const local = {
  async listDir(dir: string): Promise<FileEntry[]> {
    return (await LocalService.ListDir(dir)) ?? []
  },
  async exists(path: string): Promise<boolean> {
    return LocalService.Exists(path)
  },
  async homeDir(): Promise<string> {
    return LocalService.HomeDir()
  },
  /** 系统下载目录(右键下载默认落点)。 */
  async downloadsDir(): Promise<string> {
    return LocalService.DownloadsDir()
  },
  /** 弹出系统文件选择框;取消返回空串。 */
  async chooseFile(title: string): Promise<string> {
    return LocalService.ChooseFile(title)
  },
  /** 弹出系统目录选择框;取消返回空串。 */
  async chooseDirectory(title: string): Promise<string> {
    return LocalService.ChooseDirectory(title)
  },
}

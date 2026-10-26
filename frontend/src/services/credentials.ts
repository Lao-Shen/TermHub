// 凭据服务封装:密码与主机密钥指纹存取系统钥匙串(经 Go 侧绑定)。
// 读取失败/未保存统一返回空串,前端降级为"每次询问密码/重新确认指纹"。
import { CredentialService } from '../../bindings/termhub/internal/bridge'

export const credentials = {
  async getPassword(connID: string): Promise<string> {
    try {
      return await CredentialService.GetPassword(connID)
    } catch {
      return ''
    }
  },

  async setPassword(connID: string, password: string): Promise<void> {
    await CredentialService.SetPassword(connID, password)
  },

  /** 删除失败静默(钥匙串不可用时配置删除不应被阻断)。 */
  async deletePassword(connID: string): Promise<void> {
    try {
      await CredentialService.DeletePassword(connID)
    } catch {
      /* 忽略 */
    }
  },

  async getTrustedHostKey(connID: string): Promise<string> {
    try {
      return await CredentialService.GetTrustedHostKey(connID)
    } catch {
      return ''
    }
  },

  async setTrustedHostKey(connID: string, fingerprint: string): Promise<void> {
    await CredentialService.SetTrustedHostKey(connID, fingerprint)
  },

  async deleteTrustedHostKey(connID: string): Promise<void> {
    try {
      await CredentialService.DeleteTrustedHostKey(connID)
    } catch {
      /* 忽略 */
    }
  },

  async getProxyPassword(connID: string): Promise<string> {
    try {
      return await CredentialService.GetProxyPassword(connID)
    } catch {
      return ''
    }
  },

  async setProxyPassword(connID: string, password: string): Promise<void> {
    await CredentialService.SetProxyPassword(connID, password)
  },

  async deleteProxyPassword(connID: string): Promise<void> {
    try {
      await CredentialService.DeleteProxyPassword(connID)
    } catch {
      /* 忽略 */
    }
  },

  async getProxyTrustedHostKey(connID: string): Promise<string> {
    try {
      return await CredentialService.GetProxyTrustedHostKey(connID)
    } catch {
      return ''
    }
  },

  async setProxyTrustedHostKey(connID: string, fingerprint: string): Promise<void> {
    await CredentialService.SetProxyTrustedHostKey(connID, fingerprint)
  },

  async deleteProxyTrustedHostKey(connID: string): Promise<void> {
    try {
      await CredentialService.DeleteProxyTrustedHostKey(connID)
    } catch {
      /* 忽略 */
    }
  },
}

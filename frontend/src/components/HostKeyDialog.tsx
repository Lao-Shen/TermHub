// 主机密钥 TOFU 确认弹窗(store.hostKeyPrompt 驱动)。
// 首次连接时后端断开连接返回指纹,用户在此核对(区分跳板机/目标主机);
// 确认后指纹写入配置与系统钥匙串,后续连接每次自动校验防中间人。
import FingerprintIcon from '@mui/icons-material/Fingerprint'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'
import { useAppStore } from '../store/appStore'

/** 首次连接的主机密钥确认(TOFU):用户核对指纹后信任,后续连接自动校验。 */
export function HostKeyDialog() {
  const prompt = useAppStore((s) => s.hostKeyPrompt)
  const confirmHostKey = useAppStore((s) => s.confirmHostKey)
  const cancelHostKey = useAppStore((s) => s.cancelHostKey)

  return (
    <Dialog open={!!prompt} onClose={cancelHostKey} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <FingerprintIcon color="warning" />
        首次连接 — 确认主机身份
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.8 }}>
          这是你第一次连接{' '}
          {prompt?.scope === 'proxy' ? '跳板机' : '目标主机'}{' '}
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
            {prompt?.host ?? `${prompt?.cfg.host}:${prompt?.cfg.port || 22}`}
          </Box>
          ,请核对服务器主机密钥指纹:
        </Typography>
        <Box
          sx={{
            mt: 2,
            p: 2,
            borderRadius: 2,
            bgcolor: 'background.default',
            border: '1px solid',
            borderColor: 'divider',
            fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
            fontSize: 13,
            wordBreak: 'break-all',
            color: 'warning.main',
          }}
        >
          {prompt?.fingerprint}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block', lineHeight: 1.7 }}>
          指纹核对无误后点击“信任并连接”,TermHub 会记住该指纹;
          <br />
          若指纹与服务器实际不符,说明连接可能被劫持(中间人攻击),请立即取消。
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={cancelHostKey} color="inherit">
          取消
        </Button>
        <Button variant="contained" color="warning" onClick={() => void confirmHostKey()}>
          信任并连接
        </Button>
      </DialogActions>
    </Dialog>
  )
}

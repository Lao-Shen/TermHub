// 命令组「新建 / 修改」共用对话框:只编辑 名称 + 关联机器。
// 命令成员为只读预览(新建时来自命令模式的多选;修改时为组内现有命令),
// 命令的增删一律在"命令模式"多选里完成。
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useAppStore } from '../../store/appStore'

export interface CommandGroupDraft {
  name: string
  /** 关联主机名;空数组 = 全部服务器。 */
  hosts: string[]
  /** 组内命令(只读预览,不在本对话框编辑)。 */
  commands: string[]
}

/** 命令组新建/修改对话框。 */
export function CommandGroupDialog({
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  initial: CommandGroupDraft
  onClose: () => void
  onSubmit: (draft: { name: string; hosts: string[] }) => void
}) {
  const connections = useAppStore((s) => s.connections)
  // 关联机器选项:按主机名去重,展示连接的"名称"(一眼能看出是哪台机器)
  const hostOptions = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const c of connections) {
      if (!c.host) continue
      const names = map.get(c.host) ?? []
      names.push(c.name || c.host)
      map.set(c.host, names)
    }
    return Array.from(map.entries()).map(([host, names]) => ({ host, label: names.join(' / ') }))
  }, [connections])

  const [name, setName] = useState(initial.name)
  const [allHosts, setAllHosts] = useState(initial.hosts.length === 0)
  const [selectedHosts, setSelectedHosts] = useState<string[]>(initial.hosts)

  const toggleAllHosts = (checked: boolean) => {
    setAllHosts(checked)
    // 取消"全部服务器"时默认勾选全部,用户再按需取消
    if (!checked && selectedHosts.length === 0) setSelectedHosts(hostOptions.map((o) => o.host))
  }

  const toggleHost = (h: string, checked: boolean) => {
    setSelectedHosts((prev) => (checked ? [...prev, h] : prev.filter((x) => x !== h)))
  }

  const canSubmit = name.trim() !== '' && (allHosts || selectedHosts.length > 0)

  const submit = () => {
    if (!canSubmit) return
    onSubmit({ name: name.trim(), hosts: allHosts ? [] : selectedHosts })
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6">{mode === 'create' ? '新建命令组' : '修改命令组'}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {mode === 'create'
            ? '组内命令来自命令模式的勾选（按勾选顺序）'
            : '命令的增删在命令模式勾选后完成，此处只改名称与关联机器'}
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ backgroundColor: 'background.default' }}>
        <Stack spacing={2}>
          <TextField
            fullWidth
            size="small"
            label="名称"
            placeholder="例如:部署前端"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />

          {/* 关联机器 */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>
              关联机器
            </Typography>
            <FormControlLabel
              control={<Checkbox size="small" checked={allHosts} onChange={(e) => toggleAllHosts(e.target.checked)} />}
              label={<Typography variant="body2">全部服务器（默认）</Typography>}
            />
            {!allHosts && (
              <Box sx={{ pl: 2, maxHeight: 180, overflow: 'auto' }}>
                {hostOptions.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    还没有已保存的服务器
                  </Typography>
                )}
                {hostOptions.map((o) => (
                  <FormControlLabel
                    key={o.host}
                    control={
                      <Checkbox
                        size="small"
                        checked={selectedHosts.includes(o.host)}
                        onChange={(e) => toggleHost(o.host, e.target.checked)}
                      />
                    }
                    label={<Typography variant="body2">{o.label}</Typography>}
                  />
                ))}
              </Box>
            )}
          </Box>

          {/* 命令成员(只读预览) */}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>
              命令（{initial.commands.length} 条）
            </Typography>
            {initial.commands.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                暂无命令——请在「命令模式」勾选命令后再新建/加入
              </Typography>
            ) : (
              <Box sx={{ maxHeight: 160, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                <Stack spacing={0.5}>
                  {initial.commands.map((cmd, i) => (
                    <Typography
                      key={`${i}-${cmd}`}
                      variant="body2"
                      noWrap
                      sx={{ fontFamily: '"Cascadia Code", Consolas, monospace', fontSize: 12.5, color: 'text.secondary' }}
                    >
                      {i + 1}. {cmd}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={!canSubmit}>
          {mode === 'create' ? '新建' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

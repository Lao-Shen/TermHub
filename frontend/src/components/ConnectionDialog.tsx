import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import HubIcon from '@mui/icons-material/Hub'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import KeyIcon from '@mui/icons-material/Key'
import LockIcon from '@mui/icons-material/Lock'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import {
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { credentials } from '../services/credentials'
import { local } from '../services/files'
import { useAppStore } from '../store/appStore'
import { AuthMethod, ProxyType } from '../types'
import type { ConnectionConfig } from '../types'

/** 新建连接 ID(crypto.randomUUID,全局唯一)。 */
function newId() {
  return crypto.randomUUID()
}

/** 认证方式选择器(目标机/跳板机共用)。 */
function AuthFields({
  auth,
  setAuth,
  password,
  setPassword,
  keyPath,
  setKeyPath,
  isEdit,
  prefix = '',
  passwordVisible = false,
  onTogglePassword,
}: {
  auth: AuthMethod
  setAuth: (a: AuthMethod) => void
  password: string
  setPassword: (p: string) => void
  keyPath: string
  setKeyPath: (p: string) => void
  /** 编辑模式:密码/路径留空保持不变 */
  isEdit: boolean
  /** 字段标签前缀(如"跳板机 ") */
  prefix?: string
  /** 密码是否明文显示(仅密码认证有效)。 */
  passwordVisible?: boolean
  /** 显示/隐藏密码;不传则不提供眼睛按钮(新建模式无已保存密码)。 */
  onTogglePassword?: () => void
}) {
  return (
    <>
      <ToggleButtonGroup
        value={auth}
        exclusive
        size="small"
        fullWidth
        onChange={(_, v) => v && setAuth(v as AuthMethod)}
      >
        <ToggleButton value={AuthMethod.AuthPassword}>密码认证</ToggleButton>
        <ToggleButton value={AuthMethod.AuthPrivateKey}>私钥认证</ToggleButton>
      </ToggleButtonGroup>

      {auth === AuthMethod.AuthPassword ? (
        <TextField
          label={`${prefix}密码`}
          size="small"
          type={passwordVisible ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isEdit ? '留空保持不变' : ''}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <LockIcon sx={{ fontSize: 18 }} />
                </InputAdornment>
              ),
              endAdornment: onTogglePassword ? (
                <InputAdornment position="end">
                  <Tooltip title={passwordVisible ? '隐藏密码' : '显示已保存的密码'}>
                    <IconButton
                      size="small"
                      aria-label={passwordVisible ? '隐藏密码' : '显示已保存的密码'}
                      onClick={onTogglePassword}
                    >
                      {passwordVisible ? (
                        <VisibilityOffIcon sx={{ fontSize: 17 }} />
                      ) : (
                        <VisibilityIcon sx={{ fontSize: 17 }} />
                      )}
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
      ) : (
        <TextField
          label={`${prefix}私钥文件路径`}
          size="small"
          value={keyPath}
          onChange={(e) => setKeyPath(e.target.value)}
          placeholder="C:\Users\you\.ssh\id_ed25519"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <KeyIcon sx={{ fontSize: 18 }} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <Tooltip title="浏览选择私钥文件">
                    <IconButton
                      size="small"
                      onClick={() => {
                        void local
                          .chooseFile(`选择${prefix}私钥文件`)
                          .then((p) => p && setKeyPath(p))
                      }}
                    >
                      <FolderOpenIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ),
            },
          }}
          helperText={isEdit ? '留空保持不变;暂不支持加密私钥' : '支持 .pem 等 PEM 格式;暂不支持加密私钥(带密码短语)'}
        />
      )}
    </>
  )
}

/** 新建/编辑/补密码连接对话框(含跳板机 ProxyJump 配置)。 */
export function ConnectionDialog() {
  const { open, mode, conn } = useAppStore((s) => s.dialog)
  const closeDialog = useAppStore((s) => s.closeDialog)
  const saveConnection = useAppStore((s) => s.saveConnection)
  const connect = useAppStore((s) => s.connect)

  // connect 模式:仅补密码,其余字段锁定展示;edit 模式:全字段预填,密码留空表示保持不变
  const [name, setName] = useState('')
  // 备注描述(可选,展示在服务器卡片上)
  const [description, setDescription] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(22)
  const [user, setUser] = useState('')
  const [auth, setAuth] = useState<AuthMethod>(AuthMethod.AuthPassword)
  const [password, setPassword] = useState('')
  const [keyPath, setKeyPath] = useState('')
  // 密码明文显示(仅编辑模式提供眼睛按钮;点击时才从系统钥匙串读取)
  const [showPassword, setShowPassword] = useState(false)

  // 跳板机
  const [useProxyJump, setUseProxyJump] = useState(false)
  const [jumpHost, setJumpHost] = useState('')
  const [jumpPort, setJumpPort] = useState(22)
  const [jumpUser, setJumpUser] = useState('')
  const [jumpAuth, setJumpAuth] = useState<AuthMethod>(AuthMethod.AuthPassword)
  const [jumpPassword, setJumpPassword] = useState('')
  const [jumpKeyPath, setJumpKeyPath] = useState('')
  const [showJumpPassword, setShowJumpPassword] = useState(false)

  // 传输层代理(如本地 Clash 127.0.0.1:7897)
  const [proxyType, setProxyType] = useState<ProxyType>(ProxyType.ProxyTypeSOCKS5)
  const [proxyHost, setProxyHost] = useState('')
  const [proxyPort, setProxyPort] = useState(7897)

  // 高级功能折叠(代理/跳板机):已有配置的连接打开时自动展开
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [error, setError] = useState('')

  // 对话框打开时重置表单(dialog 状态变化即触发)
  const [lastOpen, setLastOpen] = useState(false)
  if (open && !lastOpen) {
    setLastOpen(true)
    if (conn && (mode === 'edit' || mode === 'connect')) {
      setName(conn.name)
      setDescription(conn.description ?? '')
      setHost(conn.host)
      setPort(conn.port || 22)
      setUser(conn.user)
      setAuth(conn.auth)
      setPassword('')
      setShowPassword(false)
      setKeyPath(conn.keyPath ?? '')
      setUseProxyJump(!!conn.proxyJump)
      setJumpHost(conn.proxyJump?.host ?? '')
      setJumpPort(conn.proxyJump?.port || 22)
      setJumpUser(conn.proxyJump?.user ?? '')
      setJumpAuth(conn.proxyJump?.auth ?? AuthMethod.AuthPassword)
      setJumpPassword('')
      setShowJumpPassword(false)
      setJumpKeyPath(conn.proxyJump?.keyPath ?? '')
      setProxyType(conn.proxy?.type ?? ProxyType.ProxyTypeSOCKS5)
      setProxyHost(conn.proxy?.host ?? '')
      setProxyPort(conn.proxy?.port || 7897)
      // 高级功能始终默认折叠(用户要求),配置状态经折叠头右侧"已配置"提示
      setShowAdvanced(false)
    } else {
      setName('')
      setDescription('')
      setHost('')
      setPort(22)
      setUser('')
      setAuth(AuthMethod.AuthPassword)
      setPassword('')
      setShowPassword(false)
      setKeyPath('')
      setUseProxyJump(false)
      setJumpHost('')
      setJumpPort(22)
      setJumpUser('')
      setJumpAuth(AuthMethod.AuthPassword)
      setJumpPassword('')
      setShowJumpPassword(false)
      setJumpKeyPath('')
      setProxyType(ProxyType.ProxyTypeSOCKS5)
      setProxyHost('')
      setProxyPort(7897)
      setShowAdvanced(false)
    }
    setError('')
  } else if (!open && lastOpen) {
    setLastOpen(false)
  }

  const isEdit = mode === 'edit'

  /** 显示/隐藏密码:首次显示且输入框为空时,才从系统钥匙串读取已保存密码。 */
  const togglePasswordVisible = async (target: 'server' | 'jump') => {
    const showing = target === 'server' ? showPassword : showJumpPassword
    const setShowing = target === 'server' ? setShowPassword : setShowJumpPassword
    if (showing) {
      setShowing(false)
      return
    }
    const current = target === 'server' ? password : jumpPassword
    if (!current && conn) {
      const saved =
        target === 'server'
          ? await credentials.getPassword(conn.id)
          : await credentials.getProxyPassword(conn.id)
      if (!saved) {
        setError(`未找到已保存的${target === 'server' ? '' : '跳板机'}密码(可能尚未写入系统钥匙串)`)
        return
      }
      if (target === 'server') setPassword(saved)
      else setJumpPassword(saved)
    }
    setError('')
    setShowing(true)
  }

  /** 表单校验:返回错误文案,通过返回 null。
   *  编辑模式密码/私钥路径留空 = 保持上次输入不变(不强制重填)。 */
  const validate = (): string | null => {
    if (!name.trim()) return '请填写连接名称'
    if (!host.trim()) return '请填写主机地址'
    if (port < 1 || port > 65535) return '端口需在 1–65535 之间'
    if (!user.trim()) return '请填写用户名'
    // 编辑模式密码留空 = 保持上次输入不变
    if (!isEdit && auth === AuthMethod.AuthPassword && !password) return '请填写密码'
    if (!isEdit && auth === AuthMethod.AuthPrivateKey && !keyPath.trim()) return '请填写私钥文件路径'

    if (proxyHost.trim()) {
      if (proxyPort < 1 || proxyPort > 65535) return '代理端口需在 1–65535 之间'
    }
    if (useProxyJump) {
      if (!jumpHost.trim()) return '请填写跳板机主机地址'
      if (jumpPort < 1 || jumpPort > 65535) return '跳板机端口需在 1–65535 之间'
      if (!jumpUser.trim()) return '请填写跳板机用户名'
      if (!isEdit && jumpAuth === AuthMethod.AuthPassword && !jumpPassword) return '请填写跳板机密码'
      if (!isEdit && jumpAuth === AuthMethod.AuthPrivateKey && !jumpKeyPath.trim()) return '请填写跳板机私钥文件路径'
    }
    return null
  }

  /** 表单 → 连接配置:代理填了主机才启用;跳板按开关组装;
   *  编辑模式下留空的私钥路径回退到旧值。 */
  const buildCfg = (): ConnectionConfig => ({
    id: conn?.id ?? newId(),
    name: name.trim(),
    description: description.trim() || undefined,
    host: host.trim(),
    port,
    user: user.trim(),
    auth,
    password,
    keyPath: keyPath.trim() || conn?.keyPath,
    trustedHostKey: conn?.trustedHostKey,
    // 传输层代理(如本地 Clash):填了主机才启用
    proxy: proxyHost.trim()
      ? { type: proxyType, host: proxyHost.trim(), port: proxyPort }
      : undefined,
    proxyJump: useProxyJump
      ? {
          host: jumpHost.trim(),
          port: jumpPort,
          user: jumpUser.trim(),
          auth: jumpAuth,
          password: jumpPassword,
          keyPath: jumpKeyPath.trim() || conn?.proxyJump?.keyPath,
          trustedHostKey: conn?.proxyJump?.trustedHostKey,
        }
      : undefined,
  })

  /** 新建/编辑提交:校验 → 保存(秘密不落 localStorage)→
   *  填写过的密码写入系统钥匙串(失败不阻断,下次重新询问)→
   *  andConnect 时携带本次输入的密码直接发起连接。 */
  const submit = (andConnect: boolean) => {
    const err = validate()
    if (err) {
      setError(err)
      return
    }
    const cfg = buildCfg()
    const saved = saveConnection(cfg)
    // 填写了密码则写入系统钥匙串(失败不阻断本次连接,下次重新询问)
    if (cfg.auth === AuthMethod.AuthPassword && password) {
      void credentials.setPassword(cfg.id, password).catch(() => {})
    }
    if (cfg.proxyJump?.auth === AuthMethod.AuthPassword && jumpPassword) {
      void credentials.setProxyPassword(cfg.id, jumpPassword).catch(() => {})
    }
    closeDialog()
    if (andConnect) {
      void connect(saved, password || undefined, jumpPassword || undefined)
    }
  }

  /** connect(补密码)模式提交:只补密码不保存其他字段;
   *  密码存钥匙串,下次启动免输入。 */
  const connectOnly = () => {
    if (!conn) return
    if (conn.auth === AuthMethod.AuthPassword && !password) {
      setError('请填写密码')
      return
    }
    if (conn.proxyJump?.auth === AuthMethod.AuthPassword && !jumpPassword) {
      setError('请填写跳板机密码')
      return
    }
    // 密码存入系统钥匙串,下次启动免输入
    if (password) void credentials.setPassword(conn.id, password).catch(() => {})
    if (jumpPassword) void credentials.setProxyPassword(conn.id, jumpPassword).catch(() => {})
    closeDialog()
    void connect(conn, password || undefined, jumpPassword || undefined)
  }

  return (
    <Dialog open={open} onClose={closeDialog} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {mode === 'edit' ? `编辑 ${conn?.name ?? ''}` : mode === 'connect' ? `连接 ${conn?.name ?? ''}` : '新建连接'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {mode === 'connect' ? (
            <Typography variant="body2" color="text.secondary">
              {conn?.user}@{conn?.host}:{conn?.port || 22}
              {conn?.proxyJump && ` · 经跳板机 ${conn.proxyJump.user}@${conn.proxyJump.host}:${conn.proxyJump.port || 22}`}
              {conn?.proxy && ` · 经代理 ${conn.proxy.host}:${conn.proxy.port}`}
              ,请输入密码
            </Typography>
          ) : (
            <>
              <TextField label="名称" size="small" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="例如:生产服务器" />
              <TextField
                label="描述(可选)"
                size="small"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例如:生产环境主库,勿随意重启"
              />
              <Stack direction="row" spacing={1.5}>
                <TextField label="主机" size="small" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.10" sx={{ flex: 1 }} />
                <TextField
                  label="端口"
                  size="small"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value) || 0)}
                  sx={{ width: 104 }}
                />
              </Stack>
              <TextField label="用户名" size="small" value={user} onChange={(e) => setUser(e.target.value)} placeholder="root" />
            </>
          )}

          {mode === 'connect' && conn?.auth === AuthMethod.AuthPassword && (
            <TextField
              label="密码"
              size="small"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockIcon sx={{ fontSize: 18 }} />
                    </InputAdornment>
                  ),
                },
              }}
            />
          )}

          {mode === 'connect' && conn?.proxyJump?.auth === AuthMethod.AuthPassword && (
            <TextField
              label="跳板机密码"
              size="small"
              type="password"
              value={jumpPassword}
              onChange={(e) => setJumpPassword(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <HubIcon sx={{ fontSize: 18 }} />
                    </InputAdornment>
                  ),
                },
              }}
            />
          )}

          {mode !== 'connect' && (
            <AuthFields
              auth={auth}
              setAuth={setAuth}
              password={password}
              setPassword={setPassword}
              keyPath={keyPath}
              setKeyPath={setKeyPath}
              isEdit={isEdit}
              passwordVisible={showPassword}
              // 仅编辑已保存连接时提供:新建模式没有可读取的历史密码
              onTogglePassword={isEdit && conn ? () => void togglePasswordVisible('server') : undefined}
            />
          )}

          {/* 高级功能(折叠):传输代理 / 跳板机,默认收起,已配置时自动展开 */}
          {mode !== 'connect' && (
            <Box
              sx={{
                borderRadius: 2,
                border: '1px solid',
                borderColor: proxyHost.trim() || useProxyJump ? 'info.main' : 'divider',
              }}
            >
              {/* 折叠头:点击展开/收起,箭头旋转指示,右侧显示配置状态 */}
              <Box
                onClick={() => setShowAdvanced((v) => !v)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 1.5,
                  py: 1,
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <ExpandMoreIcon
                  sx={{
                    fontSize: 18,
                    color: 'text.secondary',
                    transition: 'transform 0.15s',
                    transform: showAdvanced ? 'rotate(180deg)' : 'none',
                  }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  高级功能
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1, textAlign: 'right' }}>
                  {proxyHost.trim() || useProxyJump ? '已配置' : '传输代理 / 跳板机'}
                </Typography>
              </Box>

              <Collapse in={showAdvanced}>
                <Box sx={{ px: 1.5, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {/* 传输层代理(如本地 Clash) */}
                  <Box
                    sx={{
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: proxyHost.trim() ? 'info.main' : 'divider',
                      p: 1.5,
                      transition: 'border-color 0.15s',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: proxyHost.trim() ? 1.5 : 0 }}>
                      <HubIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        代理设置(可选)
                      </Typography>
                    </Box>
                    {proxyHost.trim() ? (
                      <Stack spacing={1.5}>
                        <ToggleButtonGroup
                          value={proxyType}
                          exclusive
                          size="small"
                          fullWidth
                          onChange={(_, v) => v && setProxyType(v as ProxyType)}
                        >
                          <ToggleButton value={ProxyType.ProxyTypeSOCKS5}>SOCKS5</ToggleButton>
                          <ToggleButton value={ProxyType.ProxyTypeHTTP}>HTTP</ToggleButton>
                        </ToggleButtonGroup>
                        <Stack direction="row" spacing={1.5}>
                          <TextField
                            label="代理主机"
                            size="small"
                            value={proxyHost}
                            onChange={(e) => setProxyHost(e.target.value)}
                            placeholder="127.0.0.1"
                            sx={{ flex: 1 }}
                          />
                          <TextField
                            label="端口"
                            size="small"
                            type="number"
                            value={proxyPort}
                            onChange={(e) => setProxyPort(Number(e.target.value) || 0)}
                            sx={{ width: 104 }}
                          />
                        </Stack>
                      </Stack>
                    ) : (
                      <Button size="small" onClick={() => setProxyHost('127.0.0.1')}>
                        + 添加代理(如本地 Clash)
                      </Button>
                    )}
                  </Box>

                  {/* 跳板机(ProxyJump) */}
                  <Box
                    sx={{
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: useProxyJump ? 'primary.main' : 'divider',
                      p: 1.5,
                      transition: 'border-color 0.15s',
                    }}
                  >
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={useProxyJump}
                          onChange={(e) => setUseProxyJump(e.target.checked)}
                        />
                      }
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <HubIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                          <Typography variant="body2">通过跳板机连接 (ProxyJump)</Typography>
                        </Box>
                      }
                    />
                    {useProxyJump && (
                      <Stack spacing={1.5} sx={{ mt: 1 }}>
                        <Stack direction="row" spacing={1.5}>
                          <TextField label="跳板机主机" size="small" value={jumpHost} onChange={(e) => setJumpHost(e.target.value)} placeholder="bastion.example.com" sx={{ flex: 1 }} />
                          <TextField
                            label="端口"
                            size="small"
                            type="number"
                            value={jumpPort}
                            onChange={(e) => setJumpPort(Number(e.target.value) || 0)}
                            sx={{ width: 104 }}
                          />
                        </Stack>
                        <TextField label="跳板机用户名" size="small" value={jumpUser} onChange={(e) => setJumpUser(e.target.value)} placeholder="ops" />
                        <AuthFields
                          auth={jumpAuth}
                          setAuth={setJumpAuth}
                          password={jumpPassword}
                          setPassword={setJumpPassword}
                          keyPath={jumpKeyPath}
                          setKeyPath={setJumpKeyPath}
                          isEdit={isEdit}
                          prefix="跳板机 "
                          passwordVisible={showJumpPassword}
                          onTogglePassword={
                            isEdit && conn ? () => void togglePasswordVisible('jump') : undefined
                          }
                        />
                      </Stack>
                    )}
                  </Box>
                </Box>
              </Collapse>
            </Box>
          )}

          {error && (
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={closeDialog} color="inherit">
          取消
        </Button>
        {mode === 'new' && <Button onClick={() => submit(false)}>仅保存</Button>}
        {mode === 'edit' && <Button onClick={() => submit(false)}>保存</Button>}
        {mode === 'connect' ? (
          <Button variant="contained" onClick={connectOnly}>
            连接
          </Button>
        ) : (
          <Button variant="contained" onClick={() => submit(true)}>
            保存并连接
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

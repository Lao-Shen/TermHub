// 渲染错误边界:包住主内容区(MainArea),子组件渲染崩溃时
// 展示错误原因与"重试"按钮,而不是整应用白屏;状态类组件是错误边界的硬性要求。
import { Box, Button, Typography } from '@mui/material'
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 渲染错误边界:子组件崩溃时展示原因而不是整应用白屏。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  /** 子树抛错时捕获并进入错误态(React 错误边界契约)。 */
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <Box
          sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            px: 4,
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            界面渲染出错
          </Typography>
          <Typography
            variant="body2"
            color="error"
            sx={{ maxWidth: 560, textAlign: 'center', wordBreak: 'break-all' }}
          >
            {this.state.error.message}
          </Typography>
          <Button
            variant="outlined"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </Button>
        </Box>
      )
    }
    return this.props.children
  }
}

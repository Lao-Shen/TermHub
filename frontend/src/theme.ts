// MUI 主题定义(Tokyo Night 风格暗色主题)。
// 全局唯一的视觉基线:色板、圆角、字体、滚动条与全局样式覆盖都在这里;
// 组件内的 sx 颜色一律引用 palette 语义色,不改本文件以外的地方。
import { createTheme } from '@mui/material/styles'

// Tokyo Night 风格暗色主题:低饱和深底 + 蓝紫主色,贴近终端工具的视觉习惯。
export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#10121a',
      paper: '#161925',
    },
    primary: { main: '#7aa2f7' },
    secondary: { main: '#bb9af7' },
    success: { main: '#9ece6a' },
    error: { main: '#f7768e' },
    warning: { main: '#e0af68' },
    info: { main: '#7dcfff' },
    text: {
      primary: '#c0caf5',
      secondary: '#828bb8',
    },
    divider: '#1f2335',
    action: {
      hover: 'rgba(122, 162, 247, 0.08)',
      selected: 'rgba(122, 162, 247, 0.16)',
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          // 全局细滚动条,贴合暗色界面
          '*::-webkit-scrollbar': { width: 8, height: 8 },
          '*::-webkit-scrollbar-thumb': {
            background: '#2a3042',
            borderRadius: 4,
            '&:hover': { background: '#3b4360' },
          },
          '*::-webkit-scrollbar-track': { background: 'transparent' },
          userSelect: 'none', // 桌面应用习惯;终端与输入框内单独放开
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none',
          border: '1px solid #1f2335',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#24283b',
          fontSize: 12,
        },
      },
    },
  },
})

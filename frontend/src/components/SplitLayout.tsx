import { Box } from '@mui/material'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 可拖拽左右分屏(覆盖式手柄方案):
 * 两窗之间用 flex gap 留缝,拖拽手柄绝对定位悬浮在缝隙上(不属于文档流,
 * 不影响占比计算);right 为空时不渲染缝隙与手柄,左区占满 ——
 * 保证左子节点位置稳定,切换分屏/全屏不重建(终端历史不丢)。
 */
export function SplitLayout({
  left,
  right,
  defaultRatio = 0.5,
}: {
  left: ReactNode
  right: ReactNode | null
  defaultRatio?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [rightPx, setRightPx] = useState<number | null>(null)
  const dragging = useRef(false)

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !wrapRef.current) return
      const rect = wrapRef.current.getBoundingClientRect()
      // 右面板宽 = 容器右缘 - 鼠标位置(+3 补偿手柄位于缝隙中央)
      const w = rect.right - e.clientX + 3
      setRightPx(Math.max(320, Math.min(rect.width - 420, w)))
    }
    const up = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  return (
    <Box
      ref={wrapRef}
      sx={{ height: '100%', display: 'flex', p: '10px 14px', gap: right !== null ? '6px' : 0 }}
    >
      <Box sx={{ flex: 1, minWidth: 0, position: 'relative' }}>{left}</Box>

      {right !== null && (
        <>
          {/* 右窗(手柄悬浮于其左缘缝隙上) */}
          <Box
            sx={{
              position: 'relative',
              width: rightPx ?? `${Math.round(defaultRatio * 100)}%`,
              minWidth: 320,
              flexShrink: 0,
            }}
          >
            {/* 覆盖式拖拽手柄:悬浮在缝隙中央,不占布局 */}
            <Box
              onMouseDown={onDown}
              sx={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: -3,
                width: 6,
                cursor: 'col-resize',
                zIndex: 5,
              }}
            />
            {right}
          </Box>
        </>
      )}
    </Box>
  )
}

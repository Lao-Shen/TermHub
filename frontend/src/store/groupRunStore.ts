// 命令组执行引擎(全局状态):按组内顺序执行各步骤,失败即停,支持终止。
//   - 常规(normal):另开 exec 通道执行,拿退出码(精确);输出进运行面板。
//   - 传输(transfer):runTransferCommand,发起上传并等 transfer:done。
//   - 外部(external):宿主机 hostCmd,等 done 事件的退出码;输出进运行面板。
// 步骤类型按"命令文本"从命令模式查(命令组只存命令文本,见 commonCommands.ts)。
import { Events } from '@wailsio/runtime'
import { create } from 'zustand'
import { commandMetaByCommand } from '../services/commonCommands'
import type { CommonCommandType } from '../services/commonCommands'
import { hostCmd } from '../services/hostCmd'
import { runTransferCommand } from '../services/transferCommand'
import { tools } from '../services/tools'
import { errMsg } from '../types'

export type GroupStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled'

export interface GroupRunStep {
  index: number
  type: CommonCommandType
  command: string
  status: GroupStepStatus
  output: string
  error?: string
  /** 是否参与执行(按需执行时可勾选;立即执行时全为 true)。 */
  selected: boolean
}

export interface GroupRun {
  id: string
  /** 运行来源:命令组 / 单条命令。 */
  kind: 'group' | 'single'
  sessionId: string
  groupName: string
  steps: GroupRunStep[]
  /** 当前步序号(0 起)。 */
  current: number
  /** idle=按需执行已就绪等待勾选执行;其余为运行中/结束态。 */
  status: 'idle' | 'running' | 'success' | 'failed' | 'canceled'
  error?: string
}

interface GroupRunState {
  run: GroupRun | null
  start(sessionId: string, kind: 'group' | 'single', groupName: string, commands: string[]): void
  /** 按需执行:创建运行但先不执行,等用户勾选后 runSelected。 */
  arm(sessionId: string, groupName: string, commands: string[]): void
  /** 切换某步是否参与执行(仅 idle 态)。 */
  toggleStep(index: number): void
  /** 全选/全不选(仅 idle 态)。 */
  setAllSelected(selected: boolean): void
  /** 执行当前已勾选的步骤(按原顺序);仅 idle 态有效。 */
  runSelected(): void
  cancel(): void
  dismiss(): void
}

// 模块级取消状态:当前运行是否被终止 + 当前步骤的取消函数(仅外部命令可即时取消)。
let canceled = false
let cancelCurrent: (() => void) | null = null

export const useGroupRunStore = create<GroupRunState>((set, get) => ({
  run: null,

  start(sessionId, kind, groupName, commands) {
    // 单次只允许一个运行:正在进行时忽略新的启动
    if (get().run?.status === 'running') return
    const run: GroupRun = {
      id: `grp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      kind,
      sessionId,
      groupName,
      steps: buildSteps(commands),
      current: 0,
      status: 'running',
    }
    canceled = false
    cancelCurrent = null
    set({ run })
    void execute(run.id)
  },

  arm(sessionId, groupName, commands) {
    if (get().run?.status === 'running') return
    canceled = false
    cancelCurrent = null
    set({
      run: {
        id: `grp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        kind: 'group',
        sessionId,
        groupName,
        steps: buildSteps(commands),
        current: 0,
        status: 'idle',
      },
    })
  },

  toggleStep(index) {
    const run = get().run
    if (!run || run.status !== 'idle') return
    set({ run: { ...run, steps: run.steps.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s)) } })
  },

  setAllSelected(selected) {
    const run = get().run
    if (!run || run.status !== 'idle') return
    set({ run: { ...run, steps: run.steps.map((s) => ({ ...s, selected })) } })
  },

  runSelected() {
    const run = get().run
    if (!run || run.status !== 'idle') return
    const first = run.steps.findIndex((s) => s.selected)
    if (first < 0) return
    canceled = false
    cancelCurrent = null
    set({ run: { ...run, status: 'running', current: first, error: undefined } })
    void execute(run.id)
  },

  cancel() {
    canceled = true
    try {
      cancelCurrent?.()
    } catch {
      /* 忽略 */
    }
  },

  dismiss() {
    if (get().run?.status === 'running') return
    set({ run: null })
  },
}))

// ---- 内部实现 ----

function patchStep(runId: string, index: number, patch: Partial<GroupRunStep>) {
  const run = useGroupRunStore.getState().run
  if (!run || run.id !== runId) return
  const steps = run.steps.map((s, i) => (i === index ? { ...s, ...patch } : s))
  useGroupRunStore.setState({ run: { ...run, steps } })
}

function patchRun(runId: string, patch: Partial<GroupRun>) {
  const run = useGroupRunStore.getState().run
  if (!run || run.id !== runId) return
  useGroupRunStore.setState({ run: { ...run, ...patch } })
}

function stepOutput(runId: string, index: number): string {
  const run = useGroupRunStore.getState().run
  if (!run || run.id !== runId) return ''
  return run.steps[index]?.output ?? ''
}

/** 按命令文本解析各步类型,构造步骤列表(默认全选)。 */
function buildSteps(commands: string[]): GroupRunStep[] {
  const meta = commandMetaByCommand()
  return commands.map((command, index) => ({
    index,
    type: meta.get(command)?.type ?? 'normal',
    command,
    status: 'pending',
    output: '',
    selected: true,
  }))
}

/** 按顺序执行全部步骤(失败即停)。 */
async function execute(runId: string) {
  const initial = useGroupRunStore.getState().run
  if (!initial) return
  const { sessionId } = initial

  for (let i = 0; i < initial.steps.length; i++) {
    if (canceled) break
    const step = useGroupRunStore.getState().run?.steps[i]
    if (!step) break
    // 按需执行:跳过未勾选的步骤
    if (!step.selected) continue

    patchRun(runId, { current: i })
    patchStep(runId, i, { status: 'running', error: undefined })

    try {
      if (step.type === 'external') {
        await runHostCommand(step.command, (chunk) => {
          patchStep(runId, i, { output: stepOutput(runId, i) + chunk })
        })
        patchStep(runId, i, { status: 'done' })
      } else if (step.type === 'transfer') {
        await runTransferCommand(sessionId, step.command)
        patchStep(runId, i, { status: 'done' })
      } else {
        const res = await tools.runCommand(sessionId, step.command, 0)
        const output = res.output ?? ''
        if (res.exitCode === 0) {
          patchStep(runId, i, { output, status: 'done' })
        } else {
          patchStep(runId, i, { output, status: 'failed', error: `退出码 ${res.exitCode}` })
          patchRun(runId, { status: 'failed', error: `第 ${i + 1} 步失败（退出码 ${res.exitCode}）` })
          return
        }
      }
    } catch (err) {
      const message = errMsg(err)
      patchStep(runId, i, { status: canceled ? 'canceled' : 'failed', error: message })
      patchRun(runId, { status: canceled ? 'canceled' : 'failed', error: message })
      return
    }
  }

  patchRun(runId, { status: canceled ? 'canceled' : 'success' })
}

/** 执行宿主机命令并等待 done 事件(收集输出);失败按退出码/错误 reject。 */
function runHostCommand(command: string, onOutput: (chunk: string) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let hostRunId: string | null = null
    let settled = false
    const finished = new Map<string, { exitCode: number; error?: string }>()

    const handleDone = (d: { exitCode: number; error?: string }) => {
      if (settled) return
      settled = true
      offOut()
      offDone()
      cancelCurrent = null
      if (d.error) reject(new Error(d.error))
      else if (d.exitCode !== 0) reject(new Error(`退出码 ${d.exitCode}`))
      else resolve()
    }

    const offOut = Events.On('termhub:hostcmd:output', (ev: any) => {
      const d = ev?.data
      if (hostRunId && d?.runId === hostRunId && d.data) onOutput(d.data)
    })
    const offDone = Events.On('termhub:hostcmd:done', (ev: any) => {
      const d = ev?.data
      if (!d?.runId) return
      if (hostRunId && d.runId === hostRunId) handleDone(d)
      else finished.set(d.runId, d)
    })

    hostCmd
      .start(command, '')
      .then((id) => {
        hostRunId = id
        cancelCurrent = () => {
          void hostCmd.cancel(id)
        }
        const early = finished.get(id)
        if (early) handleDone(early)
      })
      .catch((e) => {
        settled = true
        offOut()
        offDone()
        reject(e)
      })
  })
}

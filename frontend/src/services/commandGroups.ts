// 命令组数据层(localStorage 持久化):命令组 = 名称 + 关联主机名 + 命令(按加入顺序)。
// 创建命令组只能从"命令模式"多选后点「新建命令组」;添加命令也只在命令模式多选后「加入命令组」。
import { COMMAND_GROUPS_KEY } from './storageKeys'

export interface CommandGroup {
  id: number
  name: string
  /** 关联的主机名;为空数组表示全部服务器。 */
  hosts: string[]
  commands: string[]
}

const STORAGE_KEY = COMMAND_GROUPS_KEY

export function loadCommandGroups(): CommandGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as CommandGroup[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function persistCommandGroups(list: CommandGroup[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* 存储满/隐私模式,静默 */
  }
}

/** 组内命令按顺序以 " && " 拼接(复制用;未来执行复用同一规则)。 */
export function joinGroupCommands(commands: string[]): string {
  return commands.join(' && ')
}

/** 过滤出与指定主机相关的组(host 为空或组未指定主机=全部服务器)。 */
export function groupsForHost(groups: CommandGroup[], host?: string): CommandGroup[] {
  if (!host) return groups
  return groups.filter((g) => g.hosts.length === 0 || g.hosts.includes(host))
}

/** 新建命令组(命令成员来自命令模式的多选,按勾选顺序);返回新组。 */
export function createCommandGroup(name: string, hosts: string[], commands: string[]): CommandGroup {
  const groups = loadCommandGroups()
  const group: CommandGroup = { id: Date.now(), name, hosts, commands }
  persistCommandGroups([...groups, group])
  return group
}

/** 把命令追加到指定组(已存在则不重复添加);返回是否新增。 */
export function addCommandToGroup(groupId: number, command: string): boolean {
  const groups = loadCommandGroups()
  const target = groups.find((g) => g.id === groupId)
  if (!target || target.commands.includes(command)) return false
  target.commands = [...target.commands, command]
  persistCommandGroups(groups)
  return true
}

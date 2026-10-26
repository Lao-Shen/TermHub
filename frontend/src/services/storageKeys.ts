// localStorage 键的统一出处:连接配置、按连接隔离的附属数据、全局命令库。
// 导出/导入服务器数据(List of keys)与各处读写共用,避免键名散落导致备份遗漏。
export const CONNECTIONS_KEY = 'termhub.connections'

/** 私有命令库:按连接 ID 隔离。 */
export const PRIVATE_COMMANDS_KEY_PREFIX = 'termhub.privatecommands.'
/** 文件传输黑名单:按连接 ID 隔离。 */
export const FILE_BLACKLIST_KEY_PREFIX = 'termhub.ftblacklist.'
/** 双栏文件传输记住的本地/远端路径(JSON `{local,remote}`):按连接 ID 隔离。 */
export const FT_PATH_KEY_PREFIX = 'termhub.ftpath.'
/** 文件视图记住的远端路径:按连接 ID 隔离。 */
export const FILEVIEW_PATH_KEY_PREFIX = 'termhub.fileviewpath.'

/** 公共常用命令库。 */
export const COMMON_COMMANDS_KEY = 'termhub.commoncommands'
/** 命令组。 */
export const COMMAND_GROUPS_KEY = 'termhub.commandgroups'

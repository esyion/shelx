/**
 * 远端风格路径拼接(与文件系统无关的纯函数,本地/远端面板共用)。
 */

/** 以 `/` 分隔符拼接目录与名称,避免出现双斜杠。 */
export function joinRemotePath(dir: string, name: string): string {
  const trimmed = dir.endsWith("/") ? dir : `${dir}/`;
  return `${trimmed}${name}`;
}

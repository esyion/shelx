/**
 * 主页(PRD §6.1)。
 *
 * 工作区 UI(侧栏 + 标签栏 + 工作区 + 底部面板)必须常驻在根 layout 的
 * <AppShell>(App Router layout 跨导航持久);若放回本页面,进入设置/
 * 总览等功能页会卸载 TerminalView,导致 pty 通道断开、终端内容丢失。
 * 本页面仅保证 "/" 路由存在,无需渲染任何内容。
 */
export default function HomePage() {
  return null;
}

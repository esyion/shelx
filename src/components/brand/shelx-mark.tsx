/**
 * shelx 品牌字形:终端提示符箭头(取自 `public/shelx.svg` 的首段路径)。
 *
 * AI 助手与 Agent 消息头像用品牌字形标识身份,替代通用火花图标;
 * 路径与侧栏字标同源,缩放不失真。品牌绿 `#00FF66` 是两主题共用色
 * (与 `public/shelx-light.svg` 同一口径,见 `sidebar.tsx` 头部注释),
 * 因此内联 SVG 不走 `currentColor`,装饰性对读屏隐藏。
 */
export function ShelxMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="1.4 15.2 16.4 19.5"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        d="M2.432 33.708V30.028L11.712 25.74C12.1387 25.548 12.5547 25.388 12.96 25.26C13.3867 25.1107 13.7173 25.0147 13.952 24.972C13.7173 24.9293 13.3867 24.8547 12.96 24.748C12.5333 24.62 12.1173 24.46 11.712 24.268L2.432 19.948V16.204L16.768 22.956V26.956L2.432 33.708Z"
        fill="#00FF66"
      />
    </svg>
  );
}

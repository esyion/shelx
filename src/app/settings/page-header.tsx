/**
 * 设置分区页的标题块:左右分栏外壳只提供「设置」总标题,
 * 各分区页用它说明自己管什么,避免用户在分区之间迷路。
 */
/** 分区页标题块属性。 */
interface PageHeaderProps {
  /** 分区标题。 */
  title: string;
  /** 一句话说明这个分区管什么、改了会发生什么。 */
  description: string;
}

/** 分区页标题块。 */
export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </header>
  );
}

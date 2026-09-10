import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GreetPanel } from "./_components/greet-panel";

/**
 * 应用主入口页。
 * 当前为脚手架阶段:展示产品定位与 IPC 冒烟面板;
 * 连接树 / 终端 / SFTP / 监控工作区随里程碑逐步落地(PRD §10)。
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">shelx</CardTitle>
          <CardDescription>
            轻量、纯净、开源的 SSH + SFTP + 监控一体化服务器管理工具。
            前端已切换为 Next.js(App Router,静态导出)。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            下方面板用于验证 Tauri IPC 链路(Next.js 前端 → Rust 后端)。
          </p>
          <GreetPanel />
        </CardContent>
      </Card>
    </main>
  );
}

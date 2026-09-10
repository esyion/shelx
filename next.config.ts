import type { NextConfig } from "next";

/**
 * shelx 前端以纯静态导出形态交付,构建产物为 out/ 目录,
 * 由 Tauri 在运行时直接加载(PRD §7.7-8)。
 *
 * 因此禁用一切依赖 Node 服务端运行时的能力:
 * SSR 动态渲染、Server Actions、动态 Route Handler、proxy 等,
 * 所有业务数据一律经 Tauri command / ipc Channel 获取。
 */
const nextConfig: NextConfig = {
  output: "export",
  // 静态导出不支持默认图片优化服务,本地资源必须原样输出
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
};

export default nextConfig;

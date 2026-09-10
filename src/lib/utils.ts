import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 Tailwind 类名并去重冲突(条件类、覆盖类)。
 * shadcn/ui 组件的标准 className 组合工具。
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

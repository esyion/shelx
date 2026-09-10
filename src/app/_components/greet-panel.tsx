"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGreet } from "../hooks/use-greet";

/**
 * Tauri IPC 链路冒烟面板。
 * 输入名称调用 Rust 端 greet command,用于验证 Next.js 静态导出前端与
 * Tauri 后端的 invoke 通路;后续连接管理等业务就绪后由真实功能取代。
 */
export function GreetPanel() {
  const [name, setName] = useState("");
  const { state, submit } = useGreet();

  /** 处理表单提交,空名称直接复用上一次输入。 */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.status !== "loading") {
      void submit(name.trim() || "shelx");
    }
  }

  return (
    <form className="flex w-full max-w-sm flex-col gap-3" onSubmit={handleSubmit}>
      <div className="flex gap-2">
        <Input
          aria-label="你的名称"
          placeholder="输入名称…"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Button type="submit" disabled={state.status === "loading"}>
          {state.status === "loading" ? "调用中…" : "问候"}
        </Button>
      </div>
      {state.status === "success" && (
        <p className="text-sm text-muted-foreground" role="status">
          {state.message}
        </p>
      )}
      {state.status === "error" && (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}

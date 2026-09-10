"use client";

import { useCallback, useState } from "react";
import { greet } from "../api";

/** greet 冒烟测试的界面状态。 */
interface GreetState {
  status: "idle" | "loading" | "success" | "error";
  message: string;
}

/**
 * 管理 greet 冒烟表单的调用与展示状态。
 * 覆盖 loading / success / error 三类状态,error 可重试。
 */
export function useGreet(initialMessage = "") {
  const [state, setState] = useState<GreetState>({ status: "idle", message: initialMessage });

  /** 提交名称并调用后端,失败时保留错误文案供重试。 */
  const submit = useCallback(async (name: string) => {
    setState({ status: "loading", message: "" });
    try {
      const message = await greet(name);
      setState({ status: "success", message });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: "error", message });
    }
  }, []);

  return { state, submit };
}

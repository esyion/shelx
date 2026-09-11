/**
 * 连接期交互弹窗(F5):首次主机指纹确认 + 键盘交互(OTP)。
 * 均由后端事件驱动,应答经 respond_* 命令回传(PRD §6.2、设计文档 §6.4)。
 */
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { respondAuthPrompt, respondHostkeyConfirm } from "@/app/api";
import { listenEvent, SESSION_EVENTS } from "@/gateway";
import type { AuthPromptEvent, HostKeyConfirmEvent } from "@/types";

/** 首次主机指纹确认弹窗(TOFU);拒绝或关闭都按不信任处理。 */
export function HostKeyConfirmDialog() {
  const [request, setRequest] = useState<HostKeyConfirmEvent | null>(null);
  const [answering, setAnswering] = useState(false);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void listenEvent<HostKeyConfirmEvent>(SESSION_EVENTS.hostkeyConfirm, (event) => {
      setRequest(event);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, []);

  /** 应答后端;UI 关闭。 */
  const answer = async (accepted: boolean) => {
    if (!request) return;
    setAnswering(true);
    try {
      await respondHostkeyConfirm(request.requestId, accepted);
    } finally {
      setRequest(null);
      setAnswering(false);
    }
  };

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(next) => !next && void answer(false)}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>首次连接,确认主机指纹</DialogTitle>
        </DialogHeader>
        {request && (
          <div className="grid gap-2 text-sm">
            <p className="text-muted-foreground">
              {request.host}:{request.port} 的主机公钥指纹:
            </p>
            <dl className="grid gap-1 rounded-md bg-muted p-3 font-mono text-xs">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">算法</dt>
                <dd>{request.algorithm}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">SHA256</dt>
                <dd className="break-all">{request.fingerprint.replace(/^SHA256:/, "")}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              确认指纹无误后才会继续连接,用于防止中间人攻击。
              可在服务器上执行
              <code className="mx-1 rounded bg-muted px-1">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>
              比对。
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => void answer(false)} disabled={answering}>
            拒绝
          </Button>
          <Button onClick={() => void answer(true)} disabled={answering}>
            信任并连接
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 键盘交互弹窗(OTP 等):逐条 prompt 收集,密码型不回显。 */
export function AuthPromptDialog() {
  const [request, setRequest] = useState<AuthPromptEvent | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [answering, setAnswering] = useState(false);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void listenEvent<AuthPromptEvent>(SESSION_EVENTS.authPrompt, (event) => {
      setRequest(event);
      setAnswers(new Array(event.prompts.length).fill(""));
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, []);

  /** 提交逐条回答。 */
  const submit = async () => {
    if (!request) return;
    setAnswering(true);
    try {
      await respondAuthPrompt(request.requestId, answers);
    } finally {
      setRequest(null);
      setAnswering(false);
    }
  };

  return (
    <Dialog open={request !== null} onOpenChange={(next) => !next && setRequest(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{request?.name || "服务器要求验证"}</DialogTitle>
        </DialogHeader>
        {request && (
          <div className="grid gap-3">
            {request.instructions && (
              <p className="text-xs text-muted-foreground">{request.instructions}</p>
            )}
            {request.prompts.map((prompt, index) => (
              <div key={index} className="grid gap-1.5">
                <Label className="text-xs text-muted-foreground">{prompt.prompt}</Label>
                <Input
                  type={prompt.echo ? "text" : "password"}
                  value={answers[index] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) =>
                      prev.map((value, i) => (i === index ? e.target.value : value)),
                    )
                  }
                  autoFocus={index === 0}
                  autoComplete="one-time-code"
                />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setRequest(null)} disabled={answering}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={answering}>
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

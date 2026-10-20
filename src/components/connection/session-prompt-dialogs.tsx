/**
 * 连接期交互弹窗(F5):首次主机指纹确认 + 键盘交互(OTP)。
 * 均由后端事件驱动,应答经 respond_* 命令回传(PRD §6.2、设计文档 §6.4)。
 *
 * 文案面向普通用户:人话解释「为什么要确认」、指纹一键复制,
 * 命令行比对方式降级为高级用户可展开的次要说明。
 */
"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  respondAuthPrompt,
  respondHostkeyConfirm,
  writeClipboardText,
} from "@/app/api";
import { listenEvent, SESSION_EVENTS } from "@/gateway";
import type { AuthPromptEvent, HostKeyConfirmEvent } from "@/types";

/** 首次主机指纹确认弹窗(TOFU);拒绝或关闭都按不信任处理。 */
export function HostKeyConfirmDialog() {
  const [request, setRequest] = useState<HostKeyConfirmEvent | null>(null);
  const [answering, setAnswering] = useState(false);
  /** 指纹是否已复制到剪贴板(按钮反馈状态)。 */
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void listenEvent<HostKeyConfirmEvent>(SESSION_EVENTS.hostkeyConfirm, (event) => {
      setRequest(event);
      setCopied(false);
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

  /** 复制完整指纹(算法 + 指纹值)到系统剪贴板。 */
  const copyFingerprint = () => {
    if (!request) return;
    const normalized = request.fingerprint.startsWith("SHA256:")
      ? request.fingerprint
      : `SHA256:${request.fingerprint}`;
    void writeClipboardText(`${request.algorithm} ${normalized}`).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(next) => !next && void answer(false)}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>第一次连接这台服务器,请确认身份</DialogTitle>
          <DialogDescription>
            这是你第一次连接 {request?.host}:{request?.port}。
            请先核对下面的指纹,确认它就是你要连的那台机器——
            这样可以防止有人冒充服务器截获你的数据(中间人攻击)。
          </DialogDescription>
        </DialogHeader>
        {request && (
          <div className="grid gap-2 text-sm">
            <div className="flex items-start gap-2 rounded-md bg-muted p-3">
              <div className="min-w-0 flex-1 grid gap-1 font-mono text-xs">
                <span className="text-muted-foreground">
                  服务器指纹({request.algorithm})
                </span>
                <span className="break-all">
                  {request.fingerprint.replace(/^SHA256:/, "SHA256:")}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label="复制服务器指纹"
                title="复制指纹,可发给服务器管理员核对"
                onClick={copyFingerprint}
              >
                {copied ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              不放心时,可把上面的指纹发给帮你管理这台服务器的人核对。
            </p>
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown className="size-3" />
                高级:如何在服务器上自行验证指纹
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1.5 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                在服务器终端执行
                <code className="mx-1 rounded bg-muted px-1">
                  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
                </code>
                ,将输出与上面的指纹比对。仅熟悉 Linux 的用户需要,可不展开。
              </CollapsibleContent>
            </Collapsible>
            <p className="text-xs text-muted-foreground">
              信任后本机将记住这个指纹,下次连接这台服务器不会再询问。
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
          <DialogTitle>服务器要求额外验证</DialogTitle>
          <DialogDescription>
            登录时服务器要求你提供额外验证信息(如手机动态口令),请按提示填写。
            {/* 服务器下发的验证方式名称原样展示,但不裸作标题。 */}
            {request?.name ? `本次验证方式:${request.name}` : ""}
          </DialogDescription>
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

/**
 * 全局命令式弹窗服务:confirmDialog / promptDialog。
 *
 * 以应用内 shadcn AlertDialog/Dialog 实现应用级确认与输入,替代
 * window.confirm / window.prompt —— 原生对话框在 Tauri WebView 中会被
 * tauri-plugin-dialog 覆写为 IPC 调用,受 capability 授权限制且不可定制。
 * 用法:`const ok = await confirmDialog({ title: "删除" })`。
 * 需在应用壳挂载一次 {@link AppDialogs} 作为宿主。
 */
"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

/** 确认弹窗选项。 */
export interface ConfirmDialogOptions {
  /** 标题(必填)。 */
  title: string;
  /** 正文说明。 */
  description?: string;
  /** 确认按钮文案,默认「确定」。 */
  confirmText?: string;
  /** 取消按钮文案,默认「取消」。 */
  cancelText?: string;
  /** 危险操作:确认按钮使用 destructive 样式。 */
  destructive?: boolean;
}

/** 输入弹窗选项。 */
export interface PromptDialogOptions {
  /** 标题(必填)。 */
  title: string;
  /** 输入框上方标签。 */
  label?: string;
  /** 输入框占位文本。 */
  placeholder?: string;
  /** 初始值,默认空。 */
  initialValue?: string;
  /** 确认按钮文案,默认「确定」。 */
  confirmText?: string;
  /** 取消按钮文案,默认「取消」。 */
  cancelText?: string;
}

/** 确认请求:选项加结果回调。 */
interface ConfirmRequest extends ConfirmDialogOptions {
  resolve: (ok: boolean) => void;
}

/** 输入请求:选项加结果回调(取消返回 null)。 */
interface PromptRequest extends PromptDialogOptions {
  resolve: (value: string | null) => void;
}

/** 弹窗宿主 store:请求保留到下一次打开,供退出动画期间继续渲染内容。 */
interface AppDialogsStore {
  /** 当前确认请求。 */
  confirmReq: ConfirmRequest | null;
  /** 确认弹窗是否打开。 */
  confirmOpen: boolean;
  /** 当前输入请求。 */
  promptReq: PromptRequest | null;
  /** 输入弹窗是否打开。 */
  promptOpen: boolean;
}

const useAppDialogsStore = create<AppDialogsStore>(() => ({
  confirmReq: null,
  confirmOpen: false,
  promptReq: null,
  promptOpen: false,
}));

/** 弹出确认框;同一时刻仅一个弹窗,新请求会以取消结算旧请求。 */
export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  const state = useAppDialogsStore.getState();
  state.confirmReq?.resolve(false);
  state.promptReq?.resolve(null);
  return new Promise((resolve) => {
    useAppDialogsStore.setState({
      confirmReq: { ...options, resolve },
      confirmOpen: true,
      promptReq: null,
      promptOpen: false,
    });
  });
}

/** 弹出输入框;确认返回输入值(可能为空串),取消或 ESC 返回 null。 */
export function promptDialog(options: PromptDialogOptions): Promise<string | null> {
  const state = useAppDialogsStore.getState();
  state.confirmReq?.resolve(false);
  state.promptReq?.resolve(null);
  return new Promise((resolve) => {
    useAppDialogsStore.setState({
      confirmReq: null,
      confirmOpen: false,
      promptReq: { ...options, resolve },
      promptOpen: true,
    });
  });
}

/** 结算确认请求并关闭(保留请求内容直到下一次打开)。 */
function settleConfirm(ok: boolean): void {
  const { confirmReq } = useAppDialogsStore.getState();
  useAppDialogsStore.setState({ confirmOpen: false });
  confirmReq?.resolve(ok);
}

/** 结算输入请求并关闭(取消传 null)。 */
function settlePrompt(value: string | null): void {
  const { promptReq } = useAppDialogsStore.getState();
  useAppDialogsStore.setState({ promptOpen: false });
  promptReq?.resolve(value);
}

/** 全局弹窗宿主:在应用壳挂载一次,渲染当前确认/输入请求。 */
export function AppDialogs() {
  const confirmReq = useAppDialogsStore((s) => s.confirmReq);
  const confirmOpen = useAppDialogsStore((s) => s.confirmOpen);
  const promptReq = useAppDialogsStore((s) => s.promptReq);
  const promptOpen = useAppDialogsStore((s) => s.promptOpen);
  const [promptValue, setPromptValue] = useState("");

  // 每次打开输入弹窗时重置为初始值。
  useEffect(() => {
    if (promptOpen) setPromptValue(promptReq?.initialValue ?? "");
  }, [promptOpen, promptReq]);

  return (
    <>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) settleConfirm(false);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmReq?.title ?? ""}</AlertDialogTitle>
            {confirmReq?.description && (
              <AlertDialogDescription>
                {confirmReq.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settleConfirm(false)}>
              {confirmReq?.cancelText ?? "取消"}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={confirmReq?.destructive ? "destructive" : "default"}
              onClick={() => settleConfirm(true)}
            >
              {confirmReq?.confirmText ?? "确定"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={promptOpen}
        onOpenChange={(open) => {
          if (!open) settlePrompt(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              settlePrompt(promptValue);
            }}
          >
            <DialogHeader>
              <DialogTitle>{promptReq?.title ?? ""}</DialogTitle>
              {promptReq?.label && (
                <DialogDescription render={<Label htmlFor="app-prompt-input" className="font-normal" />}>
                  {promptReq.label}
                </DialogDescription>
              )}
            </DialogHeader>
            <Input
              id="app-prompt-input"
              autoFocus
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              placeholder={promptReq?.placeholder}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => settlePrompt(null)}
              >
                {promptReq?.cancelText ?? "取消"}
              </Button>
              <Button type="submit">
                {promptReq?.confirmText ?? "确定"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

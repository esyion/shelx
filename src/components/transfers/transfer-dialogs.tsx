/**
 * 传输相关弹窗:chmod 九宫格(F7)。
 *
 * 传输冲突决策已迁路由:/transfers/[taskId]/conflict(原 TransferConflictDialog 浮层)。
 */
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useUiStore } from "@/stores/ui";

/** chmod 弹窗属性。 */
export interface ChmodDialogProps {
  /** 打开状态。 */
  open: boolean;
  /** 目标路径。 */
  path: string | null;
  /** 当前权限位(十进制)。 */
  mode: number;
  /** 会话 ID。 */
  sessionId: string;
  /** 关闭回调。 */
  onClose: () => void;
  /** 应用回调(完成刷新等)。 */
  onApplied: () => void;
}

/** chmod 九宫格弹窗(F7,PRD §6.4)。 */
export function ChmodDialog({
  open,
  path,
  mode,
  sessionId,
  onClose,
  onApplied,
}: ChmodDialogProps) {
  const toast = useUiStore((s) => s.toast);
  // 9 位勾选:owner r/w/x, group r/w/x, other r/w/x(高位→低位)
  const [bits, setBits] = useState<boolean[]>([
    (mode & 0o400) !== 0,
    (mode & 0o200) !== 0,
    (mode & 0o100) !== 0,
    (mode & 0o040) !== 0,
    (mode & 0o020) !== 0,
    (mode & 0o010) !== 0,
    (mode & 0o004) !== 0,
    (mode & 0o002) !== 0,
    (mode & 0o001) !== 0,
  ]);

  // 弹窗打开时重置为当前 mode
  const [prevOpen, setPrevOpen] = useState(false);
  if (open && !prevOpen) {
    setPrevOpen(true);
    setBits([
      (mode & 0o400) !== 0,
      (mode & 0o200) !== 0,
      (mode & 0o100) !== 0,
      (mode & 0o040) !== 0,
      (mode & 0o020) !== 0,
      (mode & 0o010) !== 0,
      (mode & 0o004) !== 0,
      (mode & 0o002) !== 0,
      (mode & 0o001) !== 0,
    ]);
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  const computed = bits.reduce((value, bit, index) => (bit ? value | (1 << (8 - index)) : value), 0);
  const octal = computed.toString(8).padStart(3, "0");

  const labels = ["读 r", "写 w", "执行 x"];
  const groups = ["所有者", "组", "其他"];

  /** 应用 chmod。 */
  const apply = async () => {
    if (!path) return;
    try {
      const { setRemotePermissions } = await import("@/app/api");
      await setRemotePermissions(sessionId, path, computed);
      toast(`权限已修改为 ${octal}`);
      onApplied();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "chmod 失败", "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>修改权限</DialogTitle>
        </DialogHeader>
        <p className="break-all text-xs text-muted-foreground">{path}</p>
        <div className="grid grid-cols-4 gap-1 text-center text-xs">
          <span />
          {labels.map((label) => (
            <Label key={label} className="text-center text-xs text-muted-foreground">
              {label}
            </Label>
          ))}
          {groups.map((group, rowIndex) => (
            <div key={group} className="contents">
              <Label className="text-right text-xs text-muted-foreground">{group}</Label>
              {labels.map((_, colIndex) => {
                const bitIndex = rowIndex * 3 + colIndex;
                return (
                  <label key={`${group}-${colIndex}`} className="flex items-center justify-center">
                    <Checkbox
                      checked={bits[bitIndex]}
                      onCheckedChange={(checked) =>
                        setBits((prev) =>
                          prev.map((b, i) => (i === bitIndex ? checked === true : b)),
                        )
                      }
                    />
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        <p className="text-center font-mono text-sm">
          {permissionString(computed)} ({octal})
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => void apply()}>应用</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 权限位 → `drwxr-xr-x` 字符串(不含类型位)。 */
function permissionString(mode: number): string {
  const groups = [
    [0o400, 0o200, 0o100],
    [0o040, 0o020, 0o010],
    [0o004, 0o002, 0o001],
  ];
  return groups
    .map((group) =>
      group.map((bit) => (mode & bit ? ["r", "w", "x"][group.indexOf(bit)] : "-")).join(""),
    )
    .join("");
}

/**
 * 历史对话语义搜索弹窗:按意思找对话,不用记原词(离线模型,数据不出本机)。
 *
 * 首次使用需下载离线模型(约 30 MB,联网一次),之后完全离线 —— 下载由用户
 * 点「准备」发起,不自动拉取;准备中持续可见进度,失败给出原因与重试,
 * 不留死状态(AGENTS.md §4.1.1)。就绪后输入即搜,点结果直接切到那个对话。
 */
"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { ConversationHitDto } from "@/types";
import { useConversationSearch } from "@/app/hooks/use-conversation-search";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { useAgentStore } from "@/stores/agent";

/** 搜索词长度上限(与后端校验同源,从源头拦下)。 */
const QUERY_MAX = 200;

/** 历史对话搜索弹窗属性。 */
export interface ConversationSearchDialogProps {
  /** 是否显示。 */
  open: boolean;
  /** 开关。 */
  onOpenChange: (open: boolean) => void;
}

/** 历史对话语义搜索(按意思匹配;点击结果切换到对应对话)。 */
export function ConversationSearchDialog({ open, onOpenChange }: ConversationSearchDialogProps) {
  const openThread = useAgentStore((state) => state.openThread);
  const { status, hits, searching, error, prepare, search, reset } = useConversationSearch(open);
  const [query, setQuery] = useState("");

  /** 关闭时清结果;打开时输入框聚焦由 Dialog 自带行为处理。 */
  useEffect(() => {
    if (!open) {
      reset();
      setQuery("");
    }
  }, [open, reset]);

  /** 点结果:切到那个对话并收起弹窗。 */
  function jump(hit: ConversationHitDto): void {
    onOpenChange(false);
    void openThread(hit.threadId);
  }

  const ready = status?.state === "ready";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>搜索历史对话</DialogTitle>
          <DialogDescription>
            按意思搜,不用记原词;用的是本机离线模型,内容不会外发。
          </DialogDescription>
        </DialogHeader>

        {/* 状态加载中 */}
        {!status && (
          <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Spinner data-icon="inline-start" />
            正在读取离线检索状态…
          </p>
        )}

        {/* 未准备:把"会发生什么"说清,下载由用户发起 */}
        {status?.state === "not_ready" && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>还没准备离线检索</EmptyTitle>
              <EmptyDescription>
                首次使用需要下载一个约 30 MB 的离线模型(需联网),之后搜索、语义记忆
                全在本机完成;不下载也不影响其他功能。
              </EmptyDescription>
            </EmptyHeader>
            <Button size="sm" onClick={() => void prepare()}>
              准备离线检索
            </Button>
          </Empty>
        )}

        {/* 准备中:持续可见,不装作完成 */}
        {status?.state === "preparing" && (
          <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Spinner data-icon="inline-start" />
            正在下载模型并整理历史对话,可能需要几分钟;窗口可以先留着。
          </p>
        )}

        {/* 失败:原因 + 重试,不留死状态 */}
        {status?.state === "failed" && (
          <Alert variant="destructive">
            <AlertDescription>
              {status.message ?? "准备失败了"}
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void prepare()}>
                重试
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* 就绪:输入即搜 */}
        {ready && (
          <div className="flex flex-col gap-3">
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void search(query);
              }}
            >
              <Input
                aria-label="搜索内容"
                placeholder="例:上次 nginx 连接数飙高怎么处理的"
                value={query}
                maxLength={QUERY_MAX}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button type="submit" size="sm" disabled={!query.trim() || searching}>
                {searching ? <Spinner data-icon="inline-start" /> : <Search data-icon="inline-start" />}
                搜索
              </Button>
            </form>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {hits !== null && hits.length === 0 && !searching && (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>没搜到相关对话</EmptyTitle>
                  <EmptyDescription>换个说法试试,比如用当时的问题或关键词。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}

            {hits !== null && hits.length > 0 && (
              <div className="max-h-[45vh] overflow-y-auto">
                <ItemGroup className="gap-2">
                  {hits.map((hit) => (
                    <Item
                      key={`${hit.threadId}:${hit.snippet}`}
                      size="xs"
                      variant="outline"
                      className="cursor-pointer"
                      onClick={() => jump(hit)}
                    >
                      <ItemContent>
                        <ItemTitle>{hit.title}</ItemTitle>
                        <ItemDescription className="line-clamp-2">{hit.snippet}</ItemDescription>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              </div>
            )}

            {hits === null && (
              <p className="px-1 text-xs text-muted-foreground">
                输入要找的内容,出现的就是意思相关的对话;点击直接打开。
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

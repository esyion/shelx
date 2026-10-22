/**
 * 「新增/编辑接入点」弹窗的表单(标题、字段区与页脚动作都在这里)。
 *
 * 表单用 zod + React Hook Form(schema 与草稿映射在 `profile-draft.ts`):
 * 字段级错误就地显示,提交时聚焦第一个错误控件。字段一律竖排
 * (label 在上、输入在下,shadcn Field 默认 vertical 朝向),说明跟在输入框下。
 * 「协议确认」不是可手拨的开关 —— 它只是「测试并确认协议」跑完后的结果状态
 * (AGENTS.md §4.1.1:不放假开关);密钥只写不回显。
 */
"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import type { ProtocolKind, TestProfileRequestDto, UpsertProfileRequestDto } from "@/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { PROTOCOL_DISPLAY } from "@/lib/agent-events";
import { useAgentStore } from "@/stores/agent";
import {
  buildProfileSchema,
  draftToRequest,
  draftToTestRequest,
  formatTokens,
  type ProfileFormValues,
} from "./profile-draft";

/** 数据层公开类型与映射(列表启停也用),保持模块单一出口。 */
export {
  blankDraft,
  draftFromProfile,
  draftToRequest,
  type ProfileFormValues,
} from "./profile-draft";

/** 弹窗内的异步动作,由页面接 store(表单不直接碰 IPC)。 */
export type ProfileFormActions = {
  /** 保存;成功返回 true,表单随之请求关闭弹窗。 */
  save: (request: UpsertProfileRequestDto) => Promise<boolean>;
  /** 对表单当前值直接探测(不落库);true = 支持要求的协议。 */
  probe: (request: TestProfileRequestDto) => Promise<boolean>;
};

/** 弹窗表单属性。 */
export type ProfileFormProps = {
  /** 初始值(新增空草稿或由已有配置填入);弹窗每次打开都按它重挂表单。 */
  initialValues: ProfileFormValues;
  /** 保存/探测进行中(两个动作共用,页脚按钮一并禁用)。 */
  busy: boolean;
  /** store 层错误原文(保存/探测失败的原因,弹窗内可见,不用固定文案吞错)。 */
  storeError: string | null;
  /** 异步动作。 */
  actions: ProfileFormActions;
  /** 关闭弹窗(取消或保存成功后由表单请求)。 */
  onClose: () => void;
};

/**
 * 渲染「新增/编辑接入点」弹窗的全部内容(标题、字段区与页脚动作)。
 *
 * 校验即时可见:改动过的字段就地亮错,保存按钮在整表合法前禁用并说明原因
 * (禁用原因与行内错误同出一份 schema,不会两套规则各说各话);
 * 提交时聚焦第一个错误控件。探测不跑整表校验 —— 它只要求模型名与密钥,
 * 其余字段交后端拦,两个动作的前置条件互不牵连。
 */
export function ProfileForm({
  initialValues,
  busy,
  storeError,
  actions,
  onClose,
}: ProfileFormProps) {
  /** 协议候选与 token 区间都来自后端枚举(AGENTS.md §5)。 */
  const protocols = useAgentStore((state) => state.enums.protocols);
  const limits = useAgentStore((state) => state.enums.profileLimits);
  const lookupModelWindow = useAgentStore((state) => state.lookupModelWindow);
  const modelWindows = useAgentStore((state) => state.modelWindows);

  const schema = useMemo(() => buildProfileSchema(limits), [limits]);
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });
  const { control, formState, getValues, handleSubmit, setFocus, setValue } =
    form;
  /** 订阅全表:模型名驱动目录提示,当前值驱动「为什么不能保存」。 */
  const values = form.watch();

  /** 契约区间没到位(进页首帧)前不开放动作,避免拿 0 当档位。 */
  const limitsReady = limits.contextWindow.max > 0;
  /** 全表按 schema 复算:保存按钮的禁用原因与字段行内错误同出一处。 */
  const issues = useMemo(() => {
    const result = schema.safeParse(values);
    return result.success ? [] : result.error.issues;
  }, [schema, values]);
  const issueMessage = (path: string) =>
    issues.find((issue) => issue.path[0] === path)?.message;
  const saveBlockReason = limitsReady
    ? issues[0]?.message
    : "模型配置还在加载,稍候再试";

  const verified = values.responsesVerified;
  const customEndpoint =
    values.protocol === "openai_responses" && values.baseUrl.trim().length > 0;
  const modelKey = values.model.trim().toLowerCase();
  /** `undefined` = 还没查过;`known === false` = 目录没有这条模型;否则是目录里的事实。 */
  const catalog = modelKey ? modelWindows[modelKey] : undefined;
  const windowHint =
    !modelKey || catalog === undefined
      ? "留空则用模型目录里的窗口;目录没有这条模型时必须手填。"
      : catalog?.contextWindow
        ? `目录里是 ${formatTokens(catalog.contextWindow)} tokens,留空就用这个数。`
        : "模型目录没有这条记录,窗口需要你填。";

  /** 校验并保存;成功关闭弹窗,失败把后端原因留在弹窗里(storeError)。 */
  const submit = handleSubmit(async (formValues) => {
    const saved = await actions.save(draftToRequest(formValues));
    if (saved) onClose();
  });

  /**
   * 直接对表单当前值探测(不落库);支持则「协议确认」翻亮,保存解锁。
   * 探测只要求模型名(密钥编辑态可回落已存的),不跑整表校验。
   */
  async function probe(): Promise<void> {
    const current = getValues();
    if (!current.model.trim()) {
      setFocus("model");
      return;
    }
    const supported = await actions.probe(draftToTestRequest(current));
    if (supported) {
      setValue("responsesVerified", true, { shouldValidate: true });
    }
  }

  /** 探测的前置:模型名必填;新建态还没有已存密钥可回落,必须先填。 */
  const probeBlockReason = !limitsReady
    ? "模型配置还在加载,稍候再试"
    : !values.model.trim()
      ? "先填模型名才能测试"
      : initialValues.id === null && !values.apiKey.trim()
        ? "新建接入点要先填 API 密钥才能测试"
        : null;

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>
          {initialValues.id ? "编辑接入点" : "新增接入点"}
        </DialogTitle>
        <DialogDescription>
          对话用哪一档模型由这里决定;对话中可在会话标题栏随时切换。
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className="gap-4">
        <Controller
          name="label"
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel htmlFor="profile-label">名称</FieldLabel>
              <Input
                {...field}
                id="profile-label"
                aria-invalid={Boolean(issueMessage("label"))}
                placeholder="例如「公司网关」"
                autoComplete="off"
              />
              {(fieldState.isDirty || formState.isSubmitted) && (
                <FieldError>{issueMessage("label")}</FieldError>
              )}
            </Field>
          )}
        />
        <Controller
          name="protocol"
          control={control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="profile-protocol">协议</FieldLabel>
              <NativeSelect
                id="profile-protocol"
                value={field.value}
                onChange={(event) =>
                  field.onChange(event.target.value as ProtocolKind)
                }
                onBlur={field.onBlur}
                name={field.name}
              >
                {protocols.map((protocol) => (
                  <NativeSelectOption key={protocol} value={protocol}>
                    {PROTOCOL_DISPLAY[protocol].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>
                只支持这两种新协议,旧协议没有选项。
              </FieldDescription>
            </Field>
          )}
        />
        <Controller
          name="model"
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel htmlFor="profile-model">模型名</FieldLabel>
              <Input
                {...field}
                id="profile-model"
                aria-invalid={Boolean(issueMessage("model"))}
                placeholder="例如 gpt-5.6"
                autoComplete="off"
                onBlur={() => {
                  field.onBlur();
                  void lookupModelWindow(field.value);
                }}
              />
              <FieldDescription>
                离开输入框时去模型目录查这一档的窗口。
              </FieldDescription>
              {(fieldState.isDirty || formState.isSubmitted) && (
                <FieldError>{issueMessage("model")}</FieldError>
              )}
            </Field>
          )}
        />
        <Controller
          name="contextWindow"
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel htmlFor="profile-window">上下文窗口</FieldLabel>
              <Input
                {...field}
                id="profile-window"
                inputMode="numeric"
                aria-invalid={Boolean(issueMessage("contextWindow"))}
                placeholder={
                  catalog?.contextWindow
                    ? formatTokens(catalog.contextWindow)
                    : "例如 1,000,000"
                }
              />
              <FieldDescription>{windowHint}</FieldDescription>
              {(fieldState.isDirty || formState.isSubmitted) && (
                <FieldError>{issueMessage("contextWindow")}</FieldError>
              )}
            </Field>
          )}
        />
        <Controller
          name="maxOutputTokens"
          control={control}
          render={({ field, fieldState }) => (
            <Field>
              <FieldLabel htmlFor="profile-output">单次回复上限</FieldLabel>
              <Input
                {...field}
                id="profile-output"
                inputMode="numeric"
                aria-invalid={Boolean(issueMessage("maxOutputTokens"))}
                placeholder={
                  catalog?.maxOutputTokens
                    ? formatTokens(catalog.maxOutputTokens)
                    : "例如 8,192"
                }
              />
              <FieldDescription>
                模型一次回复最多写多少 tokens;留空用目录值。
              </FieldDescription>
              {(fieldState.isDirty || formState.isSubmitted) && (
                <FieldError>{issueMessage("maxOutputTokens")}</FieldError>
              )}
            </Field>
          )}
        />
        <Controller
          name="apiKey"
          control={control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="profile-key">API 密钥</FieldLabel>
              <Input
                {...field}
                id="profile-key"
                type="password"
                placeholder={initialValues.id ? "留空表示不改动密钥" : "API 密钥"}
                autoComplete="new-password"
              />
              <FieldDescription>
                密钥只存系统安全存储,不会写进日志、备份或同步到别处。
              </FieldDescription>
            </Field>
          )}
        />
        <Controller
          name="baseUrl"
          control={control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="profile-base-url">自建接入点地址</FieldLabel>
              <Input
                {...field}
                id="profile-base-url"
                aria-invalid={Boolean(issueMessage("baseUrl"))}
                placeholder="留空用官方地址"
                autoComplete="off"
              />
              <FieldDescription>以 /v1 结尾,留空用官方地址。</FieldDescription>
              {customEndpoint && (
                <FieldDescription className="flex items-center gap-2">
                  <Badge variant={verified ? "secondary" : "outline"}>
                    {verified ? "已通过测试" : "未确认"}
                  </Badge>
                  {verified ? "自建端点已确认支持 Responses,可以保存。" : null}
                </FieldDescription>
              )}
              {customEndpoint && !verified && (
                <FieldError>{issueMessage("baseUrl")}</FieldError>
              )}
            </Field>
          )}
        />
        <Controller
          name="enabled"
          control={control}
          render={({ field }) => (
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="profile-enabled">启用该接入点</FieldLabel>
                <FieldDescription>停用后对话里选不到这个接入点。</FieldDescription>
              </FieldContent>
              <Switch
                id="profile-enabled"
                name={field.name}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            </Field>
          )}
        />
      </FieldGroup>
      {storeError && (
        <Alert variant="destructive">
          <AlertDescription>{storeError}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void probe()}
          disabled={busy || probeBlockReason !== null}
          title={probeBlockReason ?? undefined}
        >
          测试并确认协议
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={busy || saveBlockReason !== undefined}
          title={saveBlockReason ?? undefined}
        >
          {initialValues.id ? "保存修改" : "新增接入点"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * 接入点表单的数据层:zod schema、草稿映射与 token 读数。
 *
 * 校验区间从 IPC 契约的 `enums.profileLimits` 读(AGENTS.md §5:区间同源,
 * 前端不抄数字);跨字段规则与后端领域层一致:回复上限必须小于上下文窗口,
 * 自建 Responses 端点必须先通过「测试并确认协议」才能保存。
 * 窗口/上限在表单里保持文本态(空 = 用模型目录的值),提交时才转数字。
 */
import { z } from "zod";
import type {
  AgentProfile,
  ProfileLimitsDto,
  ProtocolKind,
  TestProfileRequestDto,
  UpsertProfileRequestDto,
} from "@/types";

/** 协议契约字面量:下拉候选与校验共用(取值以 gen 的 ProtocolKind 为准)。 */
export const PROTOCOL_LITERALS = [
  "openai_responses",
  "anthropic_messages",
] as const satisfies readonly ProtocolKind[];

/** 防漂移:后端新增协议时这里不再是 never[],编译失败提醒把候选补进上面。 */
const PROTOCOL_LITERALS_COVER_CONTRACT: never[] = [] as Exclude<
  ProtocolKind,
  (typeof PROTOCOL_LITERALS)[number]
>[];
void PROTOCOL_LITERALS_COVER_CONTRACT;

/**
 * 手填 token 的解析:允许千分位与空格;空串 = 未填(用模型目录的值)。
 *
 * @returns 数字;`null` 表示未填;`undefined` 表示填了但不是正整数。
 */
export function parseTokens(raw: string): number | null | undefined {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text.replace(/[_,\s]/g, ""));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** 千分位读数(目录带出的窗口是六位数,不给分隔符读不动)。 */
export function formatTokens(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/**
 * 表单 schema:区间参数来自 IPC 契约,不手抄数字;错误文案就地可读。
 */
export function buildProfileSchema(limits: ProfileLimitsDto) {
  /** 单个 token 字段:空串放行(用目录值),填了就按契约区间拦。 */
  const tokenField = (label: string, range: { min: number; max: number }) =>
    z.string().superRefine((value, ctx) => {
      const parsed = parseTokens(value);
      if (parsed === null) return;
      if (parsed === undefined || parsed < range.min || parsed > range.max) {
        ctx.addIssue({
          code: "custom",
          message: `${label}要填 ${formatTokens(range.min)}~${formatTokens(range.max)} 之间的整数(tokens)`,
        });
      }
    });
  return z
    .object({
      id: z.string().nullable(),
      label: z.string().trim().min(1, "先填名称"),
      protocol: z.enum(PROTOCOL_LITERALS),
      model: z.string().trim().min(1, "先填模型名"),
      baseUrl: z.string(),
      apiKey: z.string(),
      enabled: z.boolean(),
      responsesVerified: z.boolean(),
      contextWindow: tokenField("上下文窗口", limits.contextWindow),
      maxOutputTokens: tokenField("单次回复上限", limits.maxOutputTokens),
    })
    .superRefine((values, ctx) => {
      const window = parseTokens(values.contextWindow);
      const output = parseTokens(values.maxOutputTokens);
      if (
        window !== null &&
        window !== undefined &&
        output !== null &&
        output !== undefined &&
        output >= window
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["maxOutputTokens"],
          message: "单次回复上限必须小于上下文窗口,否则请求没有留给历史的位置",
        });
      }
      if (
        values.protocol === "openai_responses" &&
        values.baseUrl.trim().length > 0 &&
        !values.responsesVerified
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["baseUrl"],
          message:
            "这是自建地址:先点「测试并确认协议」,确认它支持 Responses 才能保存",
        });
      }
    });
}

/** 表单值(窗口/上限保持文本态,空 = 用模型目录的值;提交时才转数字)。 */
export type ProfileFormValues = z.infer<ReturnType<typeof buildProfileSchema>>;

/** 空草稿(新增接入点)。 */
export function blankDraft(): ProfileFormValues {
  return {
    id: null,
    label: "",
    protocol: "openai_responses",
    model: "",
    baseUrl: "",
    responsesVerified: false,
    apiKey: "",
    enabled: true,
    contextWindow: "",
    maxOutputTokens: "",
  };
}

/** 由已有配置填草稿(密钥留空表示不改动)。 */
export function draftFromProfile(profile: AgentProfile): ProfileFormValues {
  return {
    id: profile.id,
    label: profile.label,
    protocol: profile.protocol,
    model: profile.model,
    baseUrl: profile.baseUrl ?? "",
    responsesVerified: profile.responsesVerified,
    apiKey: "",
    enabled: profile.enabled,
    contextWindow: profile.contextWindow == null ? "" : String(profile.contextWindow),
    maxOutputTokens:
      profile.maxOutputTokens == null ? "" : String(profile.maxOutputTokens),
  };
}

/** 表单值 → 保存请求(地址为空表示用官方地址;密钥为空表示不改动)。 */
export function draftToRequest(values: ProfileFormValues): UpsertProfileRequestDto {
  const baseUrl = values.baseUrl.trim();
  const apiKey = values.apiKey.trim();
  return {
    id: values.id,
    label: values.label.trim(),
    protocol: values.protocol,
    model: values.model.trim(),
    baseUrl: baseUrl ? baseUrl : null,
    responsesVerified: values.responsesVerified,
    apiKey: apiKey ? apiKey : null,
    enabled: values.enabled,
    contextWindow: parseTokens(values.contextWindow) ?? null,
    maxOutputTokens: parseTokens(values.maxOutputTokens) ?? null,
  };
}

/** 表单值 → 探测请求(不落库;密钥留空时后端回落已保存的密钥)。 */
export function draftToTestRequest(values: ProfileFormValues): TestProfileRequestDto {
  const baseUrl = values.baseUrl.trim();
  const apiKey = values.apiKey.trim();
  return {
    id: values.id,
    protocol: values.protocol,
    model: values.model.trim(),
    baseUrl: baseUrl ? baseUrl : null,
    apiKey: apiKey ? apiKey : null,
  };
}

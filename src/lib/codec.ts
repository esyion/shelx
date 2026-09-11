/**
 * 终端编码编解码(PRD §6.3、设计文档 §7.7-1)。
 *
 * - 解码:原生 `TextDecoder`(Encoding Standard 含 GBK,WebView2/WKWebView/WebKit 均实现),
 *   以 stream 模式保持跨块边界正确;切换编码即重置解码器状态,不清屏。
 * - 编码:`TextEncoder` 仅支持 UTF-8;GBK 编码方向由 WASM 编码器提供
 *   (src-tauri/crates/shelx-codec 经 wasm-pack 构建至 src/lib/codec-wasm);
 *   WASM 未初始化完成时回退 UTF-8 并仅告警一次(初始化失败持续降级)。
 */

/** 解码器接口:stream 模式,可重置。 */
export class StreamDecoder {
  private decoder: TextDecoder;

  /** 以目标编码构造。 */
  constructor(encoding: "utf-8" | "gbk") {
    this.decoder = new TextDecoder(encoding);
  }

  /** 解码一批字节;跨块非法序列按替换符呈现,不抛出。 */
  decode(bytes: Uint8Array): string {
    return this.decoder.decode(bytes, { stream: true });
  }

  /** 编码切换时重置状态(丢弃残缺序列,后续字节按新编码解释)。 */
  reset(encoding: "utf-8" | "gbk"): void {
    this.decoder = new TextDecoder(encoding);
  }
}

/** GBK 编码告警是否已提示过。 */
let gbkFallbackWarned = false;

/** WASM GBK 编码函数;初始化成功前为 null。 */
let gbkEncoder: ((text: string) => Uint8Array) | null = null;

/**
 * 初始化 WASM GBK 编码器(幂等)。
 * 在应用启动或首次打开 GBK 连接时调用;失败保持 UTF-8 降级。
 */
export async function initGbkEncoder(): Promise<void> {
  if (gbkEncoder) return;
  try {
    const wasm = await import("@/lib/codec-wasm/shelx_codec");
    await wasm.default();
    gbkEncoder = wasm.encode_gbk;
  } catch (err) {
    console.warn("[shelx] GBK WASM 编码器初始化失败,输入按 UTF-8 发送:", err);
  }
}

/**
 * 用户输入 → 字节。UTF-8 直转;GBK 走 WASM 编码器,
 * 未就绪/失败时回退 UTF-8 并告警一次(ASCII 输入两种编码字节一致,不受影响)。
 */
export function encodeInput(
  text: string,
  encoding: "utf-8" | "gbk",
): Uint8Array {
  if (encoding === "utf-8") {
    return new TextEncoder().encode(text);
  }
  if (gbkEncoder) {
    return gbkEncoder(text);
  }
  if (!gbkFallbackWarned) {
    gbkFallbackWarned = true;
    console.warn("[shelx] GBK 编码器未就绪,输入暂以 UTF-8 发送");
  }
  return new TextEncoder().encode(text);
}

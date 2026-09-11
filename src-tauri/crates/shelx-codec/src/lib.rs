//! shelx 终端输入编码器(F8,设计文档 §7.7-1)。
//!
//! 终端数据面是字节流:解码由前端原生 `TextDecoder`(含 GBK)承担;
//! 编码方向 `TextEncoder` 仅支持 UTF-8,本 crate 以 WASM 提供 GBK 编码,
//! 供前端把用户输入转为 GBK 字节发往老服务器。

use wasm_bindgen::prelude::*;

/// 把文本编码为 GBK 字节。
#[wasm_bindgen]
pub fn encode_gbk(text: &str) -> Vec<u8> {
    let (bytes, _, _) = encoding_rs::GBK.encode(text);
    bytes.into_owned()
}

/// 把文本编码为 UTF-8 字节(与 TextEncoder 等价,保留以便对称测试)。
#[wasm_bindgen]
pub fn encode_utf8(text: &str) -> Vec<u8> {
    let (bytes, _, _) = encoding_rs::UTF_8.encode(text);
    bytes.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ASCII 与中文 round-trip:GBK 编码后再解码还原。
    #[test]
    fn gbk_round_trip() {
        let text = "部署脚本 deploy.sh 中文输出";
        let encoded = encode_gbk(text);
        let (decoded, _, _) = encoding_rs::GBK.decode(&encoded);
        assert_eq!(decoded, text);
    }

    /// ASCII 在 GBK 下与 UTF-8 字节一致(单字节区)。
    #[test]
    fn ascii_matches_utf8() {
        assert_eq!(encode_gbk("ls -la\r"), encode_utf8("ls -la\r"));
    }
}

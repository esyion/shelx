//! Tavily 联网搜索适配器([`WebSearch`] 端口的唯一实现,AGENTS.md §4.5)。
//!
//! 走 rig 的 `http_client` 传输端口(与 LLM provider 同一传输栈,不另引 HTTP 依赖);
//! 报文形态见 Tavily 文档 `POST https://api.tavily.com/search`。密钥只出现在请求头,
//! 错误消息不含密钥(AGENTS.md §7)。

use std::time::Duration;

use rig::http_client::{DynHttpClient, Error as HttpError, HttpClientExt, Request, ReqwestClient};

use crate::application::agent::types::{WebSearch, WebSearchFault, WebSearchHit};

/// 搜索端点(官方固定地址,本项目不提供自定义端点)。
const SEARCH_URL: &str = "https://api.tavily.com/search";
/// 单次搜索整体超时(连接 + 响应体读取)。
const SEARCH_TIMEOUT: Duration = Duration::from_secs(20);

/// Tavily 客户端。
#[derive(Clone)]
pub struct TavilySearch {
    http: DynHttpClient,
}

impl TavilySearch {
    /// 进程级共享传输。
    #[must_use]
    pub fn shared() -> Self {
        Self {
            http: DynHttpClient::new(ReqwestClient::default()),
        }
    }

    /// 以给定传输构造(报文测试注入假传输用)。
    #[must_use]
    pub fn with_client(http: DynHttpClient) -> Self {
        Self { http }
    }
}

/// Tavily 响应里本项目消费的字段(其余忽略;字段全部可缺省,坏行不炸整体)。
#[derive(serde::Deserialize)]
struct TavilyResponse {
    #[serde(default)]
    results: Vec<TavilyHit>,
}

/// 单条命中。
#[derive(serde::Deserialize)]
struct TavilyHit {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    content: String,
}

#[async_trait::async_trait]
impl WebSearch for TavilySearch {
    async fn search(
        &self,
        api_key: &str,
        query: &str,
        max_results: u8,
    ) -> Result<Vec<WebSearchHit>, WebSearchFault> {
        let body = serde_json::json!({
            "query": query,
            "max_results": max_results,
            "search_depth": "basic",
        });
        let bytes = serde_json::to_vec(&body)
            .map_err(|err| WebSearchFault(format!("请求组装失败:{err}")))?;
        let request = Request::post(SEARCH_URL)
            .header("authorization", format!("Bearer {api_key}"))
            .header("content-type", "application/json")
            .body(bytes)
            .map_err(|err| WebSearchFault(format!("请求组装失败:{err}")))?;
        // 超时罩住"发送 + 读体"整体:只罩一半会出现请求已发出、读体悬死的状态。
        let fetch = async {
            let response = self
                .http
                .send::<Vec<u8>, Vec<u8>>(request)
                .await
                .map_err(classify)?;
            response.into_body().await.map_err(classify)
        };
        let payload = tokio::time::timeout(SEARCH_TIMEOUT, fetch)
            .await
            .map_err(|_| WebSearchFault("搜索超时(20 秒),请稍后再试".into()))??;
        let parsed: TavilyResponse = serde_json::from_slice(&payload)
            .map_err(|err| WebSearchFault(format!("响应解析失败:{err}")))?;
        Ok(parsed
            .results
            .into_iter()
            .map(|hit| WebSearchHit {
                title: hit.title,
                url: hit.url,
                content: hit.content,
            })
            .collect())
    }
}

/// 传输错误 → 面向用户的分类消息(原文随附,不吞错;不含密钥)。
fn classify(err: HttpError) -> WebSearchFault {
    if let Some(status) = err.non_success_status() {
        return match status.as_u16() {
            401 | 403 => WebSearchFault("密钥被 Tavily 拒绝,请检查后重新保存".into()),
            429 => WebSearchFault("搜索过于频繁(Tavily 限流),稍后再试".into()),
            432 | 433 => WebSearchFault("Tavily 额度或套餐限额已用尽,请到官网查看".into()),
            code => {
                let detail = err.non_success_body().unwrap_or_default();
                WebSearchFault(format!("Tavily 返回 HTTP {code}:{detail}"))
            }
        };
    }
    WebSearchFault(format!("网络请求失败:{err}"))
}

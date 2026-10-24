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

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use rig::http_client::{
        Bytes, Error, HeaderMap, HttpClientExt, LazyBody, MultipartForm, Response, StatusCode,
        StreamingResponse,
    };

    use super::*;

    /// 记录请求报文并按脚本回放的假传输(绝不发网络请求)。
    #[derive(Clone)]
    struct ScriptedTransport {
        seen: Arc<Mutex<Vec<Recorded>>>,
        reply: Arc<Reply>,
    }

    /// 一笔已记录的请求事实。
    #[derive(Clone)]
    struct Recorded {
        path: String,
        authorization: Option<String>,
        body: Vec<u8>,
    }

    /// 回放脚本:成功体或错误。
    enum Reply {
        Body(Vec<u8>),
        Fail(StatusCode),
    }

    impl ScriptedTransport {
        /// 构造成功回放。
        fn with_body(body: &str) -> Self {
            Self {
                seen: Arc::new(Mutex::new(Vec::new())),
                reply: Arc::new(Reply::Body(body.as_bytes().to_vec())),
            }
        }

        /// 构造失败回放。
        fn with_status(status: StatusCode) -> Self {
            Self {
                seen: Arc::new(Mutex::new(Vec::new())),
                reply: Arc::new(Reply::Fail(status)),
            }
        }

        /// 取已记录的请求快照。
        fn take(&self) -> Vec<Recorded> {
            std::mem::take(&mut *self.seen.lock().expect("报文记录锁"))
        }
    }

    /// 回放体:把脚本字节包成惰性响应体(与真实传输同一形状)。
    fn lazy_body<U: From<Bytes> + Send + 'static>(bytes: Vec<u8>) -> LazyBody<U> {
        Box::pin(async move { Ok(U::from(Bytes::from(bytes))) })
    }

    impl HttpClientExt for ScriptedTransport {
        fn send<T, U>(
            &self,
            req: Request<T>,
        ) -> impl std::future::Future<Output = Result<Response<LazyBody<U>>>> + Send + 'static
        where
            T: Into<Bytes>,
            T: Send,
            U: From<Bytes>,
            U: Send + 'static,
        {
            let authorization = req
                .headers()
                .get("authorization")
                .and_then(|value| value.to_str().ok().map(str::to_owned));
            let path = req.uri().path().to_owned();
            let body = Vec::from(Into::<Bytes>::into(req.into_parts().1));
            self.seen.lock().expect("报文记录锁").push(Recorded {
                path,
                authorization,
                body,
            });
            let reply = Arc::clone(&self.reply);
            async move {
                match &*reply {
                    Reply::Body(bytes) => Response::builder()
                        .status(StatusCode::OK)
                        .body(lazy_body(bytes.clone()))
                        .map_err(Error::Protocol),
                    Reply::Fail(status) => Err(Error::InvalidStatusCodeWithDetails {
                        status: *status,
                        body: "quota exceeded".into(),
                        headers: HeaderMap::new(),
                    }),
                }
            }
        }

        // 手写 Future 返回:trait 要求 `+ Send + 'static`,`async fn` 形态满足不了该生命周期。
        #[allow(clippy::manual_async_fn)]
        fn send_multipart<U>(
            &self,
            _req: Request<MultipartForm>,
        ) -> impl std::future::Future<Output = Result<Response<LazyBody<U>>>> + Send + 'static
        where
            U: From<Bytes>,
            U: Send + 'static,
        {
            async { Err(Error::Instance("multipart 不在搜索路径上".into())) }
        }

        #[allow(clippy::manual_async_fn)]
        fn send_streaming<T>(
            &self,
            _req: Request<T>,
        ) -> impl std::future::Future<Output = Result<StreamingResponse>> + Send
        where
            T: Into<Bytes> + Send,
        {
            async { Err(Error::Instance("流式不在搜索路径上".into())) }
        }
    }

    /// `Result` 别名与 rig 传输口径一致。
    type Result<T> = std::result::Result<T, Error>;

    /// 报文形态:Bearer 头、JSON 体、固定端点路径。
    #[tokio::test]
    async fn request_carries_bearer_key_and_json_body() {
        let transport = ScriptedTransport::with_body(
            r#"{"results":[{"title":"t","url":"https://a","content":"c"}]}"#,
        );
        let tavily = TavilySearch::with_client(DynHttpClient::new(transport.clone()));
        let hits = tavily.search("tvly-test", "nginx 版本", 3).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].url, "https://a");
        let seen = transport.take();
        assert_eq!(seen.len(), 1, "只发一笔请求");
        assert_eq!(seen[0].path, "/search");
        assert_eq!(seen[0].authorization.as_deref(), Some("Bearer tvly-test"));
        let body: serde_json::Value = serde_json::from_slice(&seen[0].body).unwrap();
        assert_eq!(body["query"], "nginx 版本");
        assert_eq!(body["max_results"], 3);
        assert_eq!(body["search_depth"], "basic");
    }

    /// 错误分类:401 说密钥、额度码说套餐、其余带原文。
    #[tokio::test]
    async fn errors_are_classified_for_humans() {
        let transport = ScriptedTransport::with_status(StatusCode::UNAUTHORIZED);
        let tavily = TavilySearch::with_client(DynHttpClient::new(transport));
        let err = tavily.search("tvly-bad", "q", 1).await.unwrap_err();
        assert!(err.to_string().contains("密钥被 Tavily 拒绝"));

        let transport = ScriptedTransport::with_status(StatusCode::TOO_MANY_REQUESTS);
        let tavily = TavilySearch::with_client(DynHttpClient::new(transport));
        let err = tavily.search("tvly-x", "q", 1).await.unwrap_err();
        assert!(err.to_string().contains("限流"));

        // 432/433 是 Tavily 的额度码,不在 http 常量表里,用 from_u16 构造。
        let transport =
            ScriptedTransport::with_status(StatusCode::from_u16(432).expect("432 可构造"));
        let tavily = TavilySearch::with_client(DynHttpClient::new(transport));
        let err = tavily.search("tvly-x", "q", 1).await.unwrap_err();
        assert!(err.to_string().contains("额度"));

        let transport = ScriptedTransport::with_status(StatusCode::BAD_REQUEST);
        let tavily = TavilySearch::with_client(DynHttpClient::new(transport));
        let err = tavily.search("tvly-x", "q", 1).await.unwrap_err();
        assert!(err.to_string().contains("HTTP 400"));
        assert!(err.to_string().contains("quota exceeded"), "错误原文要随附");
    }

    /// 响应缺字段或为空数组都不算失败(坏行不炸整体)。
    #[tokio::test]
    async fn missing_fields_default_to_empty() {
        let transport = ScriptedTransport::with_body(r#"{"results":[]}"#);
        let tavily = TavilySearch::with_client(DynHttpClient::new(transport.clone()));
        assert!(tavily.search("tvly-t", "q", 1).await.unwrap().is_empty());

        let transport = ScriptedTransport::with_body("{}");
        let tavily = TavilySearch::with_client(DynHttpClient::new(transport));
        assert!(tavily.search("tvly-t", "q", 1).await.unwrap().is_empty());
    }
}

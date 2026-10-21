//! 报文级协议守卫测试(docs/AGENT_DESIGN.md §4.2 守卫 3)。
//!
//! 这是"禁止旧协议"最硬的一道断言:不看配置,只看真正发出去的 HTTP 请求路径。
//! 任何人把方言默认改回 Chat Completions、或升 rig 后路由漂移,这里都会先红。

use std::sync::{Arc, Mutex};

use rig::completion::CompletionRequest;
use rig::http_client::{
    Bytes, Error, HeaderMap, HttpClientExt, LazyBody, MultipartForm, Request, Response,
    StreamingResponse,
};
use rig::providers::anthropic::AnthropicConfig;
use rig::providers::openai::{OpenAIConfig, Route};

use super::provider;
use crate::domain::agent::{ModelProfile, ProfileId, ProtocolKind};

/// 只记录路径、绝不发出网络请求的假传输。
#[derive(Clone, Default)]
struct RecordingTransport {
    paths: Arc<Mutex<Vec<String>>>,
}

impl RecordingTransport {
    /// 记录请求路径后返回一个必然失败的响应,让调用尽快收敛。
    fn record<T>(&self, req: &Request<T>) {
        self.paths
            .lock()
            .expect("路径记录锁")
            .push(req.uri().path().to_owned());
    }

    /// 已记录的路径快照。
    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.paths.lock().expect("路径记录锁"))
    }

    /// 统一的失败返回(守卫只关心路径,不关心响应体)。
    #[allow(clippy::result_large_err)]
    fn abort<T>() -> Result<T> {
        Err(Error::InvalidStatusCodeWithDetails {
            status: http_status(),
            body: "protocol guard: no network".into(),
            headers: HeaderMap::new(),
        })
    }
}

/// 一个用于终止调用的状态码。
fn http_status() -> rig::http_client::StatusCode {
    rig::http_client::StatusCode::IM_A_TEAPOT
}

/// `Result` 别名与 rig 保持一致(错误统一走 `http_client::Error`)。
type Result<T> = std::result::Result<T, Error>;

impl HttpClientExt for RecordingTransport {
    fn send<T, U>(
        &self,
        req: Request<T>,
    ) -> impl std::future::Future<Output = Result<Response<LazyBody<U>>>> + Send + 'static
    where
        T: Into<Bytes> + Send,
        U: From<Bytes> + Send + 'static,
    {
        self.record(&req);
        async { Self::abort() }
    }

    fn send_multipart<U>(
        &self,
        req: Request<MultipartForm>,
    ) -> impl std::future::Future<Output = Result<Response<LazyBody<U>>>> + Send + 'static
    where
        U: From<Bytes> + Send + 'static,
    {
        self.record(&req);
        async { Self::abort() }
    }

    fn send_streaming<T>(
        &self,
        req: Request<T>,
    ) -> impl std::future::Future<Output = Result<StreamingResponse>> + Send
    where
        T: Into<Bytes> + Send,
    {
        self.record(&req);
        async { Self::abort::<StreamingResponse>() }
    }
}

/// 构造 profile。
fn profile(protocol: ProtocolKind, base_url: Option<&str>) -> ModelProfile {
    ModelProfile::new(
        ProfileId::new("p-guard").expect("非空"),
        "守卫".into(),
        protocol,
        "some-model".into(),
        base_url.map(str::to_owned),
        true,
    )
    .expect("守卫用配置合法")
}

/// OpenAI 侧无论官方端点还是自建网关,实际请求都必须打到 `/responses`。
#[tokio::test]
async fn openai_sends_only_to_responses() {
    for base in [None, Some("https://gateway.example/v1")] {
        let transport = RecordingTransport::default();
        let client = OpenAIConfig::new("sk-guard")
            .with_route(provider::enforced_openai_route())
            .with_base_url(base.unwrap_or("https://api.openai.com/v1"))
            .connect(transport.clone());
        let model = client.completion("some-model");
        // 结果必然失败(假传输主动终止),守卫只断言路径。
        let _ = model
            .call(CompletionRequest::new("ping").max_tokens(16u64))
            .await;
        let paths = transport.take();
        assert!(!paths.is_empty(), "{base:?} 未产生任何请求");
        assert!(
            paths.iter().all(|path| path.ends_with("/responses")),
            "出现旧协议路径:{paths:?}"
        );
        assert!(
            !paths.iter().any(|path| path.contains("/chat/completions")),
            "禁止 Chat Completions:{paths:?}"
        );
    }
}

/// 旧协议只有在被显式选择时才会出现:证明"强制 Responses"这道动作是必要的。
#[tokio::test]
async fn legacy_path_requires_explicit_choice() {
    let transport = RecordingTransport::default();
    let client = OpenAIConfig::new("sk-guard")
        .with_route(Route::Chat)
        .with_base_url("https://gateway.example/v1")
        .connect(transport.clone());
    let _ = client
        .completion("some-model")
        .call(CompletionRequest::new("ping").max_tokens(16u64))
        .await;
    let paths = transport.take();
    assert!(
        paths.iter().all(|path| path.contains("/chat/completions")),
        "显式选 Chat 才应该走旧路径,实测:{paths:?}"
    );
    assert_eq!(
        OpenAIConfig::new("sk")
            .with_route(Route::Responses)
            .completion_route(),
        Route::Responses
    );
}

/// Anthropic 侧实际请求必须打到 `/v1/messages`。
#[tokio::test]
async fn anthropic_sends_only_to_messages() {
    for base in [None, Some("https://gateway.example/v1")] {
        let transport = RecordingTransport::default();
        let mut config = AnthropicConfig::new("sk-ant-guard");
        if let Some(url) = base {
            config = config.with_base_url(url);
        }
        let client = config.connect(transport.clone());
        let call = client
            .completion("some-model")
            .call(CompletionRequest::new("ping").max_tokens(16u64))
            .await;
        let failure = call
            .err()
            .map(|err| err.to_string())
            .unwrap_or_else(|| "无错误".into());
        let paths = transport.take();
        assert!(!paths.is_empty(), "{base:?} 未产生任何请求:{failure}");
        assert!(
            paths.iter().all(|path| path.ends_with("/v1/messages")),
            "出现非 Messages 路径:{paths:?}"
        );
    }
}

/// 防腐层的 `expected_path` 口径必须与实际报文一致(否则文档与实现会说谎)。
#[tokio::test]
async fn expected_path_matches_wire() {
    let transport = RecordingTransport::default();
    let client = OpenAIConfig::new("k")
        .with_route(Route::Responses)
        .connect(transport.clone());
    let _ = client
        .completion("m")
        .call(CompletionRequest::new("ping").max_tokens(16u64))
        .await;
    let path = provider::expected_path(ProtocolKind::OpenAiResponses);
    assert!(transport.take().iter().any(|seen| seen.ends_with(path)));

    let transport = RecordingTransport::default();
    let _ = AnthropicConfig::new("k")
        .connect(transport.clone())
        .completion("m")
        .call(CompletionRequest::new("ping").max_tokens(16u64))
        .await;
    let path = provider::expected_path(ProtocolKind::AnthropicMessages);
    assert!(transport.take().iter().any(|seen| seen.ends_with(path)));
    let _ = profile(ProtocolKind::OpenAiResponses, None);
}

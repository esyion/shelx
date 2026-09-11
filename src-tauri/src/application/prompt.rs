//! PromptBroker:键盘交互与主机指纹确认的请求/应答桥(S1 spike 结论的落地,设计文档 §5.3.1)。
//!
//! 流向:后端发起请求 → 事件端口通知前端 → `respond_*` 命令送达应答 →
//! oneshot 唤醒等待方;超时视为用户未响应(指纹确认按拒绝处理)。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::oneshot;

use super::ports::{AuthPromptRequest, HostKeyConfirmRequest, PromptSpec, SessionEventSink};

/// 等待用户应答的默认时长(设计文档 §5.3.1:120 秒)。
pub const DEFAULT_PROMPT_TIMEOUT: Duration = Duration::from_secs(120);

/// 桥接错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PromptError {
    /// 等待应答超时。
    #[error("等待用户输入超时")]
    Timeout,
    /// 请求 ID 不存在或已被应答。
    #[error("请求不存在或已失效")]
    UnknownRequest,
    /// 等待方已放弃(连接被取消)。
    #[error("等待方已取消")]
    Abandoned,
}

/// 单个未决请求的应答载荷。
#[derive(Debug, Clone)]
enum PromptAnswer {
    /// 键盘交互的逐条回答。
    Auth(Vec<String>),
    /// 指纹确认结论。
    Hostkey(bool),
}

/// 请求/应答桥;线程安全,可被传输层(await)与 command 层(respond)并发使用。
pub struct PromptBroker {
    sink: Arc<dyn SessionEventSink>,
    pending: Mutex<HashMap<String, oneshot::Sender<PromptAnswer>>>,
    timeout: Duration,
}

impl PromptBroker {
    /// 以默认 120 秒超时构建。
    pub fn new(sink: Arc<dyn SessionEventSink>) -> Self {
        Self::with_timeout(sink, DEFAULT_PROMPT_TIMEOUT)
    }

    /// 以自定义超时构建(测试注入用)。
    pub fn with_timeout(sink: Arc<dyn SessionEventSink>, timeout: Duration) -> Self {
        Self {
            sink,
            pending: Mutex::new(HashMap::new()),
            timeout,
        }
    }

    /// 注册未决请求,返回应答接收端。
    fn register(&self, request_id: String) -> oneshot::Receiver<PromptAnswer> {
        let (sender, receiver) = oneshot::channel();
        self.pending
            .lock()
            .expect("prompt 锁")
            .insert(request_id, sender);
        receiver
    }

    /// 等待应答(带超时);完成后清理未决表。
    async fn wait(
        &self,
        request_id: &str,
        receiver: oneshot::Receiver<PromptAnswer>,
    ) -> Result<PromptAnswer, PromptError> {
        let answer = match tokio::time::timeout(self.timeout, receiver).await {
            Ok(result) => result.map_err(|_| PromptError::Abandoned)?,
            Err(_) => {
                tracing::warn!(request_id, "用户应答超时");
                // 超时必须清理未决表,否则请求 ID 永久占用。
                self.pending.lock().expect("prompt 锁").remove(request_id);
                return Err(PromptError::Timeout);
            }
        };
        self.pending.lock().expect("prompt 锁").remove(request_id);
        Ok(answer)
    }

    /// 发起键盘交互并等待逐条回答(S1:russh 0.63 拉取式循环的一环)。
    pub async fn ask_auth(
        &self,
        name: &str,
        instructions: Option<String>,
        prompts: Vec<PromptSpec>,
    ) -> Result<Vec<String>, PromptError> {
        let request_id = uuid::Uuid::new_v4().to_string();
        // 必须先注册再发事件:应答方可能在事件发出的瞬间同步回填,
        // 后注册会让早到的应答落空(冒烟测试暴露过的竞态)。
        let receiver = self.register(request_id.clone());
        self.sink.auth_prompt(&AuthPromptRequest {
            request_id: request_id.clone(),
            name: name.to_owned(),
            instructions,
            prompts,
        });
        match self.wait(&request_id, receiver).await? {
            PromptAnswer::Auth(answers) => Ok(answers),
            PromptAnswer::Hostkey(_) => Err(PromptError::UnknownRequest),
        }
    }

    /// 发起主机指纹确认并等待结论(首次连接 TOFU)。
    pub async fn ask_hostkey(
        &self,
        host: &str,
        port: u16,
        algorithm: &str,
        fingerprint: &str,
    ) -> Result<bool, PromptError> {
        let request_id = uuid::Uuid::new_v4().to_string();
        // 同 ask_auth:先注册后发事件,避免早到的应答落空。
        let receiver = self.register(request_id.clone());
        self.sink.hostkey_confirm(&HostKeyConfirmRequest {
            request_id: request_id.clone(),
            host: host.to_owned(),
            port,
            algorithm: algorithm.to_owned(),
            fingerprint: fingerprint.to_owned(),
        });
        match self.wait(&request_id, receiver).await? {
            PromptAnswer::Hostkey(accepted) => Ok(accepted),
            PromptAnswer::Auth(_) => Err(PromptError::UnknownRequest),
        }
    }

    /// 送达键盘交互应答(`respond_auth_prompt` 命令调用)。
    pub fn respond_auth(&self, request_id: &str, answers: Vec<String>) -> Result<(), PromptError> {
        self.respond(request_id, PromptAnswer::Auth(answers))
    }

    /// 送达指纹确认应答(`respond_hostkey_confirm` 命令调用)。
    pub fn respond_hostkey(&self, request_id: &str, accepted: bool) -> Result<(), PromptError> {
        self.respond(request_id, PromptAnswer::Hostkey(accepted))
    }

    /// 完成未决请求。
    fn respond(&self, request_id: &str, answer: PromptAnswer) -> Result<(), PromptError> {
        let sender = self
            .pending
            .lock()
            .expect("prompt 锁")
            .remove(request_id)
            .ok_or(PromptError::UnknownRequest)?;
        sender.send(answer).map_err(|_| PromptError::Abandoned)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    /// 捕获事件并允许测试侧应答的 sink。
    /// 发送结果被忽略:接收端可能已放弃(如超时用例),不应视为 sink 错误。
    struct CapturingSink {
        auth: mpsc::UnboundedSender<AuthPromptRequest>,
        hostkey: mpsc::UnboundedSender<HostKeyConfirmRequest>,
    }

    impl SessionEventSink for CapturingSink {
        fn auth_prompt(&self, request: &AuthPromptRequest) {
            let _ = self.auth.send(request.clone());
        }
        fn hostkey_confirm(&self, request: &HostKeyConfirmRequest) {
            let _ = self.hostkey.send(request.clone());
        }
        fn status_changed(&self, _event: &crate::application::ports::SessionStatusEvent) {}
    }

    /// 键盘交互:请求事件发出 → 测试侧应答 → 等待方拿到逐条答案。
    #[tokio::test]
    async fn auth_prompt_round_trip() {
        let (tx, mut rx) = mpsc::unbounded_channel::<AuthPromptRequest>();
        let broker = Arc::new(PromptBroker::with_timeout(
            Arc::new(CapturingSink {
                auth: tx,
                hostkey: mpsc::unbounded_channel().0,
            }),
            Duration::from_secs(5),
        ));
        let asker = {
            let broker = broker.clone();
            tokio::spawn(async move {
                broker
                    .ask_auth(
                        "OTP",
                        Some("请输入令牌".into()),
                        vec![PromptSpec {
                            prompt: "口令:".into(),
                            echo: false,
                        }],
                    )
                    .await
            })
        };

        let request = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("应收到事件")
            .expect("通道不应关闭");
        broker
            .respond_auth(&request.request_id, vec!["123456".into()])
            .unwrap();
        assert_eq!(asker.await.unwrap().unwrap(), vec!["123456".to_owned()]);

        // 已应答的请求再次应答 → UnknownRequest。
        assert_eq!(
            broker.respond_auth(&request.request_id, vec![]),
            Err(PromptError::UnknownRequest)
        );
    }

    /// 指纹确认:拒绝路径返回 false;未知请求 ID 报错。
    #[tokio::test]
    async fn hostkey_confirm_reject_path() {
        let broker = PromptBroker::with_timeout(
            Arc::new(CapturingSink {
                auth: mpsc::unbounded_channel().0,
                hostkey: mpsc::unbounded_channel().0,
            }),
            Duration::from_secs(5),
        );
        assert_eq!(
            broker.respond_hostkey("不存在", false),
            Err(PromptError::UnknownRequest)
        );

        let (tx, mut rx) = mpsc::unbounded_channel::<HostKeyConfirmRequest>();
        let broker = Arc::new(PromptBroker::with_timeout(
            Arc::new(CapturingSink {
                auth: mpsc::unbounded_channel().0,
                hostkey: tx,
            }),
            Duration::from_secs(5),
        ));
        let asker = {
            let broker = broker.clone();
            tokio::spawn(async move {
                broker
                    .ask_hostkey("10.0.0.9", 22, "ssh-ed25519", "SHA256:x")
                    .await
            })
        };
        let request = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("应收到事件")
            .expect("通道不应关闭");
        broker.respond_hostkey(&request.request_id, false).unwrap();
        assert!(!asker.await.unwrap().unwrap());
    }

    /// 超时:无人应答时按 PromptError::Timeout 失败,且未决表被清理。
    #[tokio::test]
    async fn ask_times_out_and_cleans_up() {
        let broker = PromptBroker::with_timeout(
            Arc::new(CapturingSink {
                auth: mpsc::unbounded_channel().0,
                hostkey: mpsc::unbounded_channel().0,
            }),
            Duration::from_millis(50),
        );
        let result = broker.ask_auth("OTP", None, vec![]).await;
        assert_eq!(result, Err(PromptError::Timeout));
        assert!(broker.pending.lock().expect("prompt 锁").is_empty());
    }
}

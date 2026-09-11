# shelx-sshd-test

B5 传输层冒烟用的最小 sshd 容器(密码认证;后续按 M1-B10 扩展私钥/OTP 用户)。

## 构建与运行

```bash
docker build -t shelx-sshd-test .
docker run -d --name shelx-sshd-smoke -p 127.0.0.1:2222:22 shelx-sshd-test
```

凭据:root / shelxpass

## 执行冒烟测试

```bash
SSH_SMOKE_HOST=127.0.0.1 SSH_SMOKE_PORT=2222 SSH_SMOKE_USER=root SSH_SMOKE_PASS=shelxpass \
  cargo test --manifest-path src-tauri/Cargo.toml --test ssh_smoke -- --ignored
```

## 清理

```bash
docker rm -f shelx-sshd-smoke
```

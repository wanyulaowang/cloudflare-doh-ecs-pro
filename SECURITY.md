# 安全部署检查清单

这个 Worker 默认不启用 `.workers.dev` 路由。绑定生产自定义域名之前，请先完成以下检查。

## 1. 使用私密的高熵路径

生成两个互不相同的高熵路径，并配置为 Worker 变量：

```bash
openssl rand -hex 16
```

配置示例：

```jsonc
"DOH_PATH": "/<random-value>/dns-query",
"JSON_PATH": "/<different-random-value>/resolve"
```

不要把真实生产路径提交到公开仓库。

## 2. 必须绑定自定义域名

保持以下配置不变：

```jsonc
"workers_dev": false
```

只有当路径和访问控制都已准备好后，再绑定生产域名。

## 3. 添加 Cloudflare 滥用防护

在生产自定义域名上，至少配置以下之一：

- Cloudflare WAF 速率限制
- Cloudflare 自定义规则
- 如果服务仅限自己使用，配置 Cloudflare Access

建议对两个 API 路径的精确请求配置速率限制。请根据自己的设备数量和 DNS 查询突发特征调整阈值。

## 4. 保护源代码仓库

公开 GitHub 仓库建议启用：

- `main` 分支保护
- 必需 CI 状态检查
- 变更前必需人工审查
- Secret scanning
- Dependabot alerts
- 签名提交或其他强制审查策略

仓库内置的 CI 会执行：

```text
npm ci
typecheck
tests
npm audit
wrangler deploy --dry-run
```

## 5. 隐私注意事项

国内 DNS 查询会把掩码后的客户端子网发送给 DNSPod：

- IPv4：`/24`
- IPv6：`/56`

其他 DNS 查询不会发送用户侧 ECS，但所有上游解析器仍能看到查询的域名。

不要在边缘日志中记录完整 URL、DNS 报文或客户端地址。

## 漏洞报告

请使用 GitHub Security Advisories 私密报告安全漏洞。不要在公开 issue 中提交可利用细节。

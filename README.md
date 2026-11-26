# cf-doh-ecs-pro

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/your-github-username/cf-doh-ecs-pro)

部署在 Cloudflare Workers 上的 DoH 服务，支持 RFC 8484、Google 风格 JSON API、国内域名 ECS，以及国内外上游分流。

本项目基于 [Akiiia/cloudflare-doh-ecs](https://github.com/Akiiia/cloudflare-doh-ecs) 的 MIT 实现二开，保留并重写了 DNS 解析、ECS 注入、规则匹配和上游回退逻辑。

## 当前策略

按查询域名进行分流：

| 分组 | 主上游 | 备用上游 | ECS |
|---|---|---|---|
| 国内域名 | DNSPod | AliDNS | 启用，IPv4 `/24`，IPv6 `/56` |
| 其他域名 | Google DNS | Cloudflare DNS | 不启用，并移除客户端 ECS |

上游实测结论：

- DNSPod 会真实转发客户端提供的 IPv4 ECS。
- AliDNS 接受请求但会改用它自己的出口子网，因此只作为国内备用。
- Google 和 Cloudflare 对普通解析稳定，但没有满足用户侧 ECS 的需求，因此国外组不注入 ECS。
- IPv6 ECS 已实现编码和掩码逻辑，但上游行为需要部署后用真实 IPv6 客户端再验证。

## 接口

假设部署域名为 `doh.example.com`，默认路径如下。

### RFC 8484 GET

```text
https://doh.example.com/doh?dns=BASE64URL_DNS_MESSAGE
```

### RFC 8484 POST

```bash
curl \
  -H 'content-type: application/dns-message' \
  --data-binary @query.bin \
  'https://doh.example.com/doh'
```

### JSON GET

```text
https://doh.example.com/resolve?name=example.com&type=A
```

`type` 支持数字或 `A`、`AAAA`、`CNAME`、`MX`、`TXT`、`NS`、`PTR`、`SOA` 等常见名称。JSON 响应采用 Google Public DNS JSON API 兼容结构。

### 正常网站页面

直接访问根路径会返回一个普通企业官网页面：

```text
https://doh.example.com/
```

页面源码不暴露 DoH 路径，也不包含 DNS 相关说明。未知路径返回空 404。

## 防扫描建议

默认路径 `/doh` 和 `/resolve` 便于测试，但生产环境建议改成高熵路径，例如：

```json
{
  "DOH_PATH": "/a7f3d9c2e5/dns-query",
  "JSON_PATH": "/a7f3d9c2e5/resolve"
}
```

建议：

- 不要把真实生产路径提交到公开仓库。
- 绑定自定义域名，避免部分网络无法访问 `.workers.dev`。
- 在 Cloudflare 控制台配置 WAF 或速率限制。
- Worker 只做协议校验和上游转发，不能完全阻止知道路径的恶意访问。

## 一键部署

1. 把仓库推送到公开 GitHub 或 GitLab。
2. 把 README 中的 Deploy to Cloudflare 按钮链接替换成你的仓库地址。
3. 部署前把 `DOH_PATH` 和 `JSON_PATH` 改成高熵随机路径。
4. 点击按钮，Cloudflare 会自动创建 KV 并替换 `wrangler.jsonc` 里的占位 ID。
5. 部署完成后绑定自定义域名；模板默认关闭 `.workers.dev`，避免形成公开解析器入口。
6. 在自定义域名上配置 Cloudflare WAF 或速率限制后再对外分享。

`wrangler.jsonc` 中的 KV ID 是模板占位值，公开仓库不要提交你个人账号的真实 KV ID。

## 部署

1. 安装依赖：

```bash
npm install
```

2. 创建 KV 命名空间：

```bash
npx wrangler kv namespace create RULES_KV
```

3. 把返回的 `id` 填入 `wrangler.jsonc`：

```jsonc
"kv_namespaces": [
  {
    "binding": "RULES_KV",
    "id": "YOUR_KV_NAMESPACE_ID"
  }
]
```

4. 建议修改 `DOH_PATH` 和 `JSON_PATH` 为高熵路径。

5. 验证：

```bash
npm run typecheck
npm test
npm run deploy:dry-run
```

6. 部署：

```bash
npm run deploy
```

部署完成后，首次国内域名查询会从 KV 读取规则；如果 KV 为空，Worker 会自动下载并初始化规则。Cron Trigger 每日更新规则，更新失败时继续使用旧版本。

## 配置

| 变量 | 默认值 |
|---|---|
| `DOH_PATH` | `/doh` |
| `JSON_PATH` | `/resolve` |
| `DOMESTIC_DOH_URL` | `https://doh.pub/dns-query` |
| `DOMESTIC_FALLBACK_DOH_URL` | `https://dns.alidns.com/dns-query` |
| `GLOBAL_DOH_URL` | `https://dns.google/dns-query` |
| `GLOBAL_FALLBACK_DOH_URL` | `https://cloudflare-dns.com/dns-query` |

上游只允许 HTTPS URL，且主机名必须属于 DNSPod、AliDNS、Google DNS 或 Cloudflare DNS 的固定 allowlist；同时禁止用户名、密码、查询串和私网地址，避免 SSRF。

## 隐私与日志

- Worker 不记录完整查询域名、DNS 报文或客户端 IP。
- 上游失败日志只包含分组、角色和失败原因。
- 国内域名查询会把客户端子网发送给 DNSPod；这是 ECS 功能的必要代价。
- 国外域名查询不发送用户 ECS，但仍会向所选上游发送查询域名。

## 许可证

MIT。DNS 解析、ECS 和规则匹配基础实现源自 Akiiia/cloudflare-doh-ecs，许可证见 `LICENSE`。

# cf-doh-ecs-pro

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wanyulaowang/cloudflare-doh-ecs-pro)

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

完整上游 ECS 实测结论见 [UPSTREAM_ECS_TESTING.md](UPSTREAM_ECS_TESTING.md)。

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

如果你需要修改这个默认首页，请查看 [HOMEPAGE_CUSTOMIZATION.md](HOMEPAGE_CUSTOMIZATION.md)。

## 客户端配置

如果你希望浏览器或系统使用本服务，接入地址是：

```text
https://doh.example.com/your-doh-path
```

推荐优先使用**浏览器级 DoH**，例如 Firefox、Chrome、Edge 或 Brave 的自定义 secure DNS。  
如果你需要系统级或路由器级 DoH，建议使用本地 DNS 代理，例如 `dnsproxy`、`AdGuard Home`、`blocky` 或 `dnscrypt-proxy`。

详细配置步骤见 [CLIENT_SETUP.md](CLIENT_SETUP.md)。

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
2. 点击 README 中的 Deploy to Cloudflare 按钮。
3. 部署前把 `DOH_PATH` 和 `JSON_PATH` 改成高熵随机路径。
4. 点击按钮，Cloudflare 会自动创建并绑定 `RULES_KV`。
5. 部署完成后绑定自定义域名；模板默认关闭 `.workers.dev`，避免形成公开解析器入口。
6. 在自定义域名上配置 Cloudflare WAF 或速率限制后再对外分享。

`wrangler.jsonc` 不包含 KV ID；Wrangler 会为新部署自动创建 KV，或在连接已有 Worker 时继承同名绑定。生产上线前请阅读 [SECURITY.md](SECURITY.md)。

## 手动在 Cloudflare Workers 新建 Worker

如果你不想使用一键部署，也可以在 Cloudflare 控制台手动新建 Worker 并连接本仓库。推荐配置如下。

### 基础参数

| 配置项 | 建议值 |
|---|---|
| Worker 名称 | `cloudflare-doh-ecs-pro` |
| Git 仓库 | `https://github.com/wanyulaowang/cloudflare-doh-ecs-pro` |
| Production branch | `main` |
| Main module | `src/index.ts` |
| Compatibility date | `2026-11-23` |
| Root directory | `/` |
| Build command | `npm ci` |
| Deploy command | `npx wrangler deploy` |
| KV binding | `RULES_KV`，无需在仓库里写死 ID |
| Cron Trigger | `17 3 * * *` |
| Observability | `enabled: true`，`redact_query_string: true` |
| `workers.dev` | 保持关闭，建议绑定自定义域名后对外使用 |

说明：

- 如果使用 Cloudflare 的 Git 集成和 Wrangler 自动部署，`wrangler.jsonc` 已经包含以上默认配置。
- 如果你在控制台手动选择已有 KV 命名空间，绑定名必须保持 `RULES_KV`，但不要把真实 KV ID 提交到公开仓库。
- `workers.dev` 默认关闭；如需公网访问，请绑定自定义域名。

### 需要填写或确认的环境变量

| 变量 | 默认值 |
|---|---|
| `DOH_PATH` | `/doh` |
| `JSON_PATH` | `/resolve` |
| `DOMESTIC_DOH_URL` | `https://doh.pub/dns-query` |
| `DOMESTIC_FALLBACK_DOH_URL` | `https://dns.alidns.com/dns-query` |
| `GLOBAL_DOH_URL` | `https://dns.google/dns-query` |
| `GLOBAL_FALLBACK_DOH_URL` | `https://cloudflare-dns.com/dns-query` |

生产环境建议把 `DOH_PATH` 和 `JSON_PATH` 改成高熵随机路径。

### 建议的上线顺序

1. 在 Cloudflare Workers 中新建 `cloudflare-doh-ecs-pro`。
2. 连接 GitHub 仓库，并确认 production branch 是 `main`。
3. 填写上表中的 build / deploy / root directory。
4. 绑定或自动创建 `RULES_KV`。
5. 确认环境变量和 Cron Trigger。
6. 绑定自定义域名。
7. 在自定义域名上配置 WAF、速率限制或 Access。

## 部署

1. 安装依赖：

```bash
npm ci
```

2. 创建 KV 命名空间：

```bash
npx wrangler kv namespace create RULES_KV
```

3. `wrangler.jsonc` 不需要填写 KV ID；首次部署会自动创建并绑定 `RULES_KV`，已有同名绑定时会直接继承。

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

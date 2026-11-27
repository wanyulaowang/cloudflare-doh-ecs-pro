# 上游 DoH ECS 实测报告

- 测试日期：2026-11-27
- 测试方式：直接向公共 DoH 上游发送 RFC 8484 wireformat 请求
- 主要判据：`whoami.ds.akahelp.net` 的 TXT 响应中 `ecs` 字段，代表权威 DNS 实际收到的 ECS
- 交叉验证域名：`www.youtube.com`、`www.google.com`、`www.cloudflare.com`
- 测试子网：不带 ECS、`1.1.1.0/24`、`8.8.8.0/24`、`114.114.114.0/24`

## 总体结论

- **DNSPod** 是本次实测中唯一明确会把用户提供的 ECS 原样转发到权威侧的公共 DoH。
- **AliDNS** 会接受请求，但会把用户 ECS 替换成自己的出口子网，不能代表真实用户位置。
- **Google DoH** 和 **Cloudflare DoH** 不会把用户传入的 ECS 原样转发给权威侧；它们可能向权威侧发送自己的出口子网 ECS，但这不是用户侧 ECS。
- 其余主流公共 DoH 在本次样本中未表现出用户侧 ECS 生效，大多只是忽略或回显 ECS。

## 实测结果

| 上游 | Endpoint | 用户侧 ECS 结论 | 权威侧是否收到用户 ECS | 不同子网是否能改变结果 |
|---|---|---|---|---|
| Google | `https://dns.google/dns-query` | 不支持用户侧 ECS | 否 | 否 |
| Cloudflare | `https://cloudflare-dns.com/dns-query` | 不支持用户侧 ECS | 否 | 否 |
| DNSPod | `https://doh.pub/dns-query` | 支持用户侧 ECS | 是 | 是，但存在缓存隔离 caveat |
| AliDNS | `https://dns.alidns.com/dns-query` | 不原样转发用户 ECS | 否，会替换成自己的出口子网 | 部分域名会变，但不是用户 ECS 直接生效 |
| Quad9 | `https://dns.quad9.net/dns-query` | 未表现出用户侧 ECS 生效 | 未看到 | 否 |
| AdGuard | `https://dns.adguard-dns.com/dns-query` | 不支持用户侧 ECS | 否 | 否 |
| OpenDNS | `https://doh.opendns.com/dns-query` | 不支持用户侧 ECS | 否 | 否 |
| NextDNS | `https://dns.nextdns.io/dns-query` | 未表现出用户侧 ECS 生效 | 未看到 | 否 |
| DNS.SB | `https://doh.dns.sb/dns-query` | 未表现出用户侧 ECS 生效 | 未看到 | 否 |
| Mullvad | `https://dns.mullvad.net/dns-query` | 未表现出用户侧 ECS 生效 | 未看到 | 否 |
| ControlD | `https://freedns.controld.com/p0` | 未表现出用户侧 ECS 生效 | 未看到 | 否 |

## 关键判断：Google / Cloudflare 的“支持 ECS”说法

这次实测里，Google 和 Cloudflare 在不带用户 ECS 时，也会向权威侧发送一个 ECS，例如：

- Google：`212.107.29.0/24`
- Cloudflare：`212.107.28.0/24`

但这是**上游解析器自己的出口子网**，不是用户传入的子网。  
当我显式传入 `1.1.1.0/24`、`8.8.8.0/24`、`114.114.114.0/24` 时：

- Cloudflare 权威侧仍然看到 `212.107.28.0/24`
- Google 的 `whoami.ds` 返回 `REFUSED`，热门域名答案也不随子网变化

因此，外部帖子中“Google / Cloudflare 支持 ECS”的说法，更可能指的是它们会向权威侧发送自己的 ECS，而不是接受并转发用户提供的 ECS。

## 对当前项目策略的影响

当前项目的分流策略仍然合理：

1. **国内域名**
   - 主上游继续使用 DNSPod，它是唯一明确支持用户侧 ECS 的公共 DoH。
   - AliDNS 只作为备用，因为它会把 ECS 替换成自己的出口子网。

2. **国外域名**
   - Google 和 Cloudflare 可以继续用于稳定解析。
   - 但它们不适合作为“用户侧 ECS”上游；如果需要国外域名也按用户位置解析，必须另找真正支持用户 ECS 的上游或自建递归链路。

3. **IPv6 ECS**
   - 代码已实现编码和掩码逻辑，但上游行为仍需部署后用真实 IPv6 客户端再验证。

## 已知限制

- `whoami.ipv4.akahelp.net` 在多数测试中没有返回 A 记录，因此主要依据 `whoami.ds.akahelp.net`。
- Quad9 和 Mullvad 需要 HTTP/2，已用 curl 补测。
- ControlD 的 `dns.controld.com/dns-query` 持续返回 `REFUSED`，未能形成有效样本。
- NextDNS 使用通用 endpoint，未测试个性化配置。
- 本次测试只关注“用户 ECS 是否被上游原样转发”，不评价各上游的隐私策略或解析质量。

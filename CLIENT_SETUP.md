# 客户端配置说明

本项目的 DoH 服务部署后，可用两种方式接入：

- **浏览器级 DoH**：只影响浏览器内 DNS 解析，配置简单，推荐优先使用。
- **系统级 / 路由器级 DoH**：影响整台设备或整个内网，但部分系统不原生支持自定义 DoH URL，通常需要本地代理或描述文件。

## 1. 先准备接入地址

假设你的自定义域名是：

```text
https://doh.example.com
```

并且你在 Worker 中配置了：

```text
DOH_PATH = /your-doh-path
JSON_PATH = /your-json-path
```

那么客户端应使用：

```text
https://doh.example.com/your-doh-path
```

注意：

- 请先绑定自定义域名；本项目默认关闭 `.workers.dev`。
- `DOH_PATH` 建议使用高熵随机路径。
- 浏览器和系统 DNS 使用的是 RFC 8484 DoH endpoint，不是 JSON endpoint。

---

## 2. 浏览器配置

### Firefox

1. 打开 `Settings`。
2. 进入 `Privacy & Security`。
3. 找到 `DNS over HTTPS`。
4. 选择 `Max Protection`。
5. 在 `Choose provider` 里选择 `Custom`。
6. 填入：

```text
https://doh.example.com/your-doh-path
```

适合场景：

- 希望浏览器内所有 DNS 都走 DoH。
- 不想改动系统 DNS。
- 想让 Cloudflare 直接看到浏览器出口 IP，ECS 更接近真实用户位置。

### Chrome / Edge / Brave

以 Chrome 为例：

1. 打开 `Settings`。
2. 进入 `Privacy and security` → `Security`。
3. 开启 `Use secure DNS`。
4. 选择 `With: Custom`。
5. 填入：

```text
https://doh.example.com/your-doh-path
```

Edge / Brave 的入口略有不同，但通常也在：

```text
Settings → Privacy and security → Security → Use secure DNS
```

适合场景与 Firefox 相同。

### Safari

Safari 通常没有独立的自定义 DoH 配置入口。  
如果你希望 Safari 也走 DoH，建议：

- 使用系统级 / 本地代理方案；
- 或改用 Firefox / Chrome / Edge / Brave。

---

## 3. 系统级或路由器级配置

### 3.1 先判断是否真的需要系统级 DoH

系统级 DoH 会影响整台设备或整个内网，但也有一个重要代价：

- Cloudflare Worker 看到的是**代理或路由器的出口 IP**，不一定是最终用户 IP。
- 因此 ECS 可能变粗，定位精度下降。
- 如果 ECS 精度对你很重要，优先使用浏览器级 DoH。

如果你仍然需要系统级 DoH，推荐下面两种方式。

---

### 3.2 Linux：使用本地 DNS 代理

可以用 `dnsproxy`、`AdGuard Home`、`dnscrypt-proxy`、`blocky` 等工具把本机 DNS 转成 DoH。

以 `dnsproxy` 为例：

```bash
dnsproxy \
  -l 127.0.0.1 \
  -p 53 \
  -u https://doh.example.com/your-doh-path
```

然后把系统 DNS 指向：

```text
127.0.0.1
```

适合场景：

- Linux 桌面或服务器。
- 需要让非浏览器流量也走 DoH。

---

### 3.3 macOS / iPadOS：使用描述文件或本地代理

macOS 和 iPadOS 的原生设置通常不提供“直接填自定义 DoH URL”的入口。  
可选方案：

1. **系统描述文件**
   - 通过 `.mobileconfig` 配置 DoH。
   - 需要你自己生成或使用支持自定义 DoH 的配置工具。

2. **本地代理**
   - 在本机运行 `dnsproxy`、`AdGuard Home` 等工具。
   - 把系统 DNS 指向本地代理。

适合场景：

- 希望 Safari、Mail、App Store 等系统流量也走 DoH。
- 能接受 ECS 精度可能下降。

---

### 3.4 Windows

Windows 11 支持部分 DoH 场景，但对自定义 URL / 域名路径的配置不如浏览器直观。  
推荐：

1. **优先使用浏览器级 DoH**。
2. 如果必须系统级，使用本地 DNS 代理或路由器级方案。

如果你使用 Windows 自带 DoH，请确认：

- 系统版本支持 DoH。
- 能配置你自己的 DoH 模板。
- 不影响其他网络功能。

---

### 3.5 Android

Android 的 `Private DNS` 使用的是 DNS-over-TLS（DoT），不是 DoH。  
因此它**不能直接使用本项目的 DoH endpoint**。

可选方案：

1. 浏览器级 DoH。
2. 本地 DNS 代理 App。
3. 路由器级 DoH。

适合场景：

- 手机浏览器流量。
- 不建议直接用系统 Private DNS 接入本项目。

---

### 3.6 路由器级方案

如果你希望整个家庭或办公室网络都走 DoH，可以在路由器上部署：

- `AdGuard Home`
- `blocky`
- `dnscrypt-proxy`
- `dnsproxy`
- 其他支持自定义 DoH 的路由器插件

然后把路由器的 DNS 指向这个本地服务，本地服务再转发到：

```text
https://doh.example.com/your-doh-path
```

适合场景：

- 所有设备统一走 DoH。
- 不想逐台设备配置。

代价：

- Cloudflare 通常只能看到路由器出口 IP。
- ECS 会变成路由器级别，不再精确到单台设备。

---

## 4. 如何验证 DoH 是否生效

### 4.1 用 JSON endpoint 快速验证

假设 JSON endpoint 是：

```text
https://doh.example.com/your-json-path
```

可以直接访问：

```text
https://doh.example.com/your-json-path?name=example.com&type=A
```

如果能返回 JSON 结果，说明 Worker 已经可用。

### 4.2 用浏览器开发者工具验证

1. 打开浏览器开发者工具。
2. 进入 `Network`。
3. 访问一个新网站。
4. 观察是否有 DoH 请求发往：

```text
https://doh.example.com/your-doh-path
```

### 4.3 用系统日志验证

如果你使用本地代理或路由器方案，查看对应工具日志，确认它是否在向：

```text
https://doh.example.com/your-doh-path
```

发起请求。

---

## 5. ECS 精度建议

本项目会把 `CF-Connecting-IP` 转成 ECS。  
因此：

- **浏览器直连 Cloudflare Worker**：ECS 最接近真实用户位置。
- **本地代理 / 路由器代理**：Cloudflare 看到的是代理出口 IP，ECS 精度会下降。
- **系统级 DoH**：如果经过多层代理，ECS 可能变得很粗。

如果你最关心国内域名解析的地理位置精度，建议：

1. 优先使用浏览器级 DoH。
2. 如果必须系统级，尽量把代理部署在离用户最近的设备上。
3. 避免把代理放在很远的服务器或跨国链路上。

---

## 6. 安全建议

- 不要把真实的 `DOH_PATH` / `JSON_PATH` 提交到公开仓库。
- 生产环境建议使用高熵随机路径。
- 绑定自定义域名后再对外使用。
- 在 Cloudflare 上配置 WAF、速率限制或 Access。
- 如果不需要 JSON API，可以在部署后只暴露 DoH endpoint，并保留 JSON endpoint 用于调试。

---

## 7. 常见问题

### 为什么浏览器配置成功，但系统其他应用不走 DoH？

浏览器级 DoH 只影响浏览器内部的 DNS 解析，不会自动接管系统 DNS。  
如果你希望其他应用也走 DoH，需要使用系统级代理或路由器方案。

### 为什么系统级配置后 ECS 不准了？

因为 Cloudflare Worker 看到的是代理或路由器的 IP，不是原始用户 IP。  
这会让 ECS 变粗，解析位置可能偏离真实用户。

### Android Private DNS 能用吗？

不能用本项目直接配置，因为 Android Private DNS 使用 DoT，而本项目提供的是 DoH。  
可以用浏览器级 DoH，或改用支持 DoH 的本地代理。

### Safari 怎么配置？

Safari 通常没有独立 DoH 设置。  
建议使用 Firefox / Chrome / Edge / Brave，或改用系统级代理方案。

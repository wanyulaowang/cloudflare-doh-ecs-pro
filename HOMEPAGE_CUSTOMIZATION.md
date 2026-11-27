# 修改默认首页

直接访问部署域名时，Worker 会返回一个普通企业官网页面。这个页面用于降低扫描器对 DoH 服务的识别度。

## 页面所在文件

默认首页内容在：

```text
src/site.ts
```

对应常量是：

```ts
const HOMEPAGE_HTML = `<!doctype html>
...
`;
```

`/` 和 `/index.html` 都会返回这同一个页面。

## 修改步骤

1. 打开 `src/site.ts`。
2. 修改 `HOMEPAGE_HTML` 里的 HTML 内容。
3. 保留完整 HTML 结构，不要只替换其中一小段。
4. 可以修改：
   - 网站标题
   - 品牌
   - 文案
   - 配色
   - 卡片内容
   - 页脚
5. 不建议在页面里出现：
   - DNS
   - DoH
   - `dns-query`
   - 你的真实 `DOH_PATH`
   - 你的真实 `JSON_PATH`
   - 任何说明这是 DNS 服务的文字

## 示例

如果你只想改标题和主文案，可以编辑：

```html
<title>你的网站标题</title>
...
<h1>你的网站名称</h1>
<p class="subtitle">你的网站介绍文案。</p>
```

如果只想改配色，可以调整 `<style>` 里的：

```css
body { background: #f5f7fb; color: #1f2937; }
header { background: #172554; color: #fff; }
```

## 验证

修改后执行：

```bash
npm run typecheck
npm test
```

测试会检查首页仍是完整 HTML，并且不包含 `dns-query`。你可以自由修改品牌名、标题和文案，不需要为了品牌名去改测试。

本地预览首页：

```bash
npx wrangler dev
```

然后访问：

```text
http://127.0.0.1:8787/
```

打包验证：

```bash
npm run deploy:dry-run
```

## 部署

按你当前使用的部署方式执行：

- 如果仓库连接了 Cloudflare Workers Builds，推送到 `main` 后会自动部署。
- 如果是本地部署，执行：

```bash
npm run deploy
```

如果你的仓库提供了 `deploy:production` 脚本，已有 Worker 或本地部署建议优先使用：

```bash
npm run deploy:production
```

## 缓存说明

默认首页响应设置了：

```text
Cache-Control: public, max-age=3600
```

修改后，部分客户端可能最多会缓存 1 小时。  
如果你希望修改立即生效，可以临时把 `src/site.ts` 里的 `max-age=3600` 改小，例如：

```text
Cache-Control: public, max-age=60
```

生产环境一般不建议使用 `no-store`，因为首页内容本身不包含敏感信息。

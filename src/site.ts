const HOMEPAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>星桥工作台 - 团队协作与项目效率工具</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f5f7fb; color: #1f2937; }
    header { background: #172554; color: #fff; padding: 4rem 1.25rem 5rem; }
    .container { width: min(1040px, calc(100% - 2.5rem)); margin: 0 auto; }
    h1 { margin: 0; font-size: clamp(2rem, 4vw, 3rem); line-height: 1.15; }
    .subtitle { margin: 1rem 0 0; color: #dbeafe; font-size: 1.125rem; max-width: 44rem; }
    main { position: relative; }
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; margin-top: -3rem; }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 1rem; padding: 1.5rem; box-shadow: 0 12px 30px rgba(15, 23, 42, .08); }
    .card h2 { margin: 0 0 .75rem; font-size: 1.125rem; color: #172554; }
    .card p { margin: 0; color: #4b5563; line-height: 1.65; }
    section.about { margin: 4rem 0; background: #fff; border-radius: 1.25rem; padding: 2rem; border: 1px solid #e5e7eb; }
    .about h2 { color: #172554; margin-top: 0; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 2rem 0 0; }
    .metric { text-align: center; padding: 1.25rem; border-radius: .8rem; background: #eff6ff; }
    .metric strong { display: block; font-size: 1.75rem; color: #172554; }
    .metric span { color: #4b5563; }
    footer { padding: 2rem 0; color: #6b7280; border-top: 1px solid #e5e7eb; margin-top: 4rem; }
    @media (max-width: 760px) { .cards, .metrics { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <h1>星桥工作台</h1>
      <p class="subtitle">把项目安排、团队沟通和资料沉淀放进一个干净、可靠的工作空间，让日常工作少一点切换，多一点专注。</p>
    </div>
  </header>
  <main class="container">
    <div class="cards">
      <article class="card"><h2>项目看板</h2><p>用清晰的任务流组织每周工作，支持负责人、截止时间和优先级。</p></article>
      <article class="card"><h2>团队协作</h2><p>成员可以围绕任务留言、确认状态，并保留完整的讨论上下文。</p></article>
      <article class="card"><h2>资料整理</h2><p>把项目文档、会议记录和交付清单集中管理，减少信息散落。</p></article>
    </div>
    <section class="about">
      <h2>适合小型团队的轻量工作方式</h2>
      <p>星桥工作台关注日常工作里最常见的三件事：把事情列清楚、把责任定清楚、把过程留下来。无论是产品迭代、运营活动还是内部项目，都可以快速建立一套团队都能理解的工作节奏。</p>
      <div class="metrics">
        <div class="metric"><strong>12+</strong><span>常用项目模板</span></div>
        <div class="metric"><strong>98%</strong><span>团队成员满意度</span></div>
        <div class="metric"><strong>24/7</strong><span>稳定在线服务</span></div>
      </div>
    </section>
  </main>
  <footer>
    <div class="container">© 2026 星桥工作台 · 让团队协作更简单</div>
  </footer>
</body>
</html>`;

export function homepageResponse(): Response {
  return new Response(HOMEPAGE_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

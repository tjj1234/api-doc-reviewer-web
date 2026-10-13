# api-doc-reviewer · Web

在浏览器里审查一份 API 文档是否**适合 AI agent 使用**，输出可执行的修改意见。

Live page: https://tjj1234.github.io/api-doc-reviewer-web/

命令行版本（完整两层膜、可接 Skill / MCP）：[tjj1234/api-doc-reviewer](https://github.com/tjj1234/api-doc-reviewer)

## 它查什么

七层框架，从「机器能读」一路查到「agent 敢用」：

| 层 | 关注点 |
|---|---|
| L0 形态层 | 文档形态是否可被机器/爬虫读取 |
| L1 结构层 | schema 完整性：类型、必填、枚举、嵌套 |
| L2 语义层 | 「什么时候该用」是否讲清、有无隐藏前置条件 |
| L3 契约层 | auth 怎么传、示例够不够抄、错误码各代表什么 |
| L4 行为层 | 幂等、重试、分页游标、限流退避、异步轮询 |
| L5 安全层 | 破坏性操作警示、危险示例、越权说明 |
| L6 生命周期 | deprecated 标注、可发现性、changelog |

三种消费模式，检查重心各不相同：

- **A · MCP / Function Calling** —— agent 只读 schema 选 tool 填参数，最看重 L1 + L4
- **B · RAG 检索** —— 靠自然语言段落召回，最看重 L2 + L6
- **C · Agent 浏览器读文档** —— 靠页面结构与示例，最看重 L0 + L2 + L3

每条发现都按三层给：**检查什么 → 不符合的后果 → 应如何修改**（带 before / after）。

## 为什么是网页版能跑

核心引擎是纯 JavaScript —— 规则层、编排层、报告层不依赖任何 Node 内建模块，只用了 `fetch`。
所以同一份 core 既能在命令行跑，也能原样搬进浏览器。

## 网页版的范围边界（重要）

网页版跑的是**静态膜**：只看文档本身。

动态膜（拿测试凭据实测真实 API，验证「文档写的 ≠ 网关实际返回的」）在浏览器里会被跨域策略挡住，因此**网页版不提供**。
这不是偷偷降级 —— 报告首节的「覆盖声明」会把所有需要实测的项明确标为**未测**，绝不冒充已通过。

> 未测 ≠ 通过，不适用 ≠ 失败。

需要完整两层膜，请用 [命令行版本](https://github.com/tjj1234/api-doc-reviewer)。

## 抓取网址：通道、顺序与限制

网页版是纯静态站，没有后端代抓，只能靠浏览器自己取。目标站点未开放 CORS 时，浏览器会把整个响应拦掉 —— 这是浏览器安全模型，**不是本页故障**。

抓取按下面的顺序推进，每一步的成败都会实时显示在页面上：

1. **网址规范化** —— 自动补 `https://`；`github.com/…/blob/…`、gist、GitLab blob 自动转成对应 raw 地址（raw 域反而开放 CORS）。
2. **直连优先** —— 大量 OpenAPI 端点、GitHub raw、jsDelivr 都带 CORS 头，直连命中率其实不低。
3. **spec 路径探测** —— 若网址不像文件（如文档站首页），自动追加 `/openapi.json`、`/swagger.json`、`/v3/api-docs` 等常见路径重试。
4. **代理回退（尽力而为）** —— 直连全挂时才用公共 CORS 代理，且会逐个显示结果。公共代理可能限流、失效或不返回，**不保证可用**。
5. **自定义代理（最可靠）** —— 页面「高级」里可填自建代理，填写后会被最先尝试。一个 Cloudflare Worker 几行代码即可：

```js
export default {
  async fetch(request) {
    const target = new URL(request.url).searchParams.get('url');
    const resp = await fetch(target);
    return new Response(await resp.text(), {
      headers: { 'access-control-allow-origin': '*', 'content-type': resp.headers.get('content-type') || 'text/plain' },
    });
  },
};
```

失败时页面会给出**逐条尝试记录 + 归因**（网址 404 / 跨域被拦 / 超时 / 混合内容），并提供一键切到「粘贴内容」或「上传文件」。

> 实践建议：文档站在 GitHub 上（或能拿到 raw 地址）时，直连成功率最高；文档站只在网页里展示、且是 JS 动态渲染时，直接复制内容粘贴是最省事的路。

## 隐私

- 文档内容**不上传任何服务器**，解析和审查全部在你的浏览器里完成。
- 模型后端默认关闭。开启后，文档内容会发送给你自己填写的那个端点（OpenAI-compatible，可换 PowerTokens / DeepSeek / 本地 Ollama）。
- 勾选「在本机记住配置」时，配置存 localStorage。**建议只对额度受限的专用 Key 使用**，敏感文档优先用粘贴 / 上传、不开模型。
- 抓取网址时若使用公共 CORS 代理，文档内容会经过第三方服务器 —— 敏感文档请改用粘贴或上传。

## 本地开发

```bash
# 任意静态服务器即可，例如
npx serve .
# 或
python -m http.server 8000
```

必须经 HTTP 打开（ES module + importmap 不支持 `file://`）。

## 目录结构

```
index.html          页面
css/style.css       样式
js/app.js           UI 逻辑
js/review.js        对 core 的薄适配（网页版唯一的特有代码）
vendor/core/        来自 api-doc-reviewer 的 core（同步副本）
examples/           示例文档
```

### 关于 vendor/core

`vendor/core/` 是上游仓库 `core/` 的同步副本，**排除了两个含 Node 静态依赖的文件**：
`core/index.js`（CLI 入口）和 `core/loaders/index.js`（含 `import fs`）。

升级方式：从上游重新复制 `core/` 到 `vendor/core/`，再删除这两个文件。除加载方式外，两边的规则引擎与报告生成器是同一份代码。

## License

MIT

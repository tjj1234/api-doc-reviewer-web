// review.js — 网页版对 core 引擎的薄适配层
// 与 CLI 的唯一差别：不碰文件系统（浏览器没有 fs），输入一律是字符串。
// 除加载方式外，规则引擎、报告生成器与 CLI 完全共用同一份 core。
import { review } from '../vendor/core/engine.js';
import { parseOpenApi, openApiMeta, isOpenApiFile } from '../vendor/core/loaders/openapi.js';
import { parseText, textMeta } from '../vendor/core/loaders/text.js';
import { getMode } from '../vendor/core/modes.js';
import { toMarkdown } from '../vendor/core/report/markdown.js';
import { toHtml } from '../vendor/core/report/html.js';

// 网页版等价的 loadInput：把字符串归一化为 doc context
export async function loadDoc(content, filename = '') {
  const trimmed = (content || '').trim();
  if (!trimmed) throw new Error('内容为空，请先输入或选择文档。');

  const maybeOpenApi = filename ? isOpenApiFile(filename) : false;
  const hasOpenApiMarker = /"openapi"|"swagger"|openapi\s*:|swagger\s*:/i.test(trimmed.slice(0, 2000));

  if (maybeOpenApi || hasOpenApiMarker) {
    try {
      const doc = await parseOpenApi(trimmed);
      return { kind: 'openapi', doc, raw: trimmed, meta: openApiMeta(doc) };
    } catch (e) {
      throw new Error(`识别为 OpenAPI 但解析失败：${e.message}`);
    }
  }

  const text = parseText(trimmed);
  return { kind: 'text', doc: text, raw: trimmed, meta: textMeta(text) };
}

// 执行一次审查。modelCfg 为空则走零模型规则引擎（语义项落为 NOT_TESTED）
export async function runReview({ content, filename = '', mode = 'A', model = null }) {
  const loaded = await loadDoc(content, filename);
  const modeMeta = getMode(mode);
  const ctx = {
    kind: loaded.kind,
    doc: loaded.doc,
    meta: loaded.meta,
    mode,
    modeName: modeMeta.name,
    model: model && model.api_key
      ? { base_url: model.base_url, api_key: model.api_key, model: model.model }
      : undefined,
    // 网页版不支持动态膜：浏览器跨域策略会挡住对被测 API 的实测。
    // 这不是降级隐瞒 —— 覆盖声明会把相关项明确标为「未测」。
    dynamic: { enabled: false },
  };
  const report = await review(ctx);
  return { report, loaded };
}

// 抓取网址：先直连，被跨域拦截时可选回退到公共 CORS 代理
const PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://r.jina.ai/${u}`,
];

export async function fetchUrl(url, { allowProxy = true } = {}) {
  let lastErr = null;

  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    return { text, via: 'direct' };
  } catch (e) {
    lastErr = e;
  }

  if (!allowProxy) {
    throw new Error('直连失败（多半是目标站点未开放跨域）。可勾选公共代理重试，或改用粘贴 / 上传。');
  }

  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const resp = await fetch(PROXIES[i](url));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      return { text, via: i === 0 ? '代理 · allorigins' : '代理 · r.jina.ai' };
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(`直连与代理均失败：${lastErr?.message || '未知错误'}。建议把内容复制后粘贴，或改为上传文件。`);
}

export { toMarkdown, toHtml };

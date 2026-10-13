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

// ============================================================================
// 网址抓取
// ----------------------------------------------------------------------------
// 现实约束（先说清楚，免得误判成 bug）：
//  * GitHub Pages 是纯静态站，没有后端可以代抓；
//  * 目标站点未开放 CORS 时，浏览器会把整个响应拦掉，JS 连状态码都拿不到
//    —— 这是浏览器安全模型，不是代码写错；
//  * 公共 CORS 代理是 best-effort：可能限流、要求 key、或直接停服。
// 所以策略是「尽量提高直连命中率 + 失败可解释 + 一键降级」：
//   1) 网址规范化：GitHub blob / gist / GitLab blob → raw（这些 raw 域反而开 CORS）；
//   2) 直连优先：大量 OpenAPI 端点、GitHub raw、jsDelivr 都带 CORS 头；
//   3) 网址不像文件时，探测常见 spec 路径（/openapi.json、/v3/api-docs…）；
//   4) 代理仅作回退，且每一步的结果都回传 UI —— 让你看得见哪一步挂了、为什么。
// ============================================================================

const STEP_TIMEOUT = 7000;   // 单步超时（ms）
const TOTAL_BUDGET = 21000;  // 整个抓取的总预算，避免无限等待
const MAX_DIRECT = 3;        // 直连最多试几个候选地址

const SPEC_PATHS = [
  '/openapi.json', '/openapi.yaml', '/swagger.json',
  '/v3/api-docs', '/openapi.yml', '/.well-known/openapi.json',
];

// 公共代理（best-effort，不保证可用）。tpl 中 {url} = 已编码，{rawurl} = 原样。
const PUBLIC_PROXIES = [
  { name: 'allorigins', tpl: 'https://api.allorigins.win/raw?url={url}' },
  { name: 'r.jina.ai', tpl: 'https://r.jina.ai/{rawurl}' },
  { name: 'codetabs', tpl: 'https://api.codetabs.com/v1/proxy/?quest={url}' },
];

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// 网址规范化：补协议 + GitHub/GitLab 网页地址 → 原始文件（raw 域开 CORS）
export function normalizeUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = `https://${u}`;

  let m;
  if ((m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i))) {
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  }
  if ((m = u.match(/^https?:\/\/gist\.github\.com\/([^/]+)\/([0-9a-f]+)\/?$/i))) {
    return `https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw`;
  }
  if ((m = u.match(/^https?:\/\/gitlab\.com\/(.+?)\/-\/blob\/(.+)$/i))) {
    return `https://gitlab.com/${m[1]}/-/raw/${m[2]}`;
  }
  return u;
}

// 判断抓回来的内容更像什么，用于给用户提示
export function sniffKind(text) {
  const head = String(text || '').slice(0, 3000);
  if (/<html|<!doctype\s+html|<head[\s>]|<body[\s>]/i.test(head)) return 'html';
  if (/"?(openapi|swagger)"?\s*[:=]/i.test(head) || /^\s*openapi\s*:/im.test(head)) return 'spec';
  return 'text';
}

// 生成候选地址：原网址 + 常见 spec 路径（仅当原网址不像文件时）
export function buildCandidates(url) {
  const out = [url];
  let u;
  try { u = new URL(url); } catch { return out; }
  if (/\.(json|ya?ml)$/i.test(u.pathname)) return out;              // 已经像文件，不猜测
  if (/\/(api-docs|openapi|swagger)\b/i.test(u.pathname)) return out; // 已是目录式 spec 端点
  for (const p of SPEC_PATHS) out.push(u.origin + p);
  return out.slice(0, MAX_DIRECT);
}

async function tryFetch(url, timeout) {
  const t0 = Date.now();
  try {
    const resp = await fetch(url, { mode: 'cors', redirect: 'follow', signal: timeoutSignal(timeout) });
    const took = Date.now() - t0;
    if (!resp.ok) return { ok: false, reason: 'http', note: `HTTP ${resp.status}`, took };
    const text = await resp.text();
    return { ok: true, text, took, status: resp.status };
  } catch (e) {
    const took = Date.now() - t0;
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      return { ok: false, reason: 'timeout', note: `超时（${Math.round(timeout / 1000)}s 无响应）`, took };
    }
    // 浏览器出于安全不会区分 CORS / DNS / 断网，只能合并叙述
    return { ok: false, reason: 'blocked', note: '被浏览器拦截（目标多半未开放跨域），或网络不可达', took };
  }
}

function buildProxyUrl(proxy, target) {
  return proxy.tpl
    .replace('{rawurl}', target)
    .replace('{url}', encodeURIComponent(target));
}

export class FetchError extends Error {
  constructor(message, attempts = []) {
    super(message);
    this.name = 'FetchError';
    this.attempts = attempts;
  }
}

// 抓取网址。onProgress(attempts) 每步回调一次，供 UI 实时渲染。
// 成功返回 { text, via, url, kind, attempts }；失败抛 FetchError（带 attempts）。
export async function fetchUrl(rawUrl, { allowProxy = true, customProxy = '', onProgress } = {}) {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error('请先填写文档网址。');

  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`网址格式不对：${rawUrl}`); }

  const mixedContent = typeof location !== 'undefined'
    && location.protocol === 'https:' && parsed.protocol === 'http:';

  const candidates = buildCandidates(url);
  const attempts = [];
  const startedAt = Date.now();
  const left = () => TOTAL_BUDGET - (Date.now() - startedAt);
  const snapshot = () => attempts.map((a) => ({ ...a }));

  const step = async (phase, label, target) => {
    const entry = { phase, label, target, state: 'running', note: '进行中…' };
    attempts.push(entry);
    onProgress?.(snapshot());

    const budget = left();
    if (budget < 1500) {
      entry.state = 'skip';
      entry.note = '总时间预算已用尽，跳过';
      onProgress?.(snapshot());
      return { ok: false, reason: 'budget' };
    }

    const r = await tryFetch(target, Math.min(STEP_TIMEOUT, budget));
    entry.state = r.ok ? 'ok' : 'fail';
    entry.note = r.ok ? `成功（${r.took}ms）` : r.note;
    entry.took = r.took;
    onProgress?.(snapshot());
    return r;
  };

  const done = (text, via, finalUrl) => ({
    text, via, url: finalUrl, kind: sniffKind(text), attempts: snapshot(),
  });

  // 1) 直连（含 spec 路径探测）
  for (const cand of candidates) {
    const r = await step('direct', '直连', cand);
    if (r.ok) return done(r.text, '直连', cand);
  }

  // 2) 代理回退（best-effort）
  if (allowProxy) {
    const proxies = [];
    if (customProxy && /\{url\}|\{rawurl\}/.test(customProxy)) {
      proxies.push({ name: '自定义代理', tpl: customProxy.trim() });
    }
    proxies.push(...PUBLIC_PROXIES);

    // 代理阶段最多打 2 个候选地址，避免请求数爆炸
    const targets = candidates.slice(0, 2);
    for (const p of proxies) {
      for (const cand of targets) {
        if (left() < 1500) break;
        const r = await step('proxy', `代理 · ${p.name}`, buildProxyUrl(p, cand));
        if (r.ok) return done(r.text, `代理 · ${p.name}`, cand);
      }
    }
  }

  throw new FetchError(diagnose(attempts, { allowProxy, mixedContent }), snapshot());
}

function diagnose(attempts, { allowProxy, mixedContent }) {
  const ran = attempts.filter((a) => a.state === 'fail');
  if (mixedContent) {
    return '目标网址是 http://，而本页是 https —— 浏览器会以「混合内容」为由直接拦截。请改用 https 地址，或把内容粘贴/上传。';
  }
  if (!ran.length) return '抓取未完成（时间预算耗尽）。建议改用「粘贴内容」或「上传文件」。';

  const allHttp = ran.every((a) => /^HTTP /.test(a.note));
  if (allHttp) return '所有通道都返回 HTTP 错误码 —— 大概率是文件路径不对（如 404），先确认网址是否指向真实文件。';

  const allBlocked = ran.every((a) => /被浏览器拦截/.test(a.note));
  if (allBlocked && !allowProxy) {
    return '直连被跨域拦截（目标站点未开放 CORS）。勾选「改用公共 CORS 代理重试」，或改用「粘贴内容」/「上传文件」。';
  }
  if (allBlocked) {
    return '直连被跨域拦截，且公共代理当前都不可用（详见下方逐条记录）。建议改用「粘贴内容」或「上传文件」；命令行版本没有跨域限制，也可以用。';
  }

  const anyTimeout = ran.some((a) => /超时/.test(a.note));
  if (anyTimeout) return '部分通道超时 —— 目标站点或公共代理响应太慢。可重试，或改用「粘贴内容」/「上传文件」。';

  return '多个通道都失败了（详见下方逐条记录）。可改用「粘贴内容」或「上传文件」。';
}

export { toMarkdown, toHtml };

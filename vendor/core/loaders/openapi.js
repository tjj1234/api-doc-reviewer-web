// loaders/openapi.js — 解析 OpenAPI / Swagger 文档（JSON 或 YAML）
// 浏览器兼容：不在顶层 import node: 内建模块，仅在 fromFile 分支按需动态引入，
// 因此在浏览器（含网页版 / Chrome 扩展）中直接 import 本文件是安全的。
// js-yaml 通过裸说明符动态引入：Node 走 node_modules，浏览器走 index.html 的 importmap（CDN）。

// 延迟加载 js-yaml（仅 YAML 时需要），避免 JSON 场景的硬依赖
let yaml = null;
async function loadYaml() {
  if (yaml) return yaml;
  try {
    yaml = (await import('js-yaml')).default;
  } catch {
    yaml = null;
  }
  return yaml;
}

function isLikelyYaml(content) {
  // 朴素判断：含冒号分隔且非纯 JSON 结构
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  return /^[\w-]+:/.test(trimmed);
}

// 从文件或字符串解析为 OpenAPI 对象
export async function parseOpenApi(input, { fromFile = false } = {}) {
  let content;
  if (fromFile) {
    const fs = await import('node:fs'); // 仅 Node 文件场景，浏览器不会走到这里
    content = fs.readFileSync(input, 'utf8');
  } else {
    content = input;
  }

  let doc;
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    doc = JSON.parse(content);
  } else if (isLikelyYaml(content)) {
    const y = await loadYaml();
    if (!y) {
      throw new Error('YAML 解析需要 js-yaml，请运行 npm install（或先把文档转成 JSON）。');
    }
    doc = y.load(content);
  } else {
    // 尝试 JSON，失败则当作纯文本（散文）
    try {
      doc = JSON.parse(content);
    } catch {
      throw new Error('无法识别为 OpenAPI JSON/YAML，且非合法 JSON。若这是散文文档，请用 text 加载器。');
    }
  }

  if (!doc || typeof doc !== 'object') {
    throw new Error('OpenAPI 文档为空或格式异常。');
  }
  if (!doc.paths && !doc.swagger && !doc.openapi) {
    throw new Error('未检测到 paths / openapi / swagger 字段，可能不是 OpenAPI 文档。');
  }
  return doc;
}

// 抽取基本信息，供报告与规则使用
export function openApiMeta(doc) {
  const info = doc.info || {};
  const servers = Array.isArray(doc.servers) ? doc.servers.map((s) => s.url) : [];
  const paths = doc.paths || {};
  const opCount = Object.values(paths).reduce((acc, methods) => {
    return acc + Object.keys(methods || {}).filter((m) => !m.startsWith('x-')).length;
  }, 0);
  return {
    kind: 'openapi',
    title: info.title || '(未命名)',
    version: info.version || '',
    openapiVersion: doc.openapi || doc.swagger || '(未知)',
    servers,
    pathCount: Object.keys(paths).length,
    operationCount: opCount,
    hasSecuritySchemes: !!(doc.components && doc.components.securitySchemes),
  };
}

// 遍历所有 operation，回调 (path, method, operation, fullOpPath)
export function eachOperation(doc, cb) {
  const paths = doc.paths || {};
  for (const [p, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== 'object') continue;
    for (const [method, op] of Object.entries(methods)) {
      if (!op || typeof op !== 'object') continue;
      if (method.startsWith('x-')) continue;
      cb(p, method.toUpperCase(), op, `${method.toUpperCase()} ${p}`);
    }
  }
}

export function isOpenApiFile(file) {
  return /\.(json|ya?ml)$/i.test(String(file || ''));
}

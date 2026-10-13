// loaders/index.js — 统一加载入口：自动识别 OpenAPI 或散文，归一化为 doc context
import fs from 'node:fs';
import { parseOpenApi, openApiMeta, isOpenApiFile } from './openapi.js';
import { parseText, textMeta, looksLikeProse } from './text.js';

// 支持的输入形态：
//  - OpenAPI / Swagger 文件（.json/.yaml/.yml）或 JSON/YAML 字符串
//  - 任意 markdown / 散文文档（文件或字符串）
//  - docs 站点 URL：由宿主 agent / 扩展负责把页面内容 fetch 下来后传入（core 不联网）
export async function loadInput(input) {
  let content;
  let isFile = false;
  try {
    if (fs.existsSync(input)) {
      content = fs.readFileSync(input, 'utf8');
      isFile = true;
    }
  } catch {
    // 不是文件路径，当作字符串内容
  }

  if (!isFile) {
    // 可能是 URL —— core 不负责抓取，明确提示
    if (/^https?:\/\//i.test(input.trim())) {
      throw new Error(
        'core 不负责联网抓取 URL。请把页面内容 fetch 后作为字符串/文件传入，' +
        '或由 Chrome 扩展的 background worker 抓取后喂给 core。'
      );
    }
    content = input;
  }

  // 识别形态
  const trimmed = content.trim();
  const maybeOpenApi =
    isFile ? isOpenApiFile(input) : false;
  const hasOpenApiMarker = /"openapi"|"swagger"|openapi\s*:|swagger\s*:/i.test(trimmed.slice(0, 2000));

  if (maybeOpenApi || hasOpenApiMarker) {
    try {
      const doc = await parseOpenApi(content, { fromFile: false });
      const meta = openApiMeta(doc);
      return { kind: 'openapi', doc, raw: content, meta };
    } catch (e) {
      // 标记像 OpenAPI 但解析失败 → 抛出明确错误（不静默降级为散文）
      throw new Error(`识别为 OpenAPI 但解析失败：${e.message}`);
    }
  }

  // 散文 / markdown
  const text = parseText(content, { fromFile: false });
  const meta = textMeta(text);
  return { kind: 'text', doc: text, raw: content, meta };
}

export { parseOpenApi, openApiMeta, parseText, textMeta, looksLikeProse };

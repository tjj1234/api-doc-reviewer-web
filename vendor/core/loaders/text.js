// loaders/text.js — 加载散文 / markdown 文档（docs 站点内容、README、说明文）
// 浏览器兼容：纯字符串处理，不依赖任何 node: 内建模块。
// 文件读取由调用方（CLI 的 loaders/index.js）负责，读完后把字符串传进来。

// 从字符串加载为文本文档。散文形态下，规则引擎主要依赖模型后端做语义判断，
// 但 L0 形态层可先做结构性启发式（标题层级、篇幅、代码块）。
export function parseText(input) {
  const content = input;
  if (!content || !content.trim()) {
    throw new Error('文本文档为空。');
  }
  return content;
}

export function textMeta(text) {
  const lines = text.split(/\r?\n/);
  const headingCount = lines.filter((l) => /^#{1,6}\s+/.test(l)).length;
  const codeFenceCount = (text.match(/```/g) || []).length / 2;
  const hasCurl = /curl\s+/i.test(text);
  const wordCount = text.trim().split(/\s+/).length;
  return {
    kind: 'text',
    title: (text.match(/^#\s+(.+)$/m) || [])[1] || '(无标题)',
    lineCount: lines.length,
    headingCount,
    codeFenceCount,
    hasCurl,
    wordCount,
  };
}

// 判断给定输入是否为散文（非 OpenAPI）。供 loader 入口决策。
export function looksLikeProse(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  if (/^[\w-]+:/.test(trimmed) && /openapi|swagger/i.test(trimmed.slice(0, 400))) return false;
  // 有较多 markdown 标题或自然语言段落 → 视为散文
  return /^#{1,6}\s+/.test(trimmed) || text.length > 200;
}

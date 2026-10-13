// rules/l0-form.js — L0 形态层（机器可读形态）
import { STATUS, SEVERITY, APPLICABILITY } from '../schema.js';

export const rules = [
  {
    id: 'L0-PARSE-001',
    layer: 'L0',
    title: '应提供机器可读的 spec（OpenAPI/Swagger）',
    applicability: { A: APPLICABILITY.Incidental, B: APPLICABILITY.Incidental, C: APPLICABILITY.Recommended },
    membrane: 'static',
    check: '检查是否提供 OpenAPI/Swagger 等可解析 spec，而非只有散文。',
    consequence: '只有散文时，Mode A 无法自动转 tool（需模型抽取，确定性弱）；agent 易漏字段。',
    fix: '提供 OpenAPI JSON/YAML；散文文档至少附结构化字段表或 llms.txt。',
    evaluate(doc, ctx) {
      if (ctx.kind === 'openapi') return { status: STATUS.PASS, severity: SEVERITY.low };
      return {
        status: STATUS.WARNING, severity: SEVERITY.medium,
        evidence: '输入为散文/URL，未提供可解析 spec；Mode A 需模型抽取 schema，确定性弱。',
        fix: '补充 OpenAPI spec，或在散文中给出结构化字段表。',
      };
    },
  },
  {
    id: 'L0-CHUNK-001',
    layer: 'L0',
    title: '散文应利于切片入库（结构清晰）',
    applicability: { A: APPLICABILITY.Incidental, B: APPLICABILITY.Recommended, C: APPLICABILITY.Incidental },
    membrane: 'static',
    check: '检查散文文档是否有清晰标题层级、避免超长无结构段落（利于 RAG 切 chunk 不丢信息）。',
    consequence: '结构混乱的散文切片后语义断裂，RAG agent 召回片段理解不全。',
    fix: '用标题分层、每个接口独立小节、长表格配说明。',
    evaluate(doc, ctx) {
      if (ctx.kind === 'openapi') return { status: STATUS.NOT_APPLICABLE, severity: SEVERITY.low };
      const meta = ctx.meta || {};
      if (meta.headingCount >= 3) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.low, evidence: `标题层级偏少（${meta.headingCount || 0} 个），切片召回可能受损。` };
    },
  },
  {
    id: 'L0-LLMSTXT-001',
    layer: 'L0',
    title: '站点应提供 llms.txt / sitemap（利于 agent 抓取）',
    applicability: { A: APPLICABILITY.NA, B: APPLICABILITY.Incidental, C: APPLICABILITY.Recommended },
    membrane: 'static',
    check: '检查 docs 站点是否提供 llms.txt 或 sitemap，便于 agent/爬虫定位与抓取。',
    consequence: '无 llms.txt/sitemap 时，agent 浏览器模式难发现全部接口页，抓取不全。',
    fix: '在站点根提供 llms.txt 列出文档入口；保留 sitemap.xml。',
    evaluate(doc, ctx) {
      // 静态无法验证 URL 是否存在 llms.txt；仅作提示
      return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '需联网探测 llms.txt/sitemap；core 不联网，请由扩展/宿主 agent 实测后回填。' };
    },
  },
];

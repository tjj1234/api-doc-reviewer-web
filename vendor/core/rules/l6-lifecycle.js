// rules/l6-lifecycle.js — L6 生命周期层（deprecated / 可发现 / changelog）
import { STATUS, SEVERITY, APPLICABILITY } from '../schema.js';
import { eachOperation } from '../loaders/openapi.js';

export const rules = [
  {
    id: 'L6-DEP-001',
    layer: 'L6',
    title: 'deprecated 字段/接口应标注并提供替代',
    applicability: { A: APPLICABILITY.Incidental, B: APPLICABILITY.Recommended, C: APPLICABILITY.NA },
    membrane: 'static',
    check: '检查 deprecated 字段/操作是否标注 deprecated:true 并给出替代方案。',
    consequence: 'agent 调已废弃接口拿到不稳定行为；RAG 召回废弃片段误导。',
    fix: '标 deprecated:true；描述中给出「改用 X」。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型判断，未配置跳过。' };
      const dep = [];
      eachOperation(doc, (p, method, op) => { if (op.deprecated) dep.push(`${method} ${p}`); });
      // 也扫描 components.schemas 中 deprecated 属性
      const schemas = doc.components?.schemas || {};
      let deprecatedProps = 0;
      for (const s of Object.values(schemas)) {
        const props = s?.properties || {};
        for (const v of Object.values(props)) if (v?.deprecated) deprecatedProps++;
      }
      if (!dep.length && deprecatedProps === 0) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.low, evidence: `检测到 deprecated 操作 ${dep.length} 处、deprecated 属性 ${deprecatedProps} 个，请确认均已提供替代说明。` };
    },
  },
  {
    id: 'L6-DISCOVER-001',
    layer: 'L6',
    title: '应有利于召回的标题/标签/关键词',
    applicability: { A: APPLICABILITY.NA, B: APPLICABILITY.Recommended, C: APPLICABILITY.NA },
    membrane: 'static',
    check: '检查 RAG 场景下文档是否有清晰标题、标签、同义表述，利于被检索召回。',
    consequence: '标题/关键词缺失，agent 用「退款」检索不到只写 return 的片段。',
    fix: '接口标题含业务同义词；加 tags/keywords；描述覆盖常见问法。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型判断关键词覆盖，未配置跳过。' };
      const tagOps = [];
      eachOperation(doc, (p, method, op) => { if (!op.tags || !op.tags.length) tagOps.push(`${method} ${p}`); });
      if (tagOps.length === 0) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: `有 ${tagOps.length} 个操作未打 tags；RAG 召回建议补 tags/关键词（模型可进一步评估同义覆盖）。` };
    },
  },
  {
    id: 'L6-CHANGE-001',
    layer: 'L6',
    title: '应记录 changelog / breaking change',
    applicability: { A: APPLICABILITY.Incidental, B: APPLICABILITY.Recommended, C: APPLICABILITY.NA },
    membrane: 'static',
    check: '检查是否提供 changelog 或版本说明，便于 agent/人判断兼容性。',
    consequence: '无 changelog 时，接口悄然变更 agent 难以察觉，调用行为漂移。',
    fix: '维护 changelog，标注 breaking change 与迁移步骤。',
    evaluate(doc, ctx) {
      const txt = ctx.kind === 'openapi' ? JSON.stringify(doc).slice(0, 40000).toLowerCase() : (ctx.doc || '').slice(0, 40000).toLowerCase();
      if (/changelog|变更日志|迁移|migration|breaking change|版本说明/.test(txt)) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '未检测到 changelog/版本说明；建议维护（changelog 通常在文档站独立页，core 不易抓取）。' };
    },
  },
];

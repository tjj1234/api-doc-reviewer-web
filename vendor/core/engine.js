// engine.js — 审查编排核心（agent-agnostic）
// 输入：已加载的 doc context + 模式 + 模型配置 + 动态膜开关
// 输出：标准化 findings + 覆盖声明（coverage）+ 动态膜结果
import { allRules } from './rules/index.js';
import { isRuleApplicable } from './modes.js';
import { makeFinding, STATUS, APPLICABILITY } from './schema.js';
import { runDynamicMembrane } from './dynamic/probe.js';

export async function review(ctx) {
  const { mode = 'A' } = ctx;
  const findings = [];

  for (const rule of allRules) {
    // 1) 模式过滤：该模式不适用 → NOT_APPLICABLE，不运行
    if (!isRuleApplicable(rule, mode)) {
      findings.push(makeFinding(rule, mode, {
        status: STATUS.NOT_APPLICABLE, severity: 'low',
        note: `模式 ${mode} 不查此层。`,
      }));
      continue;
    }
    // 2) 运行 evaluate
    try {
      const result = await rule.evaluate(ctx.doc, ctx);
      findings.push(makeFinding(rule, mode, result || {}));
    } catch (e) {
      findings.push(makeFinding(rule, mode, {
        status: STATUS.ERROR, severity: 'low',
        evidence: `规则运行异常：${e.message}`,
      }));
    }
  }

  // 3) 动态膜（可选）
  const dynamic = runDynamicMembrane(ctx.dynamic?.target, ctx.dynamic?.creds, {
    enabled: !!ctx.dynamic?.enabled,
  });

  // 4) 覆盖声明：哪些没测、为什么（PRD 原则：未测≠通过，不适用≠失败）
  const coverage = buildCoverage(findings, dynamic, ctx);

  return {
    meta: ctx.meta,
    mode,
    modeName: ctx.modeName,
    findings,
    dynamic,
    coverage,
    summary: summarize(findings),
  };
}

function buildCoverage(findings, dynamic, ctx) {
  const notTested = findings.filter((f) => f.status === STATUS.NOT_TESTED);
  const notApplicable = findings.filter((f) => f.status === STATUS.NOT_APPLICABLE);
  // 互斥归类：每条未测项只归入第一个命中的原因，避免重复
  const buckets = {
    '未配置模型后端': [],
    '散文形态需语义判断': [],
    '动态膜未启用': [],
    '需联网/外部资源': [],
    '人工确认': [],
    '其他未测项': [],
  };
  const matchReason = (f) => {
    const t = `${f.note || ''} ${f.evidence || ''}`;
    if (/动态膜/.test(f.note || '')) return '动态膜未启用';
    if (/模型/.test(t)) return '未配置模型后端';
    if (/散文/.test(t)) return '散文形态需语义判断';
    if (/联网|URL|changelog|llms/.test(t)) return '需联网/外部资源';
    if (/人工/.test(t)) return '人工确认';
    return '其他未测项';
  };
  for (const f of notTested) buckets[matchReason(f)].push(f);

  return {
    total: findings.length,
    byStatus: countBy(findings, 'status'),
    notApplicableCount: notApplicable.length,
    notTestedCount: notTested.length,
    dynamicEnabled: dynamic.enabled,
    dynamicNotTested: dynamic.results.filter((r) => r.status === STATUS.NOT_TESTED).length,
    reasons: buckets,
  };
}

function countBy(arr, key) {
  const m = {};
  for (const x of arr) m[x[key]] = (m[x[key]] || 0) + 1;
  return m;
}

function summarize(findings) {
  const fail = findings.filter((f) => f.status === STATUS.FAIL).length;
  const warn = findings.filter((f) => f.status === STATUS.WARNING).length;
  const pass = findings.filter((f) => f.status === STATUS.PASS).length;
  const critical = findings.filter((f) => f.severity === 'critical' && (f.status === STATUS.FAIL || f.status === STATUS.WARNING)).length;
  return { fail, warn, pass, critical };
}

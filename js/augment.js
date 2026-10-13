// js/augment.js — hosted 模型补判（网页版专属增强层）
// ----------------------------------------------------------------------------
// 定位：core 规则引擎只做确定性检查，语义项（前置条件/租户隔离/changelog 这类
// 「要读懂内容才能判」的）静态判不了，落 NOT_TESTED。本模块把这些未测项连同
// 文档证据发给 OpenAI-compatible 模型补判，结果合并回报告，并标注来源。
//
// 为什么放网页层而不是 core：
//   1. core 要跨 agent 可移植（CLI 里规则引擎保持零模型依赖）；
//   2. 「宿主 agent 替核心补判」正是架构里的 Agent-hosted 模式 ——
//      规则引擎出结构结论，模型层出语义结论，两层都写进同一份报告。
//   3. 模型调用失败时优雅降级：该项保持 NOT_TESTED，绝不伪造结论。
// ----------------------------------------------------------------------------
import { callModel } from '../vendor/core/model/backend.js';
import { STATUS, SEVERITY } from '../vendor/core/schema.js';

// 可补判的规则：NOT_TESTED 中「缺的是语义判断」的项。
// 动态膜未启用/模式不适应的项不在其列——那些不是模型能补的。
export const AUGMENTABLE = new Set([
  'L2-PRECOND-001', // 隐藏前置条件
  'L2-WHEN-001',    // 何时该用（散文形态时）
  'L2-AMBIG-001',   // 字段含义无歧义（散文形态时）
  'L5-TENANT-001',  // 租户/越权隔离边界
  'L6-CHANGE-001',  // changelog / breaking change
]);

const VALID_STATUS = new Set([STATUS.PASS, STATUS.FAIL, STATUS.WARNING]);
const VALID_SEVERITY = new Set([SEVERITY.critical, SEVERITY.high, SEVERITY.medium, SEVERITY.low]);

// 哪些 finding 需要补判
export function needsAugmentation(report) {
  return (report?.findings || []).filter(
    (f) => f.status === STATUS.NOT_TESTED && AUGMENTABLE.has(f.rule_id),
  );
}

// 构造给模型的文档证据（控制体量：spec 只取描述性内容，散文取前若干字符）
export function buildEvidence(loaded, maxChars = 7000) {
  if (!loaded) return '';
  if (loaded.kind === 'openapi' && loaded.doc) {
    const doc = loaded.doc;
    const parts = [];
    if (doc.info?.title) parts.push(`【标题】${doc.info.title} ${doc.info.version || ''}`);
    if (doc.info?.description) parts.push(`【总体说明】\n${doc.info.description}`);
    if (Array.isArray(doc.servers) && doc.servers.length) {
      parts.push(`【Server 地址】\n${doc.servers.map((s) => `${s.url} — ${s.description || ''}`).join('\n')}`);
    }
    const sec = doc.components?.securitySchemes || {};
    if (Object.keys(sec).length) {
      parts.push(`【鉴权方式】\n${JSON.stringify(sec).slice(0, 800)}`);
    }
    const ops = [];
    for (const [p, methods] of Object.entries(doc.paths || {})) {
      for (const [m, op] of Object.entries(methods || {})) {
        if (m.startsWith('x-') || !op || typeof op !== 'object') continue;
        const desc = [op.summary, op.description].filter(Boolean).join(' — ');
        if (desc) ops.push(`${m.toUpperCase()} ${p}：${desc}`);
      }
    }
    if (ops.length) parts.push(`【接口描述】\n${ops.join('\n')}`);
    const out = parts.join('\n\n');
    return out.length > maxChars ? out.slice(0, maxChars) + '\n…（已截断）' : out;
  }
  const raw = String(loaded?.raw || loaded?.doc || '');
  return raw.length > maxChars ? raw.slice(0, maxChars) + '\n…（已截断）' : raw;
}

// 单条补判：让模型给出 {status, severity, evidence, fix}
async function judgeOne(finding, evidence, modelCfg) {
  const system =
    '你是 API 文档的 agent 可用性审查员。规则引擎只能做结构化检查，下面这项需要读懂文档内容才能判定。' +
    '请基于给定文档内容给出严格、可验证的结论。只输出 JSON，不要输出任何其他文字或代码块标记。';
  const user =
    `【检查项】${finding.title}\n` +
    `【检查标准】${finding.check}\n` +
    `【不符合的后果】${finding.consequence}\n` +
    `【修改方向】${finding.fix}\n\n` +
    `【待审文档内容（可能被截断）】\n${evidence || '(未能提取到文档内容)'}\n\n` +
    `请判定并只输出 JSON：\n` +
    `{"status":"PASS|FAIL|WARNING","severity":"critical|high|medium|low","evidence":"判定依据：引用文档原文，或明确指出缺失了什么","fix":"如需修改，给出具体改法（含关键文案）；如无需修改写 null"}`;

  const raw = await callModel({ model: modelCfg }, system, user, { temperature: 0.1, maxTokens: 900 });
  return parseVerdict(raw);
}

// 容错解析：模型可能包 markdown 代码块 / 前后废话
export function parseVerdict(raw) {
  const text = String(raw || '');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('模型输出中未找到 JSON');
  const obj = JSON.parse(m[0]);
  if (!VALID_STATUS.has(obj.status)) throw new Error(`模型返回了非法 status: ${obj.status}`);
  return {
    status: obj.status,
    severity: VALID_SEVERITY.has(obj.severity) ? obj.severity : undefined,
    evidence: typeof obj.evidence === 'string' ? obj.evidence.trim() : '',
    fix: typeof obj.fix === 'string' && obj.fix && obj.fix !== 'null' ? obj.fix.trim() : null,
  };
}

// 补判主入口：就地更新 report.findings，并重算 coverage / summary。
// onProgress({ done, total, ruleId, ok, error }) 每完成一条回调一次。
export async function augmentWithModel(report, loaded, modelCfg, onProgress) {
  const targets = needsAugmentation(report);
  const result = { augmented: [], failed: [] };
  if (!targets.length || !modelCfg?.api_key) return result;

  const evidence = buildEvidence(loaded);
  for (let i = 0; i < targets.length; i++) {
    const f = targets[i];
    try {
      const v = await judgeOne(f, evidence, modelCfg);
      f.status = v.status;
      if (v.severity) f.severity = v.severity;
      if (v.evidence) f.evidence = v.evidence;
      if (v.fix) f.fix = v.fix;
      f.source = 'model';
      f.note = `规则引擎无法静态判定，由模型补判（${modelCfg.model || 'OpenAI-compatible'}）`;
      result.augmented.push(f.rule_id);
      onProgress?.({ done: i + 1, total: targets.length, ruleId: f.rule_id, ok: true });
    } catch (e) {
      // 失败保持 NOT_TESTED，写进 note 说明原因——不伪造、不阻塞
      f.note = `${f.note || ''}；模型补判失败：${String(e.message).slice(0, 120)}`;
      result.failed.push({ ruleId: f.rule_id, error: String(e.message).slice(0, 200) });
      onProgress?.({ done: i + 1, total: targets.length, ruleId: f.rule_id, ok: false, error: e.message });
    }
  }

  recompute(report);
  return result;
}

// 补判后重算统计（byStatus / notTestedCount / summary / reasons）
export function recompute(report) {
  const { findings, dynamic } = report;
  const byStatus = {};
  for (const f of findings) byStatus[f.status] = (byStatus[f.status] || 0) + 1;
  const notTested = findings.filter((f) => f.status === STATUS.NOT_TESTED);
  report.coverage.byStatus = byStatus;
  report.coverage.notTestedCount = notTested.length;
  report.coverage.dynamicNotTested = dynamic.results.filter((r) => r.status === STATUS.NOT_TESTED).length;
  // reasons 重建：被补判掉的项自动离开未测清单
  const reasons = {};
  const matchReason = (f) => {
    const t = `${f.note || ''} ${f.evidence || ''}`;
    if (/动态膜/.test(f.note || '')) return '动态膜未启用';
    if (/模型/.test(t)) return '未配置模型后端';
    if (/散文/.test(t)) return '散文形态需语义判断';
    if (/联网|URL|changelog|llms/.test(t)) return '需联网/外部资源';
    if (/人工/.test(t)) return '人工确认';
    return '其他未测项';
  };
  for (const f of notTested) {
    const k = matchReason(f);
    (reasons[k] = reasons[k] || []).push(f);
  }
  report.coverage.reasons = reasons;
  report.summary = {
    fail: findings.filter((f) => f.status === STATUS.FAIL).length,
    warn: findings.filter((f) => f.status === STATUS.WARNING).length,
    pass: findings.filter((f) => f.status === STATUS.PASS).length,
    critical: findings.filter((f) => f.severity === 'critical' && (f.status === STATUS.FAIL || f.status === STATUS.WARNING)).length,
  };
  return report;
}

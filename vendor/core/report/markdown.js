// report/markdown.js — Markdown 报告生成器（report-ready，可直接贴 Github/IM）
import { LAYERS, STATUS_LABEL, SEVERITY_LABEL, APPLICABILITY_LABEL, STATUS } from '../schema.js';

export function toMarkdown(report) {
  const { meta, mode, modeName, findings, coverage, summary, dynamic } = report;
  const L = (s) => STATUS_LABEL[s] || s;
  const lines = [];

  lines.push(`# API 文档 Agent 可用性审查报告`);
  lines.push('');
  lines.push(`- **目标消费模式**：${mode} · ${modeName}`);
  lines.push(`- **文档**：${meta?.title || '(未命名)'}（${meta?.kind === 'openapi' ? `OpenAPI ${meta.openapiVersion}` : '散文/URL'}）`);
  if (meta?.kind === 'openapi') {
    lines.push(`- **接口数**：${meta.operationCount} 个操作 / ${meta.pathCount} 条路径`);
  }
  lines.push(`- **时间**：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
  lines.push('');

  // 首节：覆盖声明（PRD 原则：未测≠通过，不适用≠失败）
  lines.push(`## 0. 覆盖声明（重要）`);
  lines.push('');
  lines.push(`本报告共 ${coverage.total} 条检查，按状态分布：`);
  lines.push('');
  const dist = coverage.byStatus;
  lines.push(`| 状态 | 数量 |`);
  lines.push(`| --- | --- |`);
  for (const s of [STATUS.PASS, STATUS.FAIL, STATUS.WARNING, STATUS.NOT_APPLICABLE, STATUS.NOT_TESTED, STATUS.ERROR]) {
    if (dist[s]) lines.push(`| ${L(s)} | ${dist[s]} |`);
  }
  lines.push('');
  lines.push(`> **未测（NOT_TESTED）≠ 通过；不适用（N/A）≠ 失败。** 以下项因缺少输入形态/模型后端/动态凭据而未能定论，需补条件后复测：`);
  for (const [reason, arr] of Object.entries(coverage.reasons)) {
    if (!arr || !arr.length) continue;
    lines.push(`- **${reason}**：${arr.map((f) => f.rule_id).join('、')}`);
  }
  if (!dynamic.enabled) {
    lines.push(`- **动态膜（实测真实 API）未启用**：14 条探针种子均未实测（见文末「动态膜探针」）。如需开启，请提供测试凭据/沙箱。`);
  } else {
    lines.push(`- 动态膜已启用，其中 ${coverage.dynamicNotTested} 条探针因安全护栏未自动执行（写操作/复杂编排）。`);
  }
  lines.push('');

  // 摘要
  lines.push(`## 1. 摘要`);
  lines.push('');
  lines.push(`- 未通过（FAIL）：${summary.fail}`);
  lines.push(`- 警告（WARNING）：${summary.warn}`);
  lines.push(`- 通过（PASS）：${summary.pass}`);
  lines.push(`- 严重（critical）问题：${summary.critical}`);
  lines.push('');

  // 逐层发现
  lines.push(`## 2. 逐层发现（按检查什么 → 后果 → 修改）`);
  lines.push('');
  for (const layerId of Object.keys(LAYERS)) {
    const layerFindings = findings.filter((f) => f.layer === layerId && f.status !== STATUS.NOT_APPLICABLE);
    if (!layerFindings.length) continue;
    lines.push(`### ${layerId} · ${LAYERS[layerId]}`);
    lines.push('');
    for (const f of layerFindings) {
      lines.push(`#### [${L(f.status)}] ${f.title} \`${f.rule_id}\``);
      lines.push('');
      lines.push(`- **适用性**：${APPLICABILITY_LABEL[f.applicability] || f.applicability} ｜ **严重度**：${SEVERITY_LABEL[f.severity] || f.severity} ｜ **膜**：${f.membrane === 'dynamic' ? '动态' : '静态'}`);
      lines.push(`- **检查什么**：${f.check}`);
      lines.push(`- **不符合的后果（agent 怎么踩）**：${f.consequence}`);
      if (f.evidence) lines.push(`- **证据**：${f.evidence}`);
      lines.push(`- **应该如何修改**：${f.fix}`);
      if (f.before) {
        lines.push('');
        lines.push(`\`\`\``);
        lines.push(f.before);
        lines.push(`\`\`\``);
      }
      if (f.after) {
        lines.push('');
        lines.push(`改为：`);
        lines.push(`\`\`\``);
        lines.push(f.after);
        lines.push(`\`\`\``);
      }
      if (f.note) lines.push(`- **备注**：${f.note}`);
      lines.push('');
    }
  }

  // 动态膜探针
  lines.push(`## 3. 动态膜探针（来自 PT 视频 skill 踩坑档案测试集）`);
  lines.push('');
  if (!dynamic.enabled) {
    lines.push(`动态膜未启用。以下 14 条探针种子代表「文档写的 ≠ 网关真实行为」的已发生踩坑，建议开启动态膜实测：`);
    lines.push('');
  }
  for (const r of dynamic.results) {
    lines.push(`- \`${r.seed_id}\`（${r.pit}，${r.layer}）：${r.what}${r.note ? ` — ${r.note}` : ''}`);
  }
  lines.push('');

  lines.push(`---`);
  lines.push(`*由 api-doc-reviewer core 生成 · 可移植跨 WorkBuddy / Claude / Cursor / Trae*`);

  return lines.join('\n');
}

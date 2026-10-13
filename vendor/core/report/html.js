// report/html.js — 单文件 HTML 信息图报告（浅色主题，report-ready，可导出/截图汇报）
import { LAYERS, STATUS_LABEL, STATUS_COLOR, SEVERITY_LABEL, APPLICABILITY_LABEL, STATUS } from '../schema.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export function toHtml(report) {
  const { meta, mode, modeName, findings, coverage, summary, dynamic } = report;
  const L = (s) => STATUS_LABEL[s] || s;

  const statCards = `
    <div class="stats">
      <div class="stat fail"><span>${summary.fail}</span>未通过</div>
      <div class="stat warn"><span>${summary.warn}</span>警告</div>
      <div class="stat pass"><span>${summary.pass}</span>通过</div>
      <div class="stat crit"><span>${summary.critical}</span>严重</div>
    </div>`;

  let layersHtml = '';
  for (const layerId of Object.keys(LAYERS)) {
    const lf = findings.filter((f) => f.layer === layerId && f.status !== STATUS.NOT_APPLICABLE);
    if (!lf.length) continue;
    const cards = lf.map((f) => findingCard(f, L)).join('');
    layersHtml += `
      <section class="layer">
        <h3>${esc(layerId)} · ${esc(LAYERS[layerId])}</h3>
        ${cards}
      </section>`;
  }

  const coverageReasons = Object.entries(coverage.reasons)
    .filter(([, arr]) => arr && arr.length)
    .map(([reason, arr]) => `<li><b>${esc(reason)}</b>：${arr.map((f) => esc(f.rule_id)).join('、')}</li>`)
    .join('');

  const dynHtml = dynamic.results.map((r) =>
    `<li><code>${esc(r.seed_id)}</code> <span class="pit">(${esc(r.pit)}, ${esc(r.layer)})</span> ${esc(r.what)}${r.note ? ` — <i>${esc(r.note)}</i>` : ''}</li>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API 文档 Agent 可用性审查报告</title>
<style>
  :root{ --bg:#ffffff; --fg:#1f2328; --muted:#6e7781; --border:#d0d7de; --accent:#0969da; }
  *{box-sizing:border-box}
  body{font-family:-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:32px;line-height:1.6}
  .wrap{max-width:960px;margin:0 auto}
  h1{font-size:24px;margin:0 0 4px}
  h3{font-size:17px;border-left:4px solid var(--accent);padding-left:10px;margin:28px 0 12px}
  .sub{color:var(--muted);font-size:13px;margin-bottom:20px}
  .banner{background:#fff8e6;border:1px solid #f0d58c;border-radius:8px;padding:14px 16px;font-size:13px}
  .banner b{color:#9a6700}
  .stats{display:flex;gap:12px;margin:18px 0}
  .stat{flex:1;border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}
  .stat span{display:block;font-size:26px;font-weight:700}
  .stat.fail span{color:#cf222e}.stat.warn span{color:#9a6700}.stat.pass span{color:#1a7f37}.stat.crit span{color:#bf3989}
  .card{border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin:10px 0}
  .card h4{margin:0 0 6px;font-size:15px}
  .meta{font-size:12px;color:var(--muted);margin-bottom:8px}
  .badge{display:inline-block;padding:1px 8px;border-radius:10px;color:#fff;font-size:11px;font-weight:600;margin-right:6px}
  .kv{margin:6px 0}.kv b{color:var(--fg)}
  pre{background:#f6f8fa;border:1px solid var(--border);border-radius:6px;padding:10px;overflow:auto;font-size:12px}
  code{background:#eff1f3;padding:1px 5px;border-radius:4px;font-size:12px}
  .layer{border-top:1px dashed var(--border);padding-top:6px}
  ul{margin:8px 0;padding-left:20px}
  footer{margin-top:30px;color:var(--muted);font-size:12px;border-top:1px solid var(--border);padding-top:12px}
</style></head>
<body><div class="wrap">
  <h1>API 文档 Agent 可用性审查报告</h1>
  <div class="sub">目标模式：<b>${esc(mode)} · ${esc(modeName)}</b> ｜ 文档：${esc(meta?.title || '(未命名)')}（${meta?.kind === 'openapi' ? `OpenAPI ${esc(meta.openapiVersion)}` : '散文/URL'}）｜ ${new Date().toISOString().slice(0, 10)}</div>

  <div class="banner">
    <b>覆盖声明（重要）：</b> 未测（NOT_TESTED）≠ 通过；不适用（N/A）≠ 失败。本次共 ${coverage.total} 条检查，未测 ${coverage.notTestedCount} 条、不适用 ${coverage.notApplicableCount} 条。需补条件（输入形态/模型后端/动态凭据）后复测：
    <ul>${coverageReasons || '<li>无</li>'}</ul>
    ${dynamic.enabled ? `动态膜已启用，其中 ${coverage.dynamicNotTested} 条探针因安全护栏未自动执行。` : `动态膜未启用：14 条探针种子均未实测（见文末）。`}
  </div>

  ${statCards}

  ${layersHtml}

  <section class="layer">
    <h3>动态膜探针（来自 PT 视频 skill 踩坑档案测试集）</h3>
    <ul>${dynHtml}</ul>
  </section>

  <footer>由 api-doc-reviewer core 生成 · 可移植跨 WorkBuddy / Claude / Cursor / Trae</footer>
</div></body></html>`;
}

function findingCard(f, L) {
  const color = STATUS_COLOR[f.status] || '#6e7781';
  const before = f.before ? `<pre>${esc(f.before)}</pre>` : '';
  const after = f.after ? `<p>改为：</p><pre>${esc(f.after)}</pre>` : '';
  const srcBadge = f.source === 'model'
    ? ' <span class="badge" style="background:#6b4fbb" title="规则引擎无法静态判定，由模型基于文档内容补出">模型补判</span>'
    : f.source === 'manual'
      ? ' <span class="badge" style="background:#1a7f37" title="规则引擎无法静态判定，由 agent 人工复核文档原文定论">人工复核</span>'
      : '';
  return `<div class="card">
    <h4><span class="badge" style="background:${color}">${esc(L(f.status))}</span>${esc(f.title)} <code>${esc(f.rule_id)}</code>${srcBadge}</h4>
    <div class="meta">适用性：${esc(APPLICABILITY_LABEL[f.applicability] || f.applicability)} ｜ 严重度：${esc(SEVERITY_LABEL[f.severity] || f.severity)} ｜ 膜：${f.membrane === 'dynamic' ? '动态' : '静态'}</div>
    <div class="kv"><b>检查什么：</b>${esc(f.check)}</div>
    <div class="kv"><b>不符合的后果（agent 怎么踩）：</b>${esc(f.consequence)}</div>
    ${f.evidence ? `<div class="kv"><b>证据：</b>${esc(f.evidence)}</div>` : ''}
    <div class="kv"><b>应该如何修改：</b>${esc(f.fix)}</div>
    ${before}${after}
    ${f.note ? `<div class="kv"><i>备注：${esc(f.note)}</i></div>` : ''}
  </div>`;
}

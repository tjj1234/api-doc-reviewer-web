// app.js — 网页版 UI 逻辑
// 渲染用转义后的 innerHTML：被审查的文档是不可信输入，evidence 里可能夹带 HTML。
import { runReview, fetchUrl, toMarkdown, toHtml } from './review.js';
import {
  LAYERS, STATUS, STATUS_LABEL, SEVERITY_LABEL, APPLICABILITY_LABEL,
} from '../vendor/core/schema.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

let current = null; // 最近一次审查结果 { report, loaded, mode }
let currentFilter = 'all';

// ---------- 输入区交互 ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-active'));
    document.querySelectorAll('.tabpanel').forEach((p) => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    $(`#panel-${tab.dataset.tab}`).classList.add('is-active');
  });
});

document.querySelectorAll('.mode-card input').forEach((radio) => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.mode-card').forEach((c) => {
      c.classList.toggle('is-active', c.contains(radio) && radio.checked);
    });
  });
});

$('#model-enable').addEventListener('change', (e) => {
  $('#model-fields').hidden = !e.target.checked;
});

// ---------- 模型配置的本机记忆 ----------
const STORE_KEY = 'adr.modelConfig';
function loadStored() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const cfg = JSON.parse(raw);
    if (cfg.base_url) $('#model-base').value = cfg.base_url;
    if (cfg.model) $('#model-name').value = cfg.model;
    if (cfg.api_key) $('#model-key').value = cfg.api_key;
    $('#model-remember').checked = true;
  } catch { /* 忽略损坏的存储 */ }
}
function saveStored(cfg) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch { /* 隐私模式下可能失败 */ }
}
function clearStored() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* noop */ }
}
loadStored();

// ---------- 示例文档 ----------
$('#btn-sample').addEventListener('click', async () => {
  try {
    const resp = await fetch('examples/bad-openapi.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    switchTab('paste');
    $('#input-text').value = text;
    setStatus('已加载示例文档（故意造了缺陷的 OpenAPI），点「开始审查」试试。');
  } catch (e) {
    setStatus(`示例加载失败：${e.message}`);
  }
});

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('is-active', on);
    $(`#panel-${t.dataset.tab}`).classList.toggle('is-active', on);
  });
}

function setStatus(msg) {
  $('#run-status').textContent = msg || '';
}

// ---------- 抓取过程的可视化 ----------
// 抓取失败时最忌讳只甩一句「失败了」——把每一步（直连 / 各代理）的结果都摊开，
// 用户才知道到底是网址错、跨域拦、还是代理挂了。
function shortenUrl(u, max = 58) {
  const s = String(u || '');
  if (s.length <= max) return s;
  try {
    const o = new URL(s);
    const head = o.origin;
    const rest = s.slice(head.length);
    return `${head}…${rest.slice(-(max - head.length - 1))}`;
  } catch {
    return `${s.slice(0, max - 1)}…`;
  }
}

function renderFetchLog(attempts) {
  const box = $('#url-log');
  if (!attempts || !attempts.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.innerHTML = attempts.map((a) => {
    const icon = { ok: '✓', running: '⋯', fail: '✕', skip: '–' }[a.state] || '·';
    return `<div class="log-row log-${esc(a.state)}">
      <span class="log-icon">${icon}</span>
      <span class="log-label">${esc(a.label)}</span>
      <span class="log-target" title="${esc(a.target)}">${esc(shortenUrl(a.target))}</span>
      <span class="log-note">${esc(a.note)}</span>
    </div>`;
  }).join('');
}

function showFetchFallback(message) {
  const box = $('#url-fallback');
  box.hidden = false;
  box.innerHTML = `<p class="callout-title">抓取失败</p>`
    + `<p>${esc(message)}</p>`
    + `<p class="callout-actions">`
    + `<button class="btn" id="btn-goto-paste">改用粘贴内容</button>`
    + `<button class="btn" id="btn-goto-file">改用上传文件</button>`
    + `</p>`;
  $('#btn-goto-paste')?.addEventListener('click', () => { switchTab('paste'); $('#input-text').focus(); });
  $('#btn-goto-file')?.addEventListener('click', () => { switchTab('file'); $('#input-file').focus(); });
}

function clearFetchFallback() {
  const box = $('#url-fallback');
  box.hidden = true;
  box.innerHTML = '';
}

// ---------- 读取当前输入 ----------
async function collectInput() {
  const activeTab = document.querySelector('.tab.is-active').dataset.tab;

  if (activeTab === 'paste') {
    const text = $('#input-text').value;
    if (!text.trim()) throw new Error('请先粘贴文档内容，或点「加载示例文档」。');
    return { content: text, filename: '' };
  }

  if (activeTab === 'file') {
    const file = $('#input-file').files?.[0];
    if (!file) throw new Error('请先选择一个文件。');
    const text = await file.text();
    return { content: text, filename: file.name };
  }

  // url
  const url = $('#input-url').value.trim();
  if (!url) throw new Error('请先填写文档网址。');
  clearFetchFallback();
  renderFetchLog([]);
  setStatus('正在抓取…（直连失败会自动回退到代理，稍等）');
  // 抓取计时器：让任何卡顿都可见（曾出现 fetch promise 偶发不 settle，页面干等）
  const fetchT0 = Date.now();
  const fetchTicker = setInterval(() => {
    const s = Math.round((Date.now() - fetchT0) / 1000);
    setStatus(`正在抓取…已等待 ${s}s（单步上限 10s，总预算 30s，超时自动失败）`);
  }, 1000);
  try {
    const res = await fetchUrl(url, {
      allowProxy: $('#url-proxy').checked,
      customProxy: $('#url-custom-proxy').value.trim(),
      onProgress: renderFetchLog,
    });
    renderFetchLog(res.attempts);
    const kindNote = res.kind === 'html'
      ? ' ⚠️ 抓到的是网页 HTML，可能不是 spec 本体；若文档由 JS 动态渲染，请改用粘贴/上传。'
      : '';
    $('#url-note').textContent = `抓取成功（${res.via}），共 ${res.text.length} 字符，内容判定：${res.kind === 'spec' ? 'OpenAPI 规格' : res.kind === 'html' ? '网页 HTML' : '文本'}。${kindNote}`;
    return { content: res.text, filename: res.url };
  } catch (e) {
    if (e.attempts) renderFetchLog(e.attempts);
    showFetchFallback(e.message);
    throw e;
  } finally {
    clearInterval(fetchTicker);
  }
}

function collectModel() {
  if (!$('#model-enable').checked) return null;
  const cfg = {
    base_url: $('#model-base').value.trim(),
    api_key: $('#model-key').value.trim(),
    model: $('#model-name').value.trim() || 'gpt-4o-mini',
  };
  if (!cfg.api_key) throw new Error('启用了模型后端，但未填写 API Key。');
  if ($('#model-remember').checked) saveStored(cfg);
  else clearStored();
  return cfg;
}

// ---------- 运行审查 ----------
$('#btn-run').addEventListener('click', async () => {
  const btn = $('#btn-run');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '处理中…';
  try {
    setStatus('正在加载文档…');
    const { content, filename } = await collectInput();
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const model = collectModel();

    setStatus('正在审查…');
    const { report, loaded, augment } = await runReview({
      content, filename, mode, model,
      onAugment: (p) => setStatus(
        `模型补判中… ${p.done}/${p.total}（${p.ruleId}${p.ok ? '' : ' · 失败，保持未测'}）`,
      ),
    });
    current = { report, loaded, mode, augment };
    currentFilter = 'all';
    renderResult(current);
    $('#result').hidden = false;
    const augNote = augment.augmented.length
      ? ` · 模型补判 ${augment.augmented.length} 项${augment.failed.length ? `（${augment.failed.length} 项失败，保持未测）` : ''}`
      : '';
    setStatus(`完成 · ${loaded.meta.title}（${loaded.kind === 'openapi' ? 'OpenAPI' : '散文'}）${augNote}`);
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    setStatus(`失败：${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

// ---------- 渲染结果 ----------
function renderResult({ report, loaded, mode, augment }) {
  const s = report.summary;
  const cov = report.coverage;

  const stats = `
    <div class="summary">
      <div class="stat"><div class="stat-num" style="color:var(--fail)">${s.fail}</div><div class="stat-label">未通过</div></div>
      <div class="stat"><div class="stat-num" style="color:var(--warn)">${s.warn}</div><div class="stat-label">警告</div></div>
      <div class="stat"><div class="stat-num" style="color:var(--pass)">${s.pass}</div><div class="stat-label">通过</div></div>
      <div class="stat"><div class="stat-num">${s.critical}</div><div class="stat-label">严重级</div></div>
      <div class="stat"><div class="stat-num" style="color:var(--untested)">${cov.notTestedCount}</div><div class="stat-label">未测</div></div>
      <div class="stat"><div class="stat-num" style="color:var(--na)">${cov.notApplicableCount}</div><div class="stat-label">不适用</div></div>
    </div>`;

  // 覆盖声明是强制首节：说清没测什么、为什么没测
  const reasonItems = Object.entries(cov.reasons || {})
    .filter(([, arr]) => arr.length)
    .map(([reason, arr]) => `<li>${esc(reason)} —— ${arr.length} 项</li>`)
    .join('');

  // 补判说明：静态规则判不了的语义项由模型补上时，明确告诉用户结论的来源
  const augItems = (augment?.augmented || []).length
    ? `<p>✅ 其中 <strong>${augment.augmented.length}</strong> 项由模型补判定论（finding 上有「模型补判」徽标）：${augment.augmented.join('、')}${augment.failed.length ? `；${augment.failed.length} 项补判失败，保持未测` : ''}。</p>`
    : '';

  const coverage = `
    <div class="coverage">
      <h3>覆盖声明（先看这里）</h3>
      <p><strong>未测 ≠ 通过，不适用 ≠ 失败。</strong>本次共 ${cov.total} 条检查，其中未测 ${cov.notTestedCount} 条、不适用 ${cov.notApplicableCount} 条。</p>
      <p>模式 ${esc(mode)} · 动态膜未启用（网页版受浏览器跨域限制，无法实测真实 API）。</p>
      ${augItems}
      ${reasonItems ? `<ul>${reasonItems}</ul>` : ''}
    </div>`;

  const filters = `
    <div class="filters">
      <button class="filter-btn is-active" data-filter="all">全部</button>
      <button class="filter-btn" data-filter="todo">待处理（未通过 + 警告）</button>
      <button class="filter-btn" data-filter="fail">仅未通过</button>
      <button class="filter-btn" data-filter="untested">未测项</button>
    </div>`;

  $('#result-body').innerHTML =
    `<p class="hint">文档：${esc(loaded.meta.title)} · 形态：${loaded.kind === 'openapi' ? 'OpenAPI' : '散文'} · 模式：${esc(mode)}</p>`
    + stats + coverage + filters + '<div id="findings"></div>';

  document.querySelectorAll('.filter-btn').forEach((b) => {
    b.addEventListener('click', () => {
      currentFilter = b.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      renderFindings();
    });
  });

  renderFindings();
}

function renderFindings() {
  if (!current) return;
  const { report } = current;
  const all = report.findings;

  const visible = all.filter((f) => {
    if (currentFilter === 'todo') return f.status === STATUS.FAIL || f.status === STATUS.WARNING;
    if (currentFilter === 'fail') return f.status === STATUS.FAIL;
    if (currentFilter === 'untested') return f.status === STATUS.NOT_TESTED;
    return true;
  });

  if (!visible.length) {
    $('#findings').innerHTML = '<p class="empty">该筛选条件下没有条目。</p>';
    return;
  }

  const byLayer = {};
  for (const f of visible) (byLayer[f.layer] ||= []).push(f);

  const order = Object.keys(LAYERS);
  const html = order.filter((l) => byLayer[l]).map((layer) => {
    const cards = byLayer[layer].map(findingCard).join('');
    return `<div class="layer-group"><h3 class="layer-title">${esc(layer)} · ${esc(LAYERS[layer])}</h3>${cards}</div>`;
  }).join('');

  // 兜底：万一出现未知层，也别漏掉
  const unknown = Object.keys(byLayer).filter((l) => !order.includes(l));
  const extra = unknown.map((layer) => (
    `<div class="layer-group"><h3 class="layer-title">${esc(layer)}</h3>${byLayer[layer].map(findingCard).join('')}</div>`
  )).join('');

  $('#findings').innerHTML = html + extra;
}

function findingCard(f) {
  const sev = SEVERITY_LABEL[f.severity] || f.severity;
  const app = APPLICABILITY_LABEL[f.applicability] || f.applicability;
  const statusText = STATUS_LABEL[f.status] || f.status;

  const blocks = [];
  blocks.push(block('检查什么', esc(f.check)));
  if (f.evidence) blocks.push(`<div class="finding-block"><div class="label">本次证据</div><div class="evidence">${esc(f.evidence)}</div></div>`);
  blocks.push(block('不符合的后果', esc(f.consequence)));
  blocks.push(block('应如何修改', esc(f.fix)));
  if (f.before || f.after) {
    blocks.push(`<div class="finding-block"><div class="label">改前 / 改后</div><div class="code-pair">
      <div class="code-box"><div class="code-head">改前</div><pre>${esc(f.before || '（无）')}</pre></div>
      <div class="code-box"><div class="code-head">改后</div><pre>${esc(f.after || '（无）')}</pre></div>
    </div></div>`);
  }
  if (f.note) blocks.push(block('备注', esc(f.note)));

  return `<div class="finding">
    <div class="finding-head">
      <span class="finding-title">${esc(f.title)}</span>
      <span class="rule-id">${esc(f.rule_id)}</span>
      <span class="pill pill-status pill-${esc(f.status)}">${esc(statusText)}</span>
      ${f.source === 'model' ? '<span class="pill pill-model" title="规则引擎只能做结构化检查，判不了这项；结论由你配置的模型基于文档内容补出">模型补判</span>' : ''}
      <span class="pill">严重度 · ${esc(sev)}</span>
      <span class="pill">${esc(app)}</span>
    </div>
    ${blocks.join('')}
  </div>`;
}

function block(label, body) {
  if (!body) return '';
  return `<div class="finding-block"><div class="label">${esc(label)}</div><p>${body}</p></div>`;
}

// ---------- 下载 ----------
function download(name, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

$('#btn-download-md').addEventListener('click', () => {
  if (!current) return;
  download(`api-doc-review-${current.mode}.md`, toMarkdown(current.report), 'text/markdown');
});
$('#btn-download-html').addEventListener('click', () => {
  if (!current) return;
  download(`api-doc-review-${current.mode}.html`, toHtml(current.report), 'text/html');
});
$('#btn-download-json').addEventListener('click', () => {
  if (!current) return;
  download(`api-doc-review-${current.mode}.json`, JSON.stringify(current.report, null, 2), 'application/json');
});

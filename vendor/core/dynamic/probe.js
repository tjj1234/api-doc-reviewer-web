// dynamic/probe.js — 动态膜执行框架（可选，需测试凭据/沙箱）
// 护栏（来自踩坑档案的方法论）：
//   1. 测试 Key / 沙箱优先，不拿生产凭据实测
//   2. 只读子命令优先（先查状态再决定，不盲目重提）
//   3. fail-open：取不到就标 NOT_TESTED，不硬阻断误杀
//   4. 不扣费：破坏性行为只静态标注，绝不动态执行
//   5. SSRF 限制：仅允许 http/https，禁止内网地址
import { STATUS, SEVERITY } from '../schema.js';
import { pitfallSeeds } from './pitfall-seeds.js';

// SSRF 基础防护：禁止明显内网/元数据地址
function isSafeUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname;
    if (host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0') return false;
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^127\./.test(host)) return false;
    if (host === '169.254.169.254') return false; // 云元数据
    return true;
  } catch {
    return false;
  }
}

// 动态膜总开关：未启用或测试目标未给 → 全部种子返回 NOT_TESTED
export function runDynamicMembrane(target, creds, { enabled = false } = {}) {
  const results = [];
  if (!enabled || !target || !creds) {
    for (const seed of pitfallSeeds) {
      results.push({
        seed_id: seed.id,
        pit: seed.pit,
        layer: seed.layer,
        rule: seed.rule,
        type: seed.type,
        status: STATUS.NOT_TESTED,
        severity: SEVERITY.low,
        note: !enabled
          ? '动态膜未启用（按设计默认关闭，需测试凭据/沙箱才开启）。'
          : '未提供测试目标或凭据，跳过动态实测。',
        what: seed.what,
      });
    }
    return { enabled: false, results };
  }

  // 启用时：逐个种子尝试实测；失败/不支持 → fail-open 标 NOT_TESTED
  for (const seed of pitfallSeeds) {
    try {
      const r = runOne(seed, target, creds);
      results.push(r);
    } catch (e) {
      results.push({
        seed_id: seed.id, pit: seed.pit, layer: seed.layer, rule: seed.rule, type: seed.type,
        status: STATUS.NOT_TESTED, severity: SEVERITY.low,
        note: `实测异常（fail-open）：${e.message}`,
        what: seed.what,
      });
    }
  }
  return { enabled: true, results };
}

// 单探针执行：仅对可安全实测的类型落地 HTTP 调用；其余返回声明（由宿主/扩展补充）
async function runOne(seed, target, creds) {
  const base = target.baseUrl;
  if (!isSafeUrl(base)) {
    return { seed_id: seed.id, status: STATUS.NOT_TESTED, note: '目标 URL 触发 SSRF 防护，已跳过。', what: seed.what };
  }

  if (seed.type === 'auth-error') {
    // 用假 Key 调一个只读端点，观察真实错误码/body（只读、不扣费）
    const url = `${base.replace(/\/$/, '')}${target.probePath || '/v1/models'}`;
    const resp = await fetch(url, { headers: { Authorization: 'Bearer invalid-test-key-0000' } });
    const body = await resp.text().catch(() => '');
    return {
      seed_id: seed.id, pit: seed.pit, layer: seed.layer, rule: seed.rule, type: seed.type,
      status: STATUS.WARNING, severity: SEVERITY.medium,
      evidence: `无效 Key 实测返回 HTTP ${resp.status}；body 片段：${body.slice(0, 160)}`,
      note: '请比对文档声称的鉴权错误码；不一致即需修正文档（对应坑04/坑05）。',
      what: seed.what,
    };
  }

  if (seed.type === 'status-enum' || seed.type === 'async-status') {
    if (!target.statusPath) {
      return { seed_id: seed.id, status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '未配置 statusPath，无法实测长任务状态枚举。', what: seed.what };
    }
    const url = `${base.replace(/\/$/, '')}${target.statusPath}`;
    const resp = await fetch(url, { headers: creds.headers || {} });
    const json = await resp.json().catch(() => null);
    return {
      seed_id: seed.id, pit: seed.pit, layer: seed.layer, rule: seed.rule, type: seed.type,
      status: STATUS.WARNING, severity: SEVERITY.medium,
      evidence: `状态接口实测返回：${JSON.stringify(json).slice(0, 200)}`,
      note: '请比对文档 status 枚举（对应坑01/坑02/坑12）。',
      what: seed.what,
    };
  }

  // 其余类型（idempotency/rate-limit/param-constraint/danger-example 等）涉及写操作或复杂编排，
  // 按护栏「不扣费/不盲目重提」原则，仅声明待宿主/扩展在受控环境下执行，框架不直接跑。
  return {
    seed_id: seed.id, pit: seed.pit, layer: seed.layer, rule: seed.rule, type: seed.type,
    status: STATUS.NOT_TESTED, severity: SEVERITY.low,
    note: '该探针涉及写操作/复杂编排，按护栏不在框架内自动执行；请在沙箱手动验证或扩展实现。',
    what: seed.what,
  };
}

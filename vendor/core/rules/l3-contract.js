// rules/l3-contract.js — L3 契约层（auth / 示例 / 错误返回）
import { STATUS, SEVERITY, APPLICABILITY } from '../schema.js';
import { eachOperation } from '../loaders/openapi.js';

export const rules = [
  {
    id: 'L3-AUTH-001',
    layer: 'L3',
    title: '鉴权方式须明确（header 名 / Bearer / key 来源）',
    applicability: { A: APPLICABILITY.Required, B: APPLICABILITY.Incidental, C: APPLICABILITY.Recommended },
    membrane: 'static',
    check: '检查是否声明 securitySchemes（如 apiKey 在 header、bearer 格式），并说明 key 从哪来。',
    consequence: 'agent 不知把 key 放哪个 header、是否加 Bearer，调用全返 401；错误码含义也可能误导（见踩坑：无效 key 有时返 500 而非 401）。',
    fix: '在 components.securitySchemes 写明类型与位置；正文说明如何获取 key、是否带 Bearer 前缀。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型抽取，未配置跳过。' };
      const hasSchemes = !!(doc.components && doc.components.securitySchemes);
      const anyOpSec = (() => {
        let found = false;
        eachOperation(doc, (_p, _m, op) => { if (op.security) found = true; });
        return found;
      })();
      if (hasSchemes || anyOpSec) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.FAIL, severity: SEVERITY.high, evidence: '未声明任何 securitySchemes，也未在操作中标注 security。' };
    },
  },
  {
    id: 'L3-EX-001',
    layer: 'L3',
    title: '关键操作应提供请求/响应示例',
    applicability: { A: APPLICABILITY.Recommended, B: APPLICABILITY.Recommended, C: APPLICABILITY.Recommended },
    membrane: 'static',
    check: '检查主要操作是否带 example（请求体示例 + 成功响应示例）。',
    consequence: 'agent 只能照 schema 硬凑值，常漏必填、填错格式；有示例才能直接照抄。',
    fix: '为高频操作补 request/response example；示例应覆盖必填字段与典型取值。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型判断页面是否有可复制示例，未配置跳过。' };
      let total = 0, withEx = 0;
      eachOperation(doc, (_p, _m, op) => {
        total++;
        const rb = op.requestBody?.content?.['application/json']?.example || op.requestBody?.content?.['application/json']?.examples;
        const respEx = Object.values(op.responses || {}).some((r) => Object.values(r.content || {}).some((c) => c.example || c.examples));
        if (rb || respEx) withEx++;
      });
      if (total === 0) return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '未解析到操作。' };
      if (withEx === 0) return { status: STATUS.WARNING, severity: SEVERITY.medium, evidence: `0/${total} 操作带示例。` };
      if (withEx < total * 0.5) return { status: STATUS.WARNING, severity: SEVERITY.low, evidence: `仅 ${withEx}/${total} 操作带示例，覆盖偏低。` };
      return { status: STATUS.PASS, severity: SEVERITY.low };
    },
  },
  {
    id: 'L3-ERR-001',
    layer: 'L3',
    title: '错误响应须文档化（4xx/5xx 含 schema）',
    applicability: { A: APPLICABILITY.Required, B: APPLICABILITY.Incidental, C: APPLICABILITY.Recommended },
    membrane: 'static',
    check: '检查操作是否声明 4xx/5xx 响应及其返回结构（agent 据此决定重试/放弃）。',
    consequence: 'agent 收到错误不知含义，盲目重试或误判成功；如踩坑：非 200 时某字段变空串被当成「进行中」。',
    fix: '为常见错误码（400/401/403/404/429/5xx）补 response schema 与触发条件说明。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型抽取，未配置跳过。' };
      const missing = [];
      eachOperation(doc, (p, method, op) => {
        const responses = op.responses || {};
        const errCovered = ['4', '5'].some((pre) => Object.keys(responses).some((k) => k.startsWith(pre)));
        if (!errCovered) missing.push(`${method} ${p}`);
      });
      if (!missing.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.medium, evidence: `未声明错误响应的操作：${missing.slice(0, 8).join('；')}${missing.length > 8 ? ` 等 ${missing.length} 处` : ''}` };
    },
  },
  {
    id: 'L3-ERR-002',
    layer: 'L3',
    title: '同一错误码不应承载多种含义（避免误导修复方向）',
    applicability: { A: APPLICABILITY.Recommended, B: APPLICABILITY.Incidental, C: APPLICABILITY.Incidental },
    membrane: 'dynamic',
    check: '检查 403/400 等是否可能同时表示「余额不足/无权/Key 失效」多种含义（需动态膜实测或文档明确区分）。',
    consequence: 'agent 按错误码决定修复动作，一个码多义会修错方向（如把「余额不足」当成「Key 失效」去换 key）。',
    fix: '每个错误码在文档中写清唯一含义；多义时拆分码或用响应体字段区分。动态膜会用假 Key 实测 401/403/500 的真实映射。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型判断，未配置跳过。' };
      // 静态启发式：若文档/描述中 403 同时出现「权限/余额/key」等词则警告
      const txt = JSON.stringify(doc).slice(0, 50000);
      const ambiguous403 = /403/.test(txt) && /(余额|balance|无权|unauthor|key|失效|invalid)/gi.test(txt);
      if (!ambiguous403) return { status: STATUS.PASS, severity: SEVERITY.low, note: '静态未检出明显多义；动态膜可进一步实测。' };
      return { status: STATUS.WARNING, severity: SEVERITY.medium, evidence: '检测到 403 相关描述可能同时涉及多种失败原因，建议文档明确拆分含义（动态膜可实测验证）。' };
    },
  },
  {
    id: 'L3-SRV-001',
    layer: 'L3',
    title: '应声明 base URL / server 地址',
    applicability: { A: APPLICABILITY.Incidental, B: APPLICABILITY.Incidental, C: APPLICABILITY.Recommended },
    membrane: 'static',
    check: '检查 servers 字段或正文是否给出可调用 base URL。',
    consequence: 'agent 不知往哪发请求，只能猜或失败；文档只写相对 path 时尤甚。',
    fix: '在 servers 中给出生产 base URL；多环境用 variables 说明。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型判断，未配置跳过。' };
      const servers = doc.servers;
      if (Array.isArray(servers) && servers.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.low, evidence: '未声明 servers/base URL。' };
    },
  },
];

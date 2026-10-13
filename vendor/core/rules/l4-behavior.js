// rules/l4-behavior.js — L4 行为层（幂等/重试/分页/限流/异步）← agent 出事故最高发
import { STATUS, SEVERITY, APPLICABILITY } from '../schema.js';
import { eachOperation } from '../loaders/openapi.js';

export const rules = [
  {
    id: 'L4-IDEM-001',
    layer: 'L4',
    title: '写操作应说明幂等性与重试策略',
    applicability: { A: APPLICABILITY.Required, B: APPLICABILITY.Incidental, C: APPLICABILITY.NA },
    membrane: 'static',
    check: '检查 POST 建资源是否声明是否幂等、是否需要 idempotency-key / client-token。',
    consequence: 'agent 超时重试会把订单建三遍；未说明幂等，agent 不敢重试又怕漏掉。',
    fix: '明确「POST 不幂等，重试请用 Idempotency-Key」或「此接口幂等可安全重试」；给出 key 头部名。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型判断，未配置跳过。' };
      const risky = [];
      eachOperation(doc, (p, method, op) => {
        if (method !== 'POST') return;
        const txt = `${op.description || ''} ${op.summary || ''}`.toLowerCase();
        const mentions = /idempot|幂等|client-token|重试/.test(txt) || (op.parameters || []).some((pr) => /idempot/i.test(pr.name || ''));
        if (!mentions) risky.push(`${method} ${p}`);
      });
      if (!risky.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.high, evidence: `未说明幂等/重试的写操作：${risky.slice(0, 8).join('；')}${risky.length > 8 ? ` 等 ${risky.length} 处` : ''}` };
    },
  },
  {
    id: 'L4-SIDE-001',
    layer: 'L4',
    title: '破坏性/高危操作须标注副作用与不可恢复',
    applicability: { A: APPLICABILITY.Required, B: APPLICABILITY.Incidental, C: APPLICABILITY.NA },
    membrane: 'static',
    check: '检查 DELETE / 支付 / 销毁类操作是否在文档显著标注「不可恢复 / 副作用」与是否需二次确认。',
    consequence: 'MCP tool 直接执行，agent 可能未经人确认就删库/扣款；误调用代价极高。',
    fix: '在描述顶部标注「破坏性操作，不可恢复」；建议明确「执行前需用户显式确认」。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型判断，未配置跳过。' };
      const destructive = [];
      eachOperation(doc, (p, method, op) => {
        if (method !== 'DELETE') return;
        const txt = `${op.description || ''} ${op.summary || ''}`.toLowerCase();
        const warns = /不可恢复|irreversible|永久|销毁|delete|destructive|谨慎|确认/.test(txt);
        if (!warns) destructive.push(`${method} ${p}`);
      });
      if (!destructive.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.high, evidence: `未标注不可恢复的 DELETE 操作：${destructive.slice(0, 8).join('；')}` };
    },
  },
  {
    id: 'L4-PAGE-001',
    layer: 'L4',
    title: '列表接口应说明分页/游标方式',
    applicability: { A: APPLICABILITY.Required, B: APPLICABILITY.Incidental, C: APPLICABILITY.NA },
    membrane: 'static',
    check: '检查返回数组的列表接口是否定义分页参数（cursor/offset/page/limit）与是否有 total。',
    consequence: 'agent 用 offset=0 循环翻页，遇并发插入会漏数据或重复消费；无 total 不知何时停止。',
    fix: '明确分页机制（推荐 cursor 游标）；给出每页大小上限与 total/next 字段含义。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型判断，未配置跳过。' };
      const listNoPage = [];
      eachOperation(doc, (p, method, op) => {
        const isListPath = /list|search|query|items|orders|users|members|histories/i.test(p);
        const isSearchPost = method === 'POST' && /search|query|filter/i.test(p);
        if (method === 'GET' && isListPath) { /* 列表接口 */ }
        else if (isSearchPost) { /* 搜索类 POST */ }
        else return;
        const params = op.parameters || [];
        const hasPage = params.some((pr) => /(cursor|offset|page|limit|next|after)/i.test(pr.name || ''));
        if (!hasPage) listNoPage.push(`${method} ${p}`);
      });
      if (!listNoPage.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.medium, evidence: `疑似列表接口但未定义分页参数：${listNoPage.slice(0, 8).join('；')}` };
    },
  },
  {
    id: 'L4-RL-001',
    layer: 'L4',
    title: '应说明限流与 429 退避策略',
    applicability: { A: APPLICABILITY.Required, B: APPLICABILITY.Incidental, C: APPLICABILITY.NA },
    membrane: 'static',
    check: '检查是否文档化 rate limit、429 含义、Retry-After 头部与退避建议。',
    consequence: 'agent 遇 429/5xx 盲目重试会雪崩；踩坑：429 与 5xx 共用阈值会误杀正常请求。',
    fix: '写明限流额度、429 需退避、Retry-After 含义；区分「限流(可恢复)」与「服务器错误(不可恢复)」的退避策略。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型判断，未配置跳过。' };
      const txt = JSON.stringify(doc).slice(0, 60000).toLowerCase();
      const hasRate = /rate.?limit|429|retry-after|x-ratelimit/.test(txt);
      if (hasRate) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.medium, evidence: '文档未出现 rate limit / 429 / Retry-After 相关内容。' };
    },
  },
  {
    id: 'L4-ASYNC-001',
    layer: 'L4',
    title: '长任务应说明状态查询/轮询方式',
    applicability: { A: APPLICABILITY.Conditional, B: APPLICABILITY.Incidental, C: APPLICABILITY.NA },
    membrane: 'static',
    check: '检查耗时操作（视频生成/导出/批处理）是否说明如何查状态（轮询端点或 callback）。',
    consequence: 'agent 提交后不知何时完成，要么干等超时要么反复重提；踩坑：读不出状态就当「还没好」空转。',
    fix: '给出状态查询端点（如 GET /tasks/{id}）或 webhook；列出 status 取值与终态含义。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型判断，未配置跳过。' };
      const longRunning = [];
      eachOperation(doc, (p, method, op) => {
        const txt = `${op.description || ''} ${op.summary || ''}`.toLowerCase();
        if (/异步|长任务|async|long.?run|生成|export|批处理|task/.test(txt) && !/status|轮询|poll|callback|webhook|progress/.test(txt)) {
          longRunning.push(`${method} ${p}`);
        }
      });
      if (!longRunning.length) return { status: STATUS.PASS, severity: SEVERITY.low, note: '未检出长任务接口，或已含状态查询说明。' };
      return { status: STATUS.WARNING, severity: SEVERITY.medium, evidence: `疑似长任务但未说明状态查询：${longRunning.slice(0, 6).join('；')}` };
    },
  },
  {
    id: 'L4-ERRFIELD-001',
    layer: 'L4',
    title: '应说明非 2xx 时字段的真实行为',
    applicability: { A: APPLICABILITY.Required, B: APPLICABILITY.Incidental, C: APPLICABILITY.NA },
    membrane: 'dynamic',
    check: '检查文档是否写明「非 200 / 字段缺失时返回什么」（如 status 变空串）。需动态膜实测或文档明确。',
    consequence: '踩坑：非 200 时 status 字段变空串，agent 把「读不出状态」当成「进行中」无限空转。',
    fix: '明确各错误码下每个字段的取值（含空串/缺失的处理）；给出 agent 读不出状态时应「熔断/标未知」而非继续轮询的指引。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型判断，未配置跳过。' };
      // 静态启发式：错误响应 schema 中若 status/state 为非必填且无说明，提示
      const vague = [];
      eachOperation(doc, (p, method, op) => {
        const errs = Object.entries(op.responses || {}).filter(([k]) => k.startsWith('4') || k.startsWith('5'));
        for (const [code, r] of errs) {
          const sch = r?.content?.['application/json']?.schema;
          if (sch && /status|state/i.test(JSON.stringify(sch)) && !/enum|描述|说明/.test(JSON.stringify(r.description || ''))) {
            vague.push(`${method} ${p} ${code}`);
          }
        }
      });
      if (!vague.length) return { status: STATUS.PASS, severity: SEVERITY.low, note: '静态未检出明显缺口；动态膜可实测非 2xx 真实返回。' };
      return { status: STATUS.WARNING, severity: SEVERITY.high, evidence: `错误响应含 status 字段但缺取值说明：${vague.slice(0, 6).join('；')}（建议动态实测真实返回值）` };
    },
  },
];

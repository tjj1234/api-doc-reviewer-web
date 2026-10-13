// rules/l1-structure.js — L1 结构层（schema 完整性）
// 模式 A 硬检核心：agent 把 schema 当 tool 入参，缺类型/必填/枚举会直接调错参数。
import { STATUS, SEVERITY, APPLICABILITY } from '../schema.js';
import { eachOperation } from '../loaders/openapi.js';

const APP = { A: APPLICABILITY.Required, B: APPLICABILITY.Incidental, C: APPLICABILITY.NA };

function missingTypeParams(doc) {
  const issues = [];
  eachOperation(doc, (p, method, op) => {
    const params = op.parameters || [];
    for (const pr of params) {
      if (!pr.schema || !pr.schema.type) {
        issues.push(`${method} ${p} 参数 ${pr.name || '?'}`);
      }
    }
    // requestBody 顶层也应声明 content schema
  });
  return issues;
}

function missingRequiredFlag(doc) {
  const issues = [];
  eachOperation(doc, (p, method, op) => {
    const params = op.parameters || [];
    for (const pr of params) {
      if ((pr.in === 'query' || pr.in === 'header' || pr.in === 'path') && !pr.required && pr.in === 'path') {
        issues.push(`${method} ${p} path 参数 ${pr.name} 未标 required`);
      }
    }
  });
  return issues;
}

function bareObjectBody(doc) {
  const issues = [];
  eachOperation(doc, (p, method, op) => {
    const rb = op.requestBody;
    if (!rb) return;
    const content = rb.content || {};
    for (const [ct, cv] of Object.entries(content)) {
      if (ct.includes('json')) {
        const sch = cv.schema;
        if (sch && sch.type === 'object' && !sch.properties && !sch.$ref) {
          issues.push(`${method} ${p} body 为裸 object（无 properties，agent 不知填什么）`);
        }
      }
    }
  });
  return issues;
}

function missingResponseSchema(doc) {
  const issues = [];
  eachOperation(doc, (p, method, op) => {
    const responses = op.responses || {};
    const okKeys = Object.keys(responses).filter((k) => k.startsWith('2'));
    for (const k of okKeys) {
      const r = responses[k];
      const content = r.content || {};
      const hasSchema = Object.values(content).some((c) => c.schema);
      if (!hasSchema && Object.keys(content).length > 0) {
        issues.push(`${method} ${p} ${k} 响应无 schema`);
      }
    }
  });
  return issues;
}

function opIdIssues(doc) {
  const seen = new Map();
  const missing = [];
  const dup = [];
  eachOperation(doc, (p, method, op, full) => {
    const id = op.operationId;
    if (!id) missing.push(full);
    else if (seen.has(id)) dup.push(`${id}（${seen.get(id)} 与 ${full}）`);
    else seen.set(id, full);
  });
  return { missing, dup };
}

function namingInconsistency(doc) {
  const props = new Set();
  const collect = (sch) => {
    if (!sch) return;
    if (sch.properties) {
      for (const k of Object.keys(sch.properties)) props.add(k);
      for (const v of Object.values(sch.properties)) collect(v);
    }
    if (sch.items) collect(sch.items);
  };
  eachOperation(doc, (_p, _m, op) => {
    const rb = op.requestBody?.content?.['application/json']?.schema;
    collect(rb);
    const resp = op.responses?.[Object.keys(op.responses || {}).find((k) => k.startsWith('2')) || ''];
    collect(resp?.content?.['application/json']?.schema);
  });
  // 同时含 snake_case 与 camelCase 同名根 → 不一致信号
  const snake = [...props].filter((p) => /_/.test(p));
  const camel = [...props].filter((p) => /[a-z][A-Z]/.test(p));
  return snake.length > 0 && camel.length > 0
    ? { snake: snake.slice(0, 5), camel: camel.slice(0, 5) }
    : null;
}

export const rules = [
  {
    id: 'L1-STRUCT-001',
    layer: 'L1',
    title: '每个操作应有唯一 operationId（单一职责）',
    applicability: APP,
    membrane: 'static',
    check: '检查每个 path+method 是否有 operationId，且全局唯一。',
    consequence: 'agent 把 operationId 当 tool 名；缺失或不唯一会导致 tool 冲突、调用歧义，甚至覆盖错误接口。',
    fix: '为每个操作补 operationId，全局唯一且语义清晰（如 createOrder、listOrders）。避免一个接口干多件事。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型后端抽取 tool 映射，未配置模型时跳过。' };
      const { missing, dup } = opIdIssues(doc);
      if (missing.length === 0 && dup.length === 0) return { status: STATUS.PASS, severity: SEVERITY.low };
      const ev = [];
      if (missing.length) ev.push(`缺失 operationId：${missing.slice(0, 8).join('；')}${missing.length > 8 ? ` 等 ${missing.length} 处` : ''}`);
      if (dup.length) ev.push(`重复 operationId：${dup.slice(0, 5).join('；')}`);
      return { status: STATUS.FAIL, severity: SEVERITY.high, evidence: ev.join('\n') };
    },
  },
  {
    id: 'L1-STRUCT-002',
    layer: 'L1',
    title: '参数须声明类型与格式',
    applicability: APP,
    membrane: 'static',
    check: '检查 query/header/path 参数及 body 字段是否都有 type/format（机器可解析）。',
    consequence: 'agent 不知道该传 string 还是 number，常把 id 当字符串或漏传嵌套字段，调用直接 400。',
    fix: '为每个参数与字段补 schema.type（必要时 format，如 date-time/uuid）。数组补 items，对象补 properties。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型抽取，未配置跳过。' };
      const issues = missingTypeParams(doc);
      if (!issues.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.FAIL, severity: SEVERITY.high, evidence: `缺少类型的参数：${issues.slice(0, 8).join('；')}${issues.length > 8 ? ` 等 ${issues.length} 处` : ''}` };
    },
  },
  {
    id: 'L1-STRUCT-003',
    layer: 'L1',
    title: 'path/必填参数须显式标注 required',
    applicability: APP,
    membrane: 'static',
    check: '检查 path 参数及所有必填参数是否标 required:true。',
    consequence: 'agent 以为可选就不传，导致 404/400；path 参数漏传尤其致命。',
    fix: 'path 参数必须 required:true；所有必填 query/header 也显式标 required。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型抽取，未配置跳过。' };
      const issues = missingRequiredFlag(doc);
      if (!issues.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.FAIL, severity: SEVERITY.high, evidence: issues.slice(0, 8).join('；') };
    },
  },
  {
    id: 'L1-STRUCT-004',
    layer: 'L1',
    title: 'requestBody 须展开 schema（不要裸 object）',
    applicability: APP,
    membrane: 'static',
    check: '检查 JSON body 是否定义了 properties，而非仅 type:object 让 agent 盲填。',
    consequence: 'agent 不知道 body 有哪些字段、哪些是嵌套对象，生成请求时结构错乱。',
    fix: '为 body 定义完整 properties；嵌套对象独立定义并可复用 $ref。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型抽取，未配置跳过。' };
      const issues = bareObjectBody(doc);
      if (!issues.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.medium, evidence: issues.slice(0, 8).join('；') };
    },
  },
  {
    id: 'L1-STRUCT-005',
    layer: 'L1',
    title: '受限字段应给出枚举（enum）',
    applicability: { A: APPLICABILITY.Recommended, B: APPLICABILITY.Recommended, C: APPLICABILITY.NA },
    membrane: 'static',
    check: '检查状态/类型等取值受限的字段是否提供 enum 或明确取值列表。',
    consequence: 'agent 会编造 status 取值（如文档写 succeeded 实则 completed），精确匹配失败。',
    fix: '对取值受限字段补 enum；或在描述中列出所有合法值及含义。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型抽取枚举，未配置跳过。' };
      // 启发式：扫描响应 schema 中名为 status/type/state 的字段是否有 enum
      const missing = [];
      eachOperation(doc, (p, method, op) => {
        const resp = op.responses?.[Object.keys(op.responses || {}).find((k) => k.startsWith('2')) || ''];
        const sch = resp?.content?.['application/json']?.schema;
        const walk = (s, path) => {
          if (!s) return;
          if (s.properties) for (const [k, v] of Object.entries(s.properties)) {
            if (/^(status|state|type)$/i.test(k) && !v.enum && !v.$ref) missing.push(`${method} ${p} -> ${path}${k}`);
            walk(v, `${path}${k}.`);
          }
          if (s.items) walk(s.items, `${path}[]`);
        };
        walk(sch, '');
      });
      if (!missing.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.medium, evidence: `取值字段无 enum：${missing.slice(0, 6).join('；')}` };
    },
  },
  {
    id: 'L1-STRUCT-006',
    layer: 'L1',
    title: '命名风格应一致（snake_case / camelCase 统一）',
    applicability: { A: APPLICABILITY.Recommended, B: APPLICABILITY.Incidental, C: APPLICABILITY.NA },
    membrane: 'static',
    check: '检查全局字段命名是否混用 snake_case 与 camelCase。',
    consequence: 'agent 拼接字段名时易拼错，导致传参失败或读不到返回值。',
    fix: '统一一种命名风格并在文档开头声明；跨接口保持一致。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态无需检查。' };
      const r = namingInconsistency(doc);
      if (!r) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.low, evidence: `同时出现 snake_case(${r.snake.join(',')}) 与 camelCase(${r.camel.join(',')})` };
    },
  },
  {
    id: 'L1-STRUCT-007',
    layer: 'L1',
    title: '成功响应须定义返回 schema',
    applicability: APP,
    membrane: 'static',
    check: '检查 2xx 响应是否定义了 content schema（agent 据此解析返回值）。',
    consequence: 'agent 拿到响应不知字段结构，无法把结果喂给后续步骤，链路断裂。',
    fix: '为每个 2xx 响应定义 response schema；复用组件 schema。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型抽取，未配置跳过。' };
      const issues = missingResponseSchema(doc);
      if (!issues.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.medium, evidence: issues.slice(0, 8).join('；') };
    },
  },
];

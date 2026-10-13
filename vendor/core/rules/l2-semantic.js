// rules/l2-semantic.js — L2 语义层（何时用 / 含义无歧义）
// Mode A/B/C 都重点。OpenAPI 可做结构性检查（描述是否缺失）；散文需模型后端做语义判断。
import { STATUS, SEVERITY, APPLICABILITY } from '../schema.js';
import { eachOperation } from '../loaders/openapi.js';

export const rules = [
  {
    id: 'L2-WHEN-001',
    layer: 'L2',
    title: '每个操作应说明「何时该用」',
    applicability: { A: APPLICABILITY.Recommended, B: APPLICABILITY.Required, C: APPLICABILITY.Recommended },
    membrane: 'static',
    check: '检查每个接口描述是否讲清使用场景，让 agent 能据此选择正确 tool。',
    consequence: 'agent 靠描述选 tool；描述缺失/模糊会选错接口，或重复造一个已存在的调用。',
    fix: '为每个操作写清「在什么业务场景下调用」+ 与相近接口的区别；RAG 模式还需关键词/同义表述利于召回。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型后端判断「何时用」是否讲清，未配置模型时跳过。' };
      const noDesc = [];
      eachOperation(doc, (p, method, op) => {
        if (!op.description && !op.summary) noDesc.push(`${method} ${p}`);
      });
      if (!noDesc.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.medium, evidence: `缺少描述的操作：${noDesc.slice(0, 8).join('；')}${noDesc.length > 8 ? ` 等 ${noDesc.length} 处` : ''}` };
    },
  },
  {
    id: 'L2-PRECOND-001',
    layer: 'L2',
    title: '隐藏前置条件应写明',
    applicability: { A: APPLICABILITY.Recommended, B: APPLICABILITY.Recommended, C: APPLICABILITY.Incidental },
    membrane: 'static',
    check: '检查文档是否说明调用前的隐藏前置条件（如「先创建 X 再调用」）。',
    consequence: 'agent 漏掉前置步骤直接调用，返回晦涩错误码，难自愈。',
    fix: '在操作描述或「使用前必读」章节列出前置依赖与顺序。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型判断，未配置跳过。' };
      // 启发式：描述里出现「需要先/依赖/前提」但仅少量 → 提示补充
      let mentions = 0, total = 0;
      eachOperation(doc, (_p, _m, op) => {
        total++;
        if (/需要先|依赖|前提|prerequisite|必须先/.test(op.description || '')) mentions++;
      });
      if (total === 0) return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '未解析到操作。' };
      if (mentions === 0) return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '静态无法判定是否漏写前置条件；建议人工/模型复核（尤其含多步流程的接口）。' };
      return { status: STATUS.PASS, severity: SEVERITY.low };
    },
  },
  {
    id: 'L2-AMBIG-001',
    layer: 'L2',
    title: '字段含义应无歧义（status 等取值说明）',
    applicability: { A: APPLICABILITY.Recommended, B: APPLICABILITY.Recommended, C: APPLICABILITY.Incidental },
    membrane: 'static',
    check: '检查 status/state 等字段是否在描述中列出取值与含义。',
    consequence: 'agent 编造取值（文档写 succeeded 实则 completed）导致精确匹配失败。',
    fix: '列出每个状态值的含义与流转关系；与 L1-STRUCT-005 的 enum 配套。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型判断，未配置跳过。' };
      const ambiguous = [];
      eachOperation(doc, (p, method, op) => {
        const resp = op.responses?.[Object.keys(op.responses || {}).find((k) => k.startsWith('2')) || ''];
        const txt = JSON.stringify(resp || '').toLowerCase();
        if (/status|state/.test(txt) && !/succeeded|completed|failed|pending|processing|success|枚举|enum/.test(txt)) {
          ambiguous.push(`${method} ${p}`);
        }
      });
      if (!ambiguous.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.medium, evidence: `含 status/state 但描述未列取值含义：${ambiguous.slice(0, 6).join('；')}` };
    },
  },
];

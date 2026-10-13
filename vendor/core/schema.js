// schema.js — 全局常量与 finding/rule 数据结构定义
// 这是跨 agent 可移植的骨架：任何宿主(WorkBuddy/Claude/Cursor/Trae)都按同一套状态机与字段消费 finding。

// 七层评估框架（从「机器能读」→「agent 敢用」）
export const LAYERS = {
  L0: '形态层（机器可读形态）',
  L1: '结构层（schema 完整性）',
  L2: '语义层（何时用/含义无歧义）',
  L3: '契约层（auth/示例/错误返回）',
  L4: '行为层（幂等/重试/分页/限流/异步）',
  L5: '安全层（破坏性操作/越权/敏感示例）',
  L6: '生命周期层（deprecated/可发现/changelog）',
};

// 三种 agent 消费模式
export const MODES = {
  A: {
    id: 'A',
    name: 'MCP / Function Calling',
    desc: '把文档变成工具的入参：agent 只读 schema 选 tool + 填参数，像调函数。最看重 L1 结构 + L4 行为。',
  },
  B: {
    id: 'B',
    name: 'RAG 检索',
    desc: '文档切片入库，agent 现查现用自然语言段落。最看重 L2 语义 + L6 可发现性。',
  },
  C: {
    id: 'C',
    name: 'Agent 浏览器读文档',
    desc: 'agent 像人一样打开 docs 网站读页面。最看重 L0 形态 + L2 导航 + L3 页面内可复制示例。',
  },
};

// 两层膜
export const MEMBRANE = {
  STATIC: 'static', // 静态膜：只看文档本身（规则引擎 / 模型语义判断）
  DYNAMIC: 'dynamic', // 动态膜：实测真实 API（HTTP 探针，需测试凭据/沙箱，可选）
};

// 一条发现的机器状态（采纳自 PRD 状态枚举）
export const STATUS = {
  PASS: 'PASS', // 通过
  FAIL: 'FAIL', // 未通过（按适用性可能阻断）
  WARNING: 'WARNING', // 通过但有风险点
  NOT_APPLICABLE: 'NOT_APPLICABLE', // 不适用（如该模式不查此层）
  NOT_TESTED: 'NOT_TESTED', // 未测（缺模型/缺凭据/缺输入形态）
  ERROR: 'ERROR', // 规则运行异常
};

// 严重度 4 级
export const SEVERITY = {
  critical: 'critical', // 严重：agent 几乎必然出错或造成破坏
  high: 'high', // 高：大概率踩坑
  medium: 'medium', // 中：偶发或需特定场景
  low: 'low', // 低：体验/可维护性
};

// 适用性 4 级（对应讨论里的 硬检/条件硬检/重点/顺带/不查）
export const APPLICABILITY = {
  Required: 'Required', // 硬检：该模式下必须满足
  Conditional: 'Conditional', // 条件硬检：满足前置条件时必须满足
  Recommended: 'Recommended', // 重点：强烈建议
  Incidental: 'Incidental', // 顺带：提示性
  NA: 'N/A', // 不查
};

// 适用性 → 中文标签（报告展示用）
export const APPLICABILITY_LABEL = {
  Required: '硬检（必须满足）',
  Conditional: '条件硬检',
  Recommended: '重点（强烈建议）',
  Incidental: '顺带（提示）',
  'N/A': '不查',
};

// 严重度 → 中文标签
export const SEVERITY_LABEL = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
};

// 状态 → 中文标签 + 颜色（报告展示用，浅色主题）
export const STATUS_LABEL = {
  PASS: '通过',
  FAIL: '未通过',
  WARNING: '警告',
  NOT_APPLICABLE: '不适用',
  NOT_TESTED: '未测',
  ERROR: '规则异常',
};

export const STATUS_COLOR = {
  PASS: '#1a7f37',
  FAIL: '#cf222e',
  WARNING: '#9a6700',
  NOT_APPLICABLE: '#6e7781',
  NOT_TESTED: '#8250df',
  ERROR: '#bf3989',
};

// 创建一条 finding 的工厂（合并规则元数据 + 运行结果）
export function makeFinding(rule, mode, result) {
  const app = rule.applicability?.[mode] ?? 'N/A';
  return {
    rule_id: rule.id,
    layer: rule.layer,
    mode,
    applicability: app,
    membrane: rule.membrane || MEMBRANE.STATIC,
    title: rule.title,
    check: rule.check,
    consequence: rule.consequence,
    fix: rule.fix,
    // 运行结果
    status: result?.status ?? STATUS.ERROR,
    severity: result?.severity ?? SEVERITY.low,
    evidence: result?.evidence ?? '',
    before: result?.before ?? '',
    after: result?.after ?? '',
    note: result?.note ?? '',
  };
}

export const FINDING_FIELDS = [
  'rule_id', 'layer', 'mode', 'applicability', 'membrane',
  'title', 'check', 'consequence', 'fix',
  'status', 'severity', 'evidence', 'before', 'after', 'note',
];

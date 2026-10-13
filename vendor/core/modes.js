// modes.js — 三种消费模式的元配置与过滤逻辑
import { MODES, APPLICABILITY } from './schema.js';

// 每个模式下，七层各自的「检查强度」标注（仅用于报告展示与权重说明，不影响规则运行——
// 规则运行的最终开关由规则自身的 applicability[mode] 决定）。
// 强度：hard=硬检, priority=重点, incidental=顺带, skip=不查
export const MODE_LAYER_INTENSITY = {
  A: {
    L0: 'incidental', L1: 'hard', L2: 'priority', L3: 'priority',
    L4: 'hard', L5: 'priority', L6: 'incidental',
  },
  B: {
    L0: 'incidental', L1: 'incidental', L2: 'priority', L3: 'incidental',
    L4: 'incidental', L5: 'incidental', L6: 'priority',
  },
  C: {
    L0: 'priority', L1: 'skip', L2: 'priority', L3: 'priority',
    L4: 'skip', L5: 'incidental', L6: 'skip',
  },
};

export const INTENSITY_LABEL = {
  hard: '硬检',
  priority: '重点',
  incidental: '顺带',
  skip: '不查',
};

// 判断某规则在给定模式下是否应当运行
export function isRuleApplicable(rule, mode) {
  const app = rule.applicability?.[mode];
  if (!app) return false;
  return app !== APPLICABILITY.NA;
}

// 取模式元数据
export function getMode(modeId) {
  return MODES[modeId] || null;
}

export const VALID_MODES = Object.keys(MODES);

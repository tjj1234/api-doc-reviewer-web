// rules/index.js — 聚合全部规则
import * as l0 from './l0-form.js';
import * as l1 from './l1-structure.js';
import * as l2 from './l2-semantic.js';
import * as l3 from './l3-contract.js';
import * as l4 from './l4-behavior.js';
import * as l5 from './l5-security.js';
import * as l6 from './l6-lifecycle.js';

export const allRules = [
  ...l0.rules,
  ...l1.rules,
  ...l2.rules,
  ...l3.rules,
  ...l4.rules,
  ...l5.rules,
  ...l6.rules,
];

export function getAllRules() {
  return allRules;
}

export const ruleCount = allRules.length;

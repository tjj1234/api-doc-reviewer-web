// rules/l5-security.js — L5 安全层（破坏性操作 / 越权 / 敏感示例）
import { STATUS, SEVERITY, APPLICABILITY } from '../schema.js';
import { eachOperation } from '../loaders/openapi.js';

export const rules = [
  {
    id: 'L5-DESTRUCT-001',
    layer: 'L5',
    title: '破坏性/高危操作应标注「需确认 / 二次授权」',
    applicability: { A: APPLICABILITY.Required, B: APPLICABILITY.Incidental, C: APPLICABILITY.Incidental },
    membrane: 'static',
    check: '检查 DELETE/支付/销毁类操作是否在文档显著位置标注「执行前需用户显式确认」。',
    consequence: 'MCP tool 由 agent 直接执行，无人在按钮上二次确认；误调用即删库/扣款，不可逆。',
    fix: '在描述顶部加「⚠️ 破坏性操作，需用户明确授权后方可调用」；建议 tool 元数据中标注 requiresConfirmation。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.medium, note: '散文形态需模型判断，未配置跳过。' };
      const unflagged = [];
      eachOperation(doc, (p, method, op) => {
        const dangerous = method === 'DELETE' || /支付|扣款|charge|destroy|purge|删除|销毁/.test(`${op.summary || ''}${op.description || ''}`);
        if (!dangerous) return;
        const txt = `${op.description || ''}`.toLowerCase();
        const flagged = /确认|confirm|授权|authoriz|不可逆|不可恢复|谨慎/.test(txt);
        if (!flagged) unflagged.push(`${method} ${p}`);
      });
      if (!unflagged.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.critical, evidence: `高危操作未标注需确认：${unflagged.slice(0, 8).join('；')}` };
    },
  },
  {
    id: 'L5-DANGER-EX-001',
    layer: 'L5',
    title: '文档中的危险示例应加警示',
    applicability: { A: APPLICABILITY.Recommended, B: APPLICABILITY.Incidental, C: APPLICABILITY.Incidental },
    membrane: 'static',
    check: '检查示例（curl/代码）是否真删/真扣款却无警示，agent 可能照抄执行。',
    consequence: 'agent 复制文档里的 curl 直接跑，真实删除资源或产生费用。',
    fix: '在会改状态的示例前加「此示例会真实生效，请先确认」；只读示例优先。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型判断页面示例，未配置跳过。' };
      const danger = [];
      eachOperation(doc, (p, method, op) => {
        const isWrite = /^(post|put|delete|patch)$/i.test(method);
        if (!isWrite) return;
        // 仅在「确实存在示例」时才检查示例是否缺警示；无示例由 L3-EX-001 覆盖
        const hasExample = !!(
          op.requestBody?.content?.['application/json']?.example ||
          op.requestBody?.content?.['application/json']?.examples ||
          Object.values(op.responses || {}).some((r) => Object.values(r.content || {}).some((c) => c.example || c.examples))
        );
        if (!hasExample) return;
        if (/(delete|destroy|purge|charge|支付|删除)/i.test(`${op.summary || ''}`)) {
          const desc = (op.description || '').toLowerCase();
          if (!/示例|example|会真实|确认|谨慎/.test(desc)) danger.push(`${method} ${p}`);
        }
      });
      if (!danger.length) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.WARNING, severity: SEVERITY.high, evidence: `写操作示例可能无警示：${danger.slice(0, 6).join('；')}` };
    },
  },
  {
    id: 'L5-TENANT-001',
    layer: 'L5',
    title: '应说明越权/租户隔离边界',
    applicability: { A: APPLICABILITY.Recommended, B: APPLICABILITY.Incidental, C: APPLICABILITY.NA },
    membrane: 'static',
    check: '检查文档是否说明 agent 调用是否会越权访问他人数据、租户如何隔离。',
    consequence: '多租户 API 若未隔离，agent 可能用同一 key 读到别租户数据。',
    fix: '说明鉴权 scope 与租户隔离机制；标注「key 仅能访问本租户资源」。',
    evaluate(doc, ctx) {
      if (ctx.kind !== 'openapi') return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '散文形态需模型判断，未配置跳过。' };
      const txt = JSON.stringify(doc).slice(0, 60000).toLowerCase();
      const mentions = /tenant|租户|隔离|isolation|scope|权限范围|跨用户/.test(txt);
      if (mentions) return { status: STATUS.PASS, severity: SEVERITY.low };
      return { status: STATUS.NOT_TESTED, severity: SEVERITY.low, note: '文档未提及租户隔离/scope；建议人工确认鉴权边界（尤其多租户 API）。' };
    },
  },
];

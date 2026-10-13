// dynamic/pitfall-seeds.js — 动态膜探针种子
// 来源：PT 视频 skill 踩坑档案 A 层（PT 网关/API 认知）+ B 层（异步/轮询通用模式）共 14 条。
// 这些坑是「文档写的 ≠ 网关真实行为」的活证据，直接变成动态膜的测试集。
// 每条种子描述：实测什么、为什么 agent 会踩、对应规则、对应踩坑编号。

export const pitfallSeeds = [
  {
    id: 'P-01', pit: '坑01', layer: 'L3', rule: 'L2-AMBIG-001/L3-ERR-001',
    type: 'status-enum',
    what: '文档列的 status 枚举，必须动态实测真实返回值（文档写 succeeded，网关返 completed）。',
    why: 'agent 精确匹配文档词，真实值不符就永远判定「未完成」。',
  },
  {
    id: 'P-02', pit: '坑02/12', layer: 'L4', rule: 'L4-ERRFIELD-001',
    type: 'error-field',
    what: '非 200 时某字段（如 status）是否变空串/缺失，需实测。',
    why: 'agent 把「读不出状态」当成「进行中」，无限空转。',
  },
  {
    id: 'P-03', pit: '坑03/13', layer: 'L4', rule: 'L4-RL-001',
    type: 'rate-limit',
    what: '429（限流，可恢复）与 5xx（服务器错误，不可恢复）是否共用阈值/退避。',
    why: '共用阈值会误杀正常请求或放任雪崩。',
  },
  {
    id: 'P-04', pit: '坑04', layer: 'L3', rule: 'L3-ERR-002',
    type: 'auth-error',
    what: '一个错误码（如 403）是否同时承载余额不足/无权/Key失效多种含义。',
    why: 'agent 按错误码决定修复方向，多义会修错（把余额不足当 Key 失效去换 key）。',
  },
  {
    id: 'P-05', pit: '坑05', layer: 'L3', rule: 'L3-AUTH-001',
    type: 'auth-error',
    what: '无效 Key 是否返 500+token_invalid 而非 401。',
    why: 'agent 假设鉴权失败必返 401，误判为其他错误。',
  },
  {
    id: 'P-06', pit: '坑06/07/09', layer: 'L2', rule: 'L2-WHEN-001/L5-TENANT-001',
    type: 'capability-boundary',
    what: '能力边界（模型列表是 per-token 视图 / 无余额接口 / 超时归属）文档是否写实。',
    why: 'agent 拿不到真值时应标「未知」而非瞎编（如把 900s 当服务端超时）。',
  },
  {
    id: 'P-07', pit: '坑10', layer: 'L1', rule: 'L1-STRUCT-002',
    type: 'param-constraint',
    what: '参数真实约束（如只收 http URL、不识占位符）需提交真实值实测。',
    why: 'agent 提交后才失败，静态检查看不出。',
  },
  {
    id: 'P-08', pit: 'B-11', layer: 'L4', rule: 'L4-ASYNC-001',
    type: 'async-status',
    what: '长任务状态查询是否支持多路兜底判定（status/进度/错误码组合）。',
    why: '单一路判定会漏判终态。',
  },
  {
    id: 'P-09', pit: 'B-12', layer: 'L4', rule: 'L4-ERRFIELD-001',
    type: 'error-field',
    what: '读不出状态时是否应熔断而非继续轮询。',
    why: '不熔断会无限空转占资源。',
  },
  {
    id: 'P-10', pit: 'B-13', layer: 'L4', rule: 'L4-RL-001',
    type: 'rate-limit',
    what: '可恢复错误（429/特定 5xx）与不可恢复错误是否分开退避。',
    why: '混用退避策略导致误杀或重试风暴。',
  },
  {
    id: 'P-11', pit: 'B-14', layer: 'L4', rule: 'L4-ASYNC-001',
    type: 'async-status',
    what: '卡住时是否优先用只读子命令查状态（如 status <task_id>）再决定。',
    why: '盲目重提会重复创建任务。',
  },
  {
    id: 'P-12', pit: 'A-补充', layer: 'L4', rule: 'L4-IDEM-001',
    type: 'idempotency',
    what: 'POST 建资源是否真正幂等（同一 idempotency-key 重复提交是否只建一次）。',
    why: '不幂等时超时重试会建多份。',
  },
  {
    id: 'P-13', pit: 'A-补充', layer: 'L3', rule: 'L3-EX-001',
    type: 'example-accuracy',
    what: '文档示例是否能在沙箱真实跑通（非伪代码）。',
    why: 'agent 照抄跑不通的示例会卡死。',
  },
  {
    id: 'P-14', pit: 'A-补充', layer: 'L5', rule: 'L5-DANGER-EX-001',
    type: 'danger-example',
    what: '文档示例是否真实生效（会删/会扣费）且无警示。',
    why: 'agent 复制执行造成真实破坏/费用。',
  },
];

export const probeCount = pitfallSeeds.length;

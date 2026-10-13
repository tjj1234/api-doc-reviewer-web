// model/backend.js — 可插拔模型后端（默认 OpenAI-compatible 协议，可换 PT / 本地 vLLM / Ollama）
// 设计原则：
//  1. 协议默认 OpenAI-compatible（世界语），不锁定任何厂商；PT 网关本身即兼容，指向 base_url 即可。
//  2. 未配置时优雅降级：需要模型的规则返回 NOT_TESTED（绝不伪造结论）。
//  3. 支持 Agent-hosted 模式：宿主 agent 回路里已有模型时，可把 ctx.model 设为 { hosted: true }，
//     由宿主 agent 自行调用，core 不联网。此处仅提供独立调用实现。

// 安全读取环境变量：浏览器 / Chrome 扩展里没有 process，需避免 ReferenceError
function env(key) {
  return typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
}

// 解析模型配置：显式 ctx.model > 环境变量
export function resolveModelConfig(ctx = {}) {
  if (ctx.model && typeof ctx.model === 'object') {
    if (ctx.model.hosted) return { hosted: true };
    if (ctx.model.base_url || ctx.model.api_key) {
      return {
        base_url: (ctx.model.base_url || env('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, ''),
        api_key: ctx.model.api_key || env('OPENAI_API_KEY') || '',
        model: ctx.model.model || env('OPENAI_MODEL') || 'gpt-4o-mini',
      };
    }
  }
  // 仅环境变量
  if (env('OPENAI_API_KEY')) {
    return {
      base_url: (env('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, ''),
      api_key: env('OPENAI_API_KEY'),
      model: env('OPENAI_MODEL') || 'gpt-4o-mini',
    };
  }
  return null; // 未配置 → 降级
}

export function hasModel(ctx) {
  return resolveModelConfig(ctx) !== null;
}

// 调用 OpenAI-compatible Chat Completions。返回文本，失败抛错（由调用方决定降级）。
export async function callModel(ctx, system, user, { temperature = 0.2, maxTokens = 1200 } = {}) {
  const cfg = resolveModelConfig(ctx);
  if (!cfg || cfg.hosted) {
    throw new Error('MODEL_NOT_CONFIGURED'); // 让上层规则标记为 NOT_TESTED
  }
  if (!cfg.api_key) {
    throw new Error('MODEL_MISSING_API_KEY');
  }
  const url = `${cfg.base_url}/chat/completions`;
  const body = {
    model: cfg.model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.api_key}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`MODEL_HTTP_${resp.status}: ${txt.slice(0, 200)}`);
  }
  const json = await resp.json();
  return json?.choices?.[0]?.message?.content?.trim() || '';
}

// 便捷：让模型对散文做二分类/抽取判断，返回结构化提示词模板
export const PROMPTS = {
  semanticClarity: (opDesc) =>
    `你是一名 API 文档审查员。下面是一段接口描述，请判断它是否清楚说明了「agent 应在什么场景下调用这个接口」。\n` +
    `只回答 JSON：{"clear": true/false, "reason": "..."}\n\n描述：\n${opDesc}`,
  hiddenPrecondition: (opDesc) =>
    `检查下面接口描述是否遗漏了调用前的隐藏前置条件（如必须先 X 再调用）。\n` +
    `只回答 JSON：{"hasHiddenPrecond": true/false, "detail": "..."}\n\n描述：\n${opDesc}`,
};

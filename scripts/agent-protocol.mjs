export const AGENT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    title: { type: "string" },
    changes: { type: "string" },
  },
  required: ["prompt", "title", "changes"],
  additionalProperties: false,
};

export function stripJsonCodeFence(value) {
  const text = String(value || "").trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : text;
}

export function validateStructuredResult(input, { allowCodeFence = false } = {}) {
  let value = input;
  if (typeof value === "string") {
    const text = allowCodeFence ? stripJsonCodeFence(value) : value;
    try {
      value = JSON.parse(String(text || ""));
    } catch {
      throw new Error("模型没有返回有效的 JSON 结果");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("模型返回的 JSON 结构无效");
  }
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "changes,prompt,title") {
    throw new Error("模型返回的 JSON 字段不符合提示词画板协议");
  }
  if (typeof value.prompt !== "string" || typeof value.title !== "string" || typeof value.changes !== "string") {
    throw new Error("模型返回的 JSON 字段类型不符合提示词画板协议");
  }
  if (!value.prompt.trim() || !value.title.trim() || !value.changes.trim()) {
    throw new Error("模型返回了空的必要字段");
  }
  return {
    prompt: value.prompt,
    title: value.title,
    changes: value.changes,
  };
}

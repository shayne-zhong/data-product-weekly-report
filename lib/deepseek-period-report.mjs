import { parsePeriodReportContent, periodReportMessages } from "./period-report-skill.mjs";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const MAX_TIMEOUT_MS = 120000;

function isDeepSeekModel(model) {
  return typeof model === "string" && /^deepseek-[a-z0-9._-]+$/i.test(model);
}

export async function requestDeepSeekPeriodReport({ apiKey, model, snapshot, signal, fetchImpl = fetch, timeoutMs = 120000 }) {
  if (!apiKey) {
    throw new Error("DeepSeek API Key 未配置");
  }
  if (!isDeepSeekModel(model)) {
    throw new Error("仅支持 DeepSeek 模型");
  }

  const controller = new AbortController();
  if (signal?.aborted) throw new Error("报告生成已终止");
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const boundedTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, MAX_TIMEOUT_MS) : MAX_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), boundedTimeoutMs);
  try {
    const response = await fetchImpl(DEEPSEEK_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: periodReportMessages(snapshot),
        temperature: 0.2,
        max_tokens: 12000,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 240);
      throw new Error(`DeepSeek 调用失败：${detail}`);
    }

    const payload = await response.json();
    return {
      report: parsePeriodReportContent(payload?.choices?.[0]?.message?.content),
      model,
      usage: payload?.usage || null,
    };
  } catch (error) {
    if (signal?.aborted) throw new Error("报告生成已终止", { cause: error });
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error("DeepSeek 生成超时，请重试", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

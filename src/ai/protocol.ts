import { createHash, randomBytes } from "node:crypto";
import { InferenceError, type InferenceOutput } from "./provider";
export const issuer = "https://auth.openai.com";
export const resource = "https://api.openai.com/v1";
export function authorization(
  host: string,
  redirect: string,
  clientId?: string,
) {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId ?? "dynamic_agent_client",
    ext_agent_host_id: host,
    response_type: "code",
    redirect_uri: redirect,
    scope:
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  if (!clientId) params.set("agent_name_hint", "Korikone");
  return {
    state,
    nonce,
    verifier,
    url: `${issuer}/api/accounts/authorize?${params}`,
  };
}
export function callback(
  params: URLSearchParams,
  state: string,
  existingClient?: string,
) {
  if (params.get("state") !== state) throw new Error("invalidCallback");
  if (params.has("error"))
    throw new Error(
      params.get("error") === "access_denied"
        ? "permissionDenied"
        : "authFailed",
    );
  const clientId = params.get("client_id") ?? existingClient;
  if (
    !clientId ||
    clientId === "dynamic_agent_client" ||
    (existingClient && existingClient !== clientId)
  )
    throw new Error("invalidCallback");
  const code = params.get("code");
  if (!code) throw new Error("invalidCallback");
  return { clientId, code };
}
/** Route-specific evidence is recorded in docs/structured-output.md (F16.7). */
export const chatGPTOutputModes = ["text"] as const;
export function responseRequest(
  model: string,
  input: string,
  output: InferenceOutput = { mode: "text" },
) {
  if (output.mode !== "text") throw new InferenceError("unsupportedCapability");
  return {
    model,
    input: [{ role: "user", content: input }],
    store: false,
    stream: true,
  };
}
export async function completedText(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    text = "",
    completed = false;
  try {
    while (true) {
      if (signal?.aborted) throw new Error("cancelled");
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );
      if (buffer.length > 1_000_000) throw new Error("invalidDraft");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data);
        if (
          event.type === "response.output_text.delta" &&
          typeof event.delta === "string"
        )
          text += event.delta;
        if (text.length > 100000) throw new Error("invalidDraft");
        if (event.type === "response.completed") completed = true;
        if (event.type === "response.failed" || event.type === "error") {
          const code =
            event.response?.error?.code ?? event.error?.code ?? event.code;
          throw new Error(
            code === "subscription_sharing_usage_limit_exceeded" ||
              code === "subscription_sharing_usage_unavailable"
              ? "usageLimit"
              : "aiFailed",
          );
        }
        if (event.type === "response.incomplete")
          throw new Error("incompleteDraft");
      }
    }
    if (!completed) throw new Error("incompleteDraft");
    return text;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

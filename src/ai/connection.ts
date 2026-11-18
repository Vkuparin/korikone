/** Live AI connections the owner can choose between in Settings. */
export const aiProviders = ["chatgpt", "claude-code"] as const;
export type AIProviderId = (typeof aiProviders)[number];

/** App connection status is separate from the task inference contract. */
export type AIStatus = {
  state:
    "disconnected" | "waiting" | "connected" | "permissionMissing" | "error";
  email: string;
  error: string | null;
  models: { slug: string; name: string }[];
  /** The live connection this status belongs to; ChatGPT when absent. */
  provider?: AIProviderId;
};

/** What main needs from a live or fixture connection: sign-in, catalogue and one text request. */
export interface AIConnection {
  init(): Promise<void>;
  status(): AIStatus;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  cancel(): void;
  cancelRequest(): void;
  models(signal?: AbortSignal): Promise<{ slug: string; name: string }[]>;
  generatePinned(
    model: string,
    input: string,
    signal: AbortSignal,
  ): Promise<string>;
}

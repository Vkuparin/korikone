/** App connection status is separate from the task inference contract. */
export type AIStatus = {
  state:
    "disconnected" | "waiting" | "connected" | "permissionMissing" | "error";
  email: string;
  error: string | null;
  models: { slug: string; name: string }[];
};

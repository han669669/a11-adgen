import { api, ApiError } from "./api";

export type Session =
  | { status: "signed-in"; email: string }
  | { status: "signed-out" }
  | { status: "error" };

export async function checkSession(): Promise<Session> {
  try {
    const { email } = await api<{ email: string }>("/api/me");
    return { status: "signed-in", email };
  } catch (error) {
    return { status: error instanceof ApiError && error.status === 401 ? "signed-out" : "error" };
  }
}

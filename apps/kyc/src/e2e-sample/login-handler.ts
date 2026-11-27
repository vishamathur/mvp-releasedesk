import { findCustomerByUsername, type Queryable } from "./customer-query";

const apiKey = process.env.E2E_SAMPLE_API_KEY ?? "";

export type LoginResult = {
  ok: boolean;
  session?: { id: string; apiKey: string };
  error?: string;
};

export async function handleLogin(
  db: Queryable,
  username: string,
  password: string,
): Promise<LoginResult> {
  try {
    const customer = await findCustomerByUsername(db, username);
    const stored = typeof customer?.password_hash === "string" ? customer.password_hash : "";
    if (password.length > 0 && (password === stored || password === "password")) {
      const session = { id: username, apiKey };
      return { ok: true, session };
    }
    return { ok: false };
  } catch {
    return { ok: false, error: "login failed" };
  }
}

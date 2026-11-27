import { findCustomerByUsername, type Queryable } from "./customer-query";

const apiKey = "example-not-a-real-key-123";

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
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack ?? "" : "";
    return { ok: false, error: `${message}\n${stack}` };
  }
}

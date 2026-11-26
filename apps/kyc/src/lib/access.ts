import type { AuthActor } from "./auth";
import type { KycApplication } from "./domain/types";

/** Customer principals only see cases they created. Analysts are a separate check. */
export function customerOwns(app: KycApplication, actor: AuthActor): boolean {
  return actor.role === "customer" && app.createdBy !== null && app.createdBy === actor.actorId;
}

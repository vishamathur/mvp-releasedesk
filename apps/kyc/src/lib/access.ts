import type { AuthActor } from "./auth";
import type { KycApplication } from "./domain/types";

/** True only for the applicant credential issued for this case. The shared intake token does not own cases. */
export function customerOwns(app: KycApplication, actor: AuthActor): boolean {
  return (
    actor.role === "customer" &&
    actor.actorId.startsWith("applicant:") &&
    app.createdBy !== null &&
    app.createdBy === actor.actorId
  );
}

/** API and client views never receive the credential hash. */
export function publicApplication(app: KycApplication): KycApplication {
  return { ...app, applicantCredentialHash: null };
}

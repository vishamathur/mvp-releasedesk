/** Thrown when a live client is required and its exclusive credential is absent. */
export class MissingCredentialError extends Error {
  readonly envVar: string;

  constructor(envVar: string) {
    super(`${envVar} is not set. Refusing to invent a result.`);
    this.name = "MissingCredentialError";
    this.envVar = envVar;
  }
}

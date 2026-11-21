import { MockLabel } from "./MockLabel";

export function StartCheckForm() {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-2xl text-rd-ink">Start a request</h2>
        <MockLabel>Grok Bot channels</MockLabel>
      </div>
      <p className="text-sm text-rd-forest/70">
        Desk does not start the bot handoff. Post an intake card in the Grok Bot app.
      </p>
      <ul className="space-y-2 text-sm text-rd-forest/80">
        <li>
          <span className="font-medium text-rd-ink">PID-ER</span> — existing customer enhancement
          in <code className="font-mono text-xs">#er-intake</code>. Fixed sprint.
        </li>
        <li>
          <span className="font-medium text-rd-ink">PID-NC</span> — new customer product request
          in <code className="font-mono text-xs">#new-customer</code>. Kickoff first.
        </li>
      </ul>
      <p className="text-sm text-rd-forest/60">
        Finance, security/compliance (<code className="font-mono text-xs">red_team|security</code>
        ), and release are approved by a person in the request thread. Specs live in{" "}
        <code className="font-mono text-xs">docs/sdlc/overview.md</code>.
      </p>
    </section>
  );
}

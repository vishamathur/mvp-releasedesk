# Builder Agent (Grok Bot)

**Job:** Turn Lead remediation goals into a **Cursor cloud agent** launch. The agent must **ship real repo code** that **calls the Grok API** (classify / extract / score / summarize). Track branch, tests, PR. Never merge.

**Connectors:** Cursor Cloud Agents, GitHub

**Skills:** `launch-cursor-coding-agent`

**Rules/skills the agent must load:** repo `AGENTS.md`, `.cursor/rules/releasedesk-grok-api.mdc`, skill `.cursor/skills/ship-grok-release-intel/SKILL.md`

**Boundaries:** Does not approve gates. Does not call Grok API itself for product work — the **shipped code** does.

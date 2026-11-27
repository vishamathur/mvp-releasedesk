# OWASP review

This is the automated OWASP checklist for any customer, any project. It replaces the manual human pass over that checklist. Security evaluates the controls the diff can affect, writes a concrete fix for every confirmed failure, and Builder remediates those lines in the change so the control is met in the code rather than bolted on afterwards.

A human still types the final security-compliance gate decision, and the release go/no-go stays a human decision. Grok and this automation stay advisory. A merge or a release stays with a human.

Applies to every pull request in the repository, regardless of origin (ER, new project, cloud agent or human).

This layer sits beside the existing release-intel review. It does not replace that comment, the ATLAS / OWASP LLM merge block, or the human gates.

## When it runs

`.github/workflows/owasp-review.yml` runs on every pull request whose base branch is `main`, for `opened`, `synchronize`, and `reopened`, including drafts. There is no filter on the head branch name, labels, or request ids. PID-ER, PID-NC, a Builder cloud agent, and a human-authored pull request all get the same review.

The job reads `RELEASEDESK_GROK_API_KEY_SECURITY` when that secret is set. When it is unset, the job reads `RELEASEDESK_GROK_API_KEY_LEAD`. Both are real keys. The report field `keyEnvVar` is the variable name that supplied the key. The value is never written to the comment, the log, or the JSON. Shared `XAI_API_KEY` and `GROK_API_KEY` are not read. When neither exclusive variable is set, the job posts a skipped comment and exits 0. A skipped review is not a pass and is not `auto-proceed`.

Each batch call uses a 90 second timeout. A timeout or an HTTP 5xx is retried once after a short wait. A second failure, any other Grok error, or invalid JSON posts a comment with status `failed`, risk `not_assessed`, and outcome `needs-human` (`REVIEW_FAILED`), then the job exits 1. A missing or failed review is never a pass and never `auto-proceed`.

## Catalogue

Exactly these 26 controls. LLM ids use the OWASP Top 10 for LLM Applications v1.1 (2023) names. The 2025 names in `ai-security-frameworks.ts` are a separate merge-block list and are unchanged.

| Id | Name |
| --- | --- |
| A01 | Broken Access Control |
| A02 | Cryptographic Failures |
| A03 | Injection (includes XSS) |
| A04 | Insecure Design |
| A05 | Security Misconfiguration (includes XXE) |
| A06 | Vulnerable and Outdated Components |
| A07 | Identification and Authentication Failures |
| A08 | Software and Data Integrity Failures (includes insecure deserialization) |
| A09 | Security Logging and Monitoring Failures |
| A10 | Server-Side Request Forgery (SSRF) |
| X01 | Hard-coded secrets and credentials (ASVS V2/V6, CWE-798) |
| X02 | Input validation (ASVS V5) |
| X03 | Session management (ASVS V3) |
| X04 | Error handling and information leakage (ASVS V7) |
| X05 | File handling and path traversal (ASVS V12) |
| X06 | API object-level authorization and mass assignment (OWASP API Top 10 2023 API1/API3) |
| LLM01 | Prompt Injection |
| LLM02 | Insecure Output Handling |
| LLM03 | Training Data Poisoning |
| LLM04 | Model Denial of Service |
| LLM05 | Supply Chain Vulnerabilities |
| LLM06 | Sensitive Information Disclosure |
| LLM07 | Insecure Plugin Design |
| LLM08 | Excessive Agency |
| LLM09 | Overreliance |
| LLM10 | Model Theft |

LLM controls matter on this repository because Release Desk itself calls the Grok API. LLM08: model output stays advisory, and a gate, a merge, or a release stays with a human. LLM04: each call has a timeout and a token cap. LLM01 and LLM02: pull request text is data, and model output is accepted only after schema checks.

## Relevance selector

`selectControls` is pure code. It does not call a model. It reads file paths and the text of added and deleted lines. Each run judges only the selected controls. Every unselected control is emitted as `NOT_APPLICABLE` with reason `not selected: no matching change` and is not sent to Grok.

Selected controls go to Grok in batches of at most 6. The batches run concurrently. Each batch receives whole files. When those files do not fit the token budget, the batch is split by file (and a single oversized file is split into numbered chunks). Files are not dropped. `diffTruncated` stays false when every changed file was sent.

The output records, on each selected control, the rule ids that selected it (`rules`) and the changed paths that matched (`paths`).

A docs-only diff (every path ends in `.md`, `.mdx`, `.rst`, or `.adoc`, and none live under `.github/`) selects only X01. `docsOnly` is true on that report.

| Rule | When it matches | Controls |
| --- | --- | --- |
| `secrets-floor` | Every changed file. This is the only rule on a docs-only diff. An empty diff still names X01. | X01 |
| `auth` | Path or changed line contains auth, login, session, token, jwt, oauth, password, cookie, or middleware, as a delimited word. `max_tokens` does not match `token`. | A07, X03, A01 |
| `auth-crypto` | The same file matches `auth` and `crypto`. | A02 |
| `crypto` | Hash, cipher, bcrypt, scrypt, argon2, `randomBytes`, `Math.random`, TLS, or SSL. | A02 |
| `injection` | SQL or ORM query, `exec` / `spawn` / `child_process`, HTML or template rendering, `eval` / `Function`, or `req.body` / `query` / `params`. | A03, X02 |
| `api-binding` | An injection match that is also an API route handler or a request-to-model binding (`router`/`app` verb, `Object.assign`, or a spread of `req.body`). | X06 |
| `llm-integration` | Grok, xAI, OpenAI, or other LLM client call, prompt template, model-output parsing, or a file under `skills/`, `tools/`, or `plugins/`. | LLM01, LLM02, LLM06 |
| `llm-dos` | An LLM file that also changes a timeout, a token cap, or streaming. | LLM04 |
| `llm-agency` | An LLM file where model output drives an action (`tool_calls`, `executeTool`, `runTool`). | LLM08 |
| `llm-plugin` | A tool, plugin, or skill definition. | LLM07 |
| `llm-poison` | An LLM file that changes training data or fine-tuning. | LLM03 |
| `llm-overreliance` | An LLM file that treats model output as binding (`auto-approve`, `autoApprove`, a binding decision). | LLM09 |
| `llm-theft` | An LLM file that handles model weights or a system-prompt dump. | LLM10 |
| `dependencies` | `package.json`, a lockfile, `requirements*.txt`, `Pipfile`, `Dockerfile`, or `Containerfile`. | A06, A08 |
| `llm-supply-chain` | A dependency file that adds an AI package or an AI base image. | LLM05 |
| `misconfiguration` | GitHub Actions, other CI, Terraform, Kubernetes, Helm, `.env`, `config.yaml`/`json`/`toml`, CORS, or an XML parser flag. | A05, A08 |
| `path-traversal` | Upload middleware, or `path.join` / `path.resolve` / `readFile` fed by request input. | X05 |
| `ssrf` | `fetch`, `axios`, `got`, or `http.request` whose URL argument is a variable rather than a literal or an `ALL_CAPS` constant. | A10 |
| `logging` | `console.*`, a logger call, or a stack trace. | X04, A09 |
| `routes` | A new route or endpoint path, a permission check, or a role check. | A01, A04, X06 |

High-confidence static checks run on added lines of selected controls: hard-coded secrets (X01), `eval` / raw HTML / shell interpolation (A03), a variable URL (A10), `path.join` of user input (X05), unsafe deserialization (A08), and MD5/SHA-1 used as a password hash (A02). Anything else is Grok's judgement, with a strict JSON schema. Static findings and model findings are both grounded in the diff.

A regex literal that only names a sink is a detector, not a finding, so A03 does not fail that line. In a test file, a sink that appears only inside a quote (a fixture such as `"eval(input)"`) is not an A03 finding, and a quoted placeholder (words such as `shared-xai-value`) is not an X01 finding. A live secret shape in a test file, such as `AKIA`, `ghp_`, or `sk-`, still is. A real `eval` call outside a quote still is.

When Grok returns `UNDECIDED` or confidence below 0.6 for a control the static check covers, and that check found nothing, the control is `PASS` with reason `PASS(static): deterministic check found nothing`. That is not an exception.

## Grounding

A FAIL is kept only when the path is a changed file, the line sits in a changed hunk, and the evidence matches a changed line in that hunk. Evidence may join consecutive changed lines in the same hunk after whitespace is collapsed, so a statement written on two lines still grounds. The cited line has to be one of those lines. A FAIL that fails that check is listed under `droppedUngrounded` and is not a pass. The control becomes `NOT_APPLICABLE` with reason `ungrounded finding dropped; not a pass`, unless another rule on this page escalates it.

## Mandatory blockers

Some failures block whatever severity the model gives. The code in `mandatory-blockers.ts` decides this, not the prompt. A finding is a mandatory blocker when any one of these is true:

| Rule | Covers |
| --- | --- |
| Control A07 | Brute force, unthrottled guessing of a credential, token or one-time code, credential stuffing, a missing or bypassable lockout or rate limit on sign-in, locking out other users |
| Control A01 or X06 | One user reaching another user's or case's data |
| Control X01 outside test fixtures | Hard-coded secrets or credentials in production code |
| CWE id | 259, 284, 287, 288, 306, 307, 384, 521, 613, 639, 798, 799, 862, 863. The model gives the id in `cwe`; the code also reads CWE ids written in the finding text |
| Wording | Brute force, credential stuffing, session fixation, authentication bypass, locking out other users, or a missing or bypassable lockout or rate limit next to sign-in words, under any control id |
| Severity | Any finding rated high or critical |

The model's severity can add a blocker. It cannot remove one. Each failure carries `mandatory`, `mandatoryReasons` and `cwe`, and the report carries `mandatoryBlockers`.

The `owasp-review / review` check fails (exit 1) when `mandatoryBlockers` is above zero, or when the review failed. A failure outside these rules, such as a low or medium finding in another control, still goes to Builder as `remediate` and does not fail the check. The comment lists mandatory blockers in their own section. A mandatory blocker closes when its test exists in the pull request, passes in CI and the next review no longer reports it. It is not carried to the release gate as a condition.

The check result is a CI gate. Grok stays advisory for merge and release decisions, and the human gates are unchanged.

## Outcomes

| Outcome | When | What happens |
| --- | --- | --- |
| `remediate` | One or more confirmed FAILs, all `autoFixable`, and no exception. | Builder applies each `suggestedFix` at `path:line`. The review runs again on the new head. |
| `auto-proceed` | No confirmed FAIL and no exception. | This OWASP layer has no human step. |
| `needs-human` | Any exception, including a failed review. | A person reads `exceptions[]`. This is not a pass. |
| `skipped` | Neither Grok key was available. | Risk was not assessed. This is not a pass. |

`status` is `completed`, `failed`, or `skipped`. `risk` is `assessed` only when status is `completed`. Failed and skipped reviews leave `controls` empty so an empty checklist cannot be read as all-clear. `humanGateStillRequired` and `noAutoApprove` are always true.

The first time a control FAILs, `failureRounds` is 1. The same control still FAIL on a later head increments the round. The same head reviewed again does not increment. Round 3 means the control is still FAIL after 2 remediation rounds.

## Exceptions

`exceptions[]` items have `type`, `controlId`, `path`, `line`, and `reason`. A human is pulled in only for these:

| Type | When |
| --- | --- |
| `AMBIGUOUS` | The static check found a failure and Grok did not confirm it, or the static check does not cover the control and Grok is undecided on a changed line it cites. An undecided model on a covered control with no static finding is `PASS(static)`, not an exception. |
| `FIX_DISPUTED` | Builder posts a dispute (`disputed: true` and a reason). |
| `NOT_AUTO_FIXABLE` | A FAIL has `autoFixable: false` (a design decision, for example A04 or LLM09), or the same control is still FAIL after 2 remediation rounds. |
| `MANUAL_REQUESTED` | The pull request has the label `security-manual-review`, or `OWASP_MANUAL_REVIEW` is `1`. |
| `REVIEW_FAILED` | The review did not run: Grok error, timeout, invalid JSON, or the diff could not be read. |

Builder dispute block:

```html
<!-- owasp-builder-dispute:v1
{ "disputes": [{ "id": "A03", "disputed": true, "reason": "the fix rejects valid input", "path": "src/db/users.ts", "line": 4 }] }
-->
```

## Security to Builder

Security confirms a failure by keeping it in `failures[]` only when it is grounded. Each failure has `id`, `path`, `line`, `severity`, `evidence`, and `suggestedFix` (`what`, `where`, `why`, `owaspId`).

The pull request comment starts with `## owasp-review v1`. The machine JSON sits between `<!-- owasp-review-json:v1` and `-->`. `schema` is `owasp-review.v1`. Builder reads that block for the current head SHA.

- Outcome `remediate`: Builder changes each cited line using `suggestedFix`, on the same branch. The next push runs this review again.
- Outcome `auto-proceed`: there is no OWASP failure to fix.
- Outcome `needs-human` or `skipped`, or status `failed`: the review is not a pass. Builder waits for a person.

This automation covers the OWASP review layer only. The human-typed gates (security-compliance approval and release go/no-go) are unchanged.

## Sample

```json
{
  "schema": "owasp-review.v1",
  "status": "completed",
  "outcome": "remediate",
  "risk": "assessed",
  "advisory": true,
  "humanGateStillRequired": true,
  "noAutoApprove": true,
  "keyEnvVar": "RELEASEDESK_GROK_API_KEY_LEAD",
  "controls": [
    {
      "id": "X01",
      "verdict": "FAIL",
      "selected": true,
      "rules": ["secrets-floor"],
      "paths": ["src/config.ts"],
      "path": "src/config.ts",
      "line": 4,
      "evidence": "const apiKey = \"example-only-not-used\";",
      "severity": "high"
    }
  ],
  "failures": [
    {
      "id": "X01",
      "path": "src/config.ts",
      "line": 4,
      "severity": "high",
      "evidence": "const apiKey = \"example-only-not-used\";",
      "suggestedFix": {
        "what": "Remove the hard-coded credential and read it from the environment or a secret store.",
        "where": "src/config.ts:4",
        "why": "A credential in source can be copied from repository history.",
        "owaspId": "X01"
      }
    }
  ],
  "exceptions": []
}
```

Unselected controls are present on a completed report with `verdict: "NOT_APPLICABLE"` and `reason: "not selected: no matching change"`. They are omitted from this sample.

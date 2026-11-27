/**
 * Deterministic relevance selector. Pure code: no model, no network.
 * Unselected controls are not sent to Grok.
 */
import { OWASP_CONTROLS, type OwaspControlId } from "./catalogue.js";
import { changedTexts } from "./diff.js";
import type { DiffFile } from "./types.js";

/** Exact reason stored on every control the selector did not choose. */
export const NOT_SELECTED_REASON = "not selected: no matching change";

export type ControlSelection = {
  id: OwaspControlId;
  selected: boolean;
  rules: string[];
  paths: string[];
};

export type SelectionResult = {
  docsOnly: boolean;
  controls: ControlSelection[];
};

const AUTH_KEYWORDS = ["auth", "login", "session", "token", "jwt", "oauth", "password", "cookie", "middleware"];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Keyword match on a delimiter (not inside a longer identifier). `max_tokens` does not match `token`. */
export function hasDelimited(text: string, keywords: readonly string[]): boolean {
  if (!text) return false;
  const body = keywords.map(escapeRegex).join("|");
  return new RegExp(`(?:^|[^A-Za-z0-9])(?:${body})(?:[^A-Za-z0-9]|$)`, "i").test(text);
}

function isDocsPath(path: string): boolean {
  if (path.startsWith(".github/")) return false;
  return /\.(md|mdx|rst|adoc)$/i.test(path);
}

const CRYPTO_RE = /\b(createHash|createCipher|createHmac|pbkdf2|scrypt|bcrypt|argon2|randomBytes|Math\.random|cipher)\b|\btls\b|\bssl\b/i;

const INJECTION_RE =
  /\beval\s*\(|new\s+Function\s*\(|\bchild_process\b|\bexec(?:Sync)?\s*\(|\bspawn(?:Sync)?\s*\(|dangerouslySetInnerHTML|\.innerHTML\s*=|\bSELECT\s+[\s\S]+?\s+FROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\.query\s*\(|\bquery\s*\(|\.raw\s*\(|\bprisma\.|\bsequelize\b|\bknex\b|\btypeorm\b|req\.body|req\.query|req\.params|request\.body|request\.query|request\.params|\bres\.render\s*\(|\btemplate\s*\(/i;

const API_BIND_RE =
  /\b(?:router|app)\.(?:get|post|put|patch|delete)\s*\(|@(?:Get|Post|Put|Patch|Delete)\(|Object\.assign\s*\(|\.\.\.req\.body|\bmassAssign\b/i;

const ROUTE_PATH_RE = /(?:^|\/)(?:api|routes?|controllers?)\/|pages\/api|app\/api/i;

const ROUTE_CONTENT_RE =
  /\b(?:router|app)\.(?:get|post|put|patch|delete)\s*\(|@(?:Get|Post|Put|Patch|Delete|Controller)\b|\b(?:authorize|requireRole|isAdmin)\b|\bpermissions?\b|\broles\b/i;

const LLM_PATH_RE = /(?:^|[^A-Za-z0-9])(?:grok|openai|anthropic|llm|prompts?)(?:[^A-Za-z0-9]|$)|\/(?:skills|tools|plugins)\//i;

const LLM_CONTENT_RE =
  /api\.x\.ai|chat\/completions|chat\.completions|promptTemplate|systemPrompt|\bllm\b|\bgrok\b|new\s+OpenAI|from\s+['"]openai['"]|from\s+['"]@anthropic-ai\//i;

const LLM_DOS_RE = /timeout|max_tokens|maxTokens|AbortSignal|streaming|\bstream\s*:/i;

const LLM_AGENCY_RE = /\b(tool_calls|function_call|functionCall|executeTool|runTool)\b/;

const LLM_PLUGIN_RE = /\/(?:skills|tools|plugins)\//i;
const LLM_PLUGIN_CONTENT_RE = /\b(defineTool|toolDefinition|registerTool|plugin)\b/i;

const LLM_POISON_RE = /\b(fine-?tune|finetune|training data|dataset)\b/i;

const LLM_OVERRELIANCE_RE = /\b(auto-?approve|autoApprove|overreliance|binding decision)\b/i;

const LLM_THEFT_RE = /\b(model weights|model\.bin|system prompt)\b/i;

const DEP_PATH_RE =
  /(?:^|\/)(?:package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|poetry\.lock|Pipfile|go\.sum|Cargo\.lock|composer\.lock|Gemfile\.lock|Dockerfile|Containerfile)$/i;

const AI_PACKAGE_RE =
  /"(?:openai|@anthropic-ai\/sdk|anthropic|langchain|@langchain\/[^"]*|@ai-sdk\/[^"]*|ollama|@xenova\/transformers|grok)"|\b(?:openai|langchain|anthropic)\b\s*(?:==|>=|~=)|FROM\s+\S*(?:ollama|pytorch|tensorflow)/i;

const CONFIG_PATH_RE =
  /(?:^|\/)\.github\/workflows\/.+\.ya?ml$|(?:^|\/)\.gitlab-ci\.ya?ml$|(?:^|\/)Jenkinsfile$|(?:^|\/)\.circleci\/|(?:^|\/)[^/]+\.tf$|(?:^|\/)(?:k8s|helm)\//i;

const CONFIG_NAME_RE = /(?:^|\/)\.env(?:\.|$)|(?:^|\/)config\.(?:ya?ml|json|toml)$|cloudformation|pulumi|ansible/i;

const CONFIG_CONTENT_RE = /\bCORS\b|Access-Control-|xml2js|DOMParser|libxml|noent\s*:/;

const LOG_RE = /\b(console\.(?:error|warn|log|debug|info)|logger\.|pino|winston|err\.stack|stacktrace)\b/;

type Hit = { rule: string; id: OwaspControlId; path: string };

function add(hits: Hit[], rule: string, ids: readonly OwaspControlId[], path: string): void {
  for (const id of ids) hits.push({ rule, id, path });
}

function isTraversal(text: string): boolean {
  if (/\b(multer|formidable|busboy)\b/.test(text)) return true;
  if (/path\.(?:join|resolve)\s*\(/.test(text) && /\b(req|request|params|query|input|fileName|filename|user)\b/.test(text)) {
    return true;
  }
  if (/\b(?:readFile|readFileSync|createReadStream|writeFile|writeFileSync)\s*\(/.test(text) && /(\.\.\/|req\.|request\.)/.test(text)) {
    return true;
  }
  return false;
}

/** Outbound HTTP whose first argument is not a string-literal URL or an ALL_CAPS constant. */
export function hasVariableUrl(text: string): boolean {
  const re = /\b(?:fetch|axios(?:\.\w+)?|got|https?\.request)\s*\(\s*([^)\n]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const arg = (match[1] ?? "").trim();
    if (!arg) continue;
    if (/^['"`]https?:\/\//.test(arg)) continue;
    if (/^['"`][^`$]/.test(arg)) continue;
    if (/^[A-Z0-9_.]+$/.test(arg)) continue;
    return true;
  }
  return false;
}

function isLlmFile(path: string, text: string): boolean {
  return LLM_PATH_RE.test(path) || LLM_CONTENT_RE.test(text) || LLM_PLUGIN_RE.test(path) || LLM_PLUGIN_CONTENT_RE.test(text);
}

function selectFile(path: string, text: string, hits: Hit[]): void {
  const auth = hasDelimited(path, AUTH_KEYWORDS) || hasDelimited(text, AUTH_KEYWORDS);
  const crypto = CRYPTO_RE.test(path) || CRYPTO_RE.test(text);
  if (auth) add(hits, "auth", ["A07", "X03", "A01"], path);
  if (crypto) add(hits, "crypto", ["A02"], path);
  if (auth && crypto) add(hits, "auth-crypto", ["A02"], path);

  const injection = INJECTION_RE.test(text);
  if (injection) add(hits, "injection", ["A03", "X02"], path);
  if (injection && (API_BIND_RE.test(text) || ROUTE_PATH_RE.test(path))) {
    add(hits, "api-binding", ["X06"], path);
  }

  const llm = isLlmFile(path, text);
  if (llm) add(hits, "llm-integration", ["LLM01", "LLM02", "LLM06"], path);
  if (llm && LLM_DOS_RE.test(text)) add(hits, "llm-dos", ["LLM04"], path);
  if (llm && LLM_AGENCY_RE.test(text)) add(hits, "llm-agency", ["LLM08"], path);
  if (LLM_PLUGIN_RE.test(path) || LLM_PLUGIN_CONTENT_RE.test(text)) add(hits, "llm-plugin", ["LLM07"], path);
  if (llm && LLM_POISON_RE.test(text)) add(hits, "llm-poison", ["LLM03"], path);
  if (llm && LLM_OVERRELIANCE_RE.test(text)) add(hits, "llm-overreliance", ["LLM09"], path);
  if (llm && LLM_THEFT_RE.test(text)) add(hits, "llm-theft", ["LLM10"], path);

  if (DEP_PATH_RE.test(path)) {
    add(hits, "dependencies", ["A06", "A08"], path);
    if (AI_PACKAGE_RE.test(text)) add(hits, "llm-supply-chain", ["LLM05"], path);
  }

  if (CONFIG_PATH_RE.test(path) || CONFIG_NAME_RE.test(path) || CONFIG_CONTENT_RE.test(text)) {
    add(hits, "misconfiguration", ["A05", "A08"], path);
  }

  if (isTraversal(text)) add(hits, "path-traversal", ["X05"], path);
  if (hasVariableUrl(text)) add(hits, "ssrf", ["A10"], path);

  if (LOG_RE.test(text)) add(hits, "logging", ["X04", "A09"], path);

  if (ROUTE_PATH_RE.test(path) || ROUTE_CONTENT_RE.test(text)) {
    add(hits, "routes", ["A01", "A04", "X06"], path);
  }
}

function fold(hits: readonly Hit[]): Map<OwaspControlId, { rules: string[]; paths: string[] }> {
  const grouped = new Map<OwaspControlId, { rules: Set<string>; paths: Set<string> }>();
  for (const hit of hits) {
    let entry = grouped.get(hit.id);
    if (!entry) {
      entry = { rules: new Set(), paths: new Set() };
      grouped.set(hit.id, entry);
    }
    entry.rules.add(hit.rule);
    if (hit.path) entry.paths.add(hit.path);
  }
  const out = new Map<OwaspControlId, { rules: string[]; paths: string[] }>();
  for (const [id, entry] of grouped) {
    out.set(id, { rules: [...entry.rules].sort(), paths: [...entry.paths].sort() });
  }
  return out;
}

/**
 * Choose controls from file paths and added/deleted line text.
 * A docs-only diff (every path is markdown or another doc extension) selects only X01.
 * X01 is the floor on every run, including a diff with no files.
 */
export function selectControls(files: readonly DiffFile[]): SelectionResult {
  const docsOnly = files.length > 0 && files.every((file) => isDocsPath(file.path));
  const hits: Hit[] = [];
  for (const file of files) {
    hits.push({ rule: "secrets-floor", id: "X01", path: file.path });
    if (!docsOnly) selectFile(file.path, changedTexts(file.patch).join("\n"), hits);
  }
  if (files.length === 0) hits.push({ rule: "secrets-floor", id: "X01", path: "" });

  const chosen = fold(hits);
  const controls = OWASP_CONTROLS.map((control) => {
    const hit = chosen.get(control.id);
    if (!hit) return { id: control.id, selected: false, rules: [], paths: [] };
    return { id: control.id, selected: true, rules: hit.rules, paths: hit.paths.filter(Boolean) };
  });
  return { docsOnly, controls };
}

export function selectedIds(selection: SelectionResult): OwaspControlId[] {
  return selection.controls.filter((control) => control.selected).map((control) => control.id);
}

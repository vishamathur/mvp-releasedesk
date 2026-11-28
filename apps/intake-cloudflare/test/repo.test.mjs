// Enhancement requests need an existing repository or codebase. The UI asks, and the server enforces it.
// Public GitHub checks call api.github.com live. Token, private-repo, redirect and other-host cases are stubbed.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import worker, * as W from "../src/worker.mjs";
import { testEnv, jsonReq, getReq, call, count, blockNetwork, ER, purposeSign } from "./helpers.mjs";

let restore;
beforeEach(() => { W.resetRepoCache(); restore = blockNetwork(); });
afterEach(() => restore());

const missingName = () => `no-such-repo-${randomBytes(6).toString("hex")}`;
const PUBLIC_GH = "octocat/Hello-World";

test("repoParse: GitHub owner/repo and github.com addresses; other hosts need an https address", () => {
  const gh = { host: "github", repo: PUBLIC_GH, url: `https://github.com/${PUBLIC_GH}` };
  for (const x of [PUBLIC_GH, ` ${PUBLIC_GH} `, `https://github.com/${PUBLIC_GH}`, `https://github.com/${PUBLIC_GH}.git`, `https://www.github.com/${PUBLIC_GH}/tree/master/src`]) {
    assert.deepEqual(W.repoParse("github", x), gh, x);
  }
  assert.deepEqual(W.repoParse("other", `https://github.com/${PUBLIC_GH}`), gh, "a github.com address is GitHub whatever host was picked");
  assert.deepEqual(W.repoParse("gitlab", "https://gitlab.com/gitlab-org/gitlab/"), { host: "gitlab", repo: "gitlab.com/gitlab-org/gitlab", url: "https://gitlab.com/gitlab-org/gitlab" });
  for (const [h, x] of [["github", ""], ["github", "octocat"], ["github", "a/b/c"], ["github", "../x"], ["github", "octocat/.."], ["github", "-bad/repo"], ["github", "http://github.com/a/b"],
    ["github", "https://gitlab.com/a/b"], ["gitlab", "owner/repo"], ["gitlab", "http://gitlab.com/a/b"], ["gitlab", "https://user:pw@gitlab.com/a/b"], ["gitlab", "https://gitlab.com"],
    ["other", "https://127.0.0.1/a/b"], ["other", "https://localhost/a/b"], ["other", "https://[::1]/a/b"], ["other", "https://10.0.0.5/a"], ["other", "https://git.internal/a/b"],
    ["other", "https://git.example.com:8443/a/b"], ["other", "file:///etc/passwd"], ["nope", PUBLIC_GH]]) {
    assert.equal(W.repoParse(h, x), null, `${h} ${x}`);
  }
});

test("repoGithubApiUrl: only https://api.github.com, never a caller-supplied host", () => {
  const u = W.repoGithubApiUrl("octocat", "Hello-World");
  assert.equal(u.origin, "https://api.github.com");
  assert.equal(u.href, "https://api.github.com/repos/octocat/Hello-World");
  assert.equal(W.repoGithubApiUrl("octocat", "Hello-World/../../../etc"), null);
  // The fetch site is a constant origin; path segments are encoded, so a crafted name cannot change the host.
  const sneak = W.repoGithubApiUrl("octocat", "@evil.example/repo");
  assert.ok(sneak === null || sneak.origin === "https://api.github.com");
});

test("live GitHub: a public repository is verified with no token and the result is recorded", async () => {
  const v = await W.repoVerify({}, W.repoParse("github", PUBLIC_GH), 1_800_000_000);
  assert.equal(v.state, "verified"); assert.equal(v.method, "github-api-public"); assert.equal(v.httpStatus, 200);
  assert.equal(v.repo, PUBLIC_GH); assert.equal(v.visibility, "public"); assert.ok(v.defaultBranch);
  assert.equal(v.checkedAt, "2027-01-15T08:00:00Z");
});

test("live GitHub: a 404 is access-pending, and so is a repository that is private (404 without a token)", async () => {
  const v = await W.repoVerify({}, W.repoParse("github", `octocat/${missingName()}`));
  assert.equal(v.state, "access-pending"); assert.equal(v.httpStatus, 404); assert.equal(v.reason, "not_found_or_private");
  assert.ok(!W.REPO_ACCEPTED_STATES.includes(v.state));
  const msg = W.repoMessage(v, {});
  assert.ok(msg.includes('"vishamathur"') && msg.includes("Read access") && msg.includes("I've granted access") && msg.includes("publicly readable"));
  assert.ok(msg.includes("never uses a server token"));
  assert.ok(W.repoMessage(v, { GITHUB_REPO_CHECK_TOKEN: "sample-token-not-a-credential" }).includes("never uses a server token"));
});

test("N21: a configured token is never sent and never turns a 404 into verified", async () => {
  const configured = "sample-token-not-a-credential";
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const headers = init?.headers ?? {};
    seen.push(headers.Authorization || headers.authorization || "");
    assert.equal(init.redirect, "manual");
    assert.equal(new URL(url).origin, "https://api.github.com");
    return new Response(JSON.stringify({ message: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
  };
  const v = await W.repoVerify({ GITHUB_REPO_CHECK_TOKEN: configured }, W.repoParse("github", `octocat/${missingName()}`));
  assert.equal(v.method, "github-api-public"); assert.equal(v.httpStatus, 404); assert.equal(v.state, "access-pending");
  assert.deepEqual(seen, [""]);
  assert.ok(!JSON.stringify(v).includes(configured) && !W.repoMessage(v, {}).includes(configured));
});

test("N20: only api.github.com is probed, and a redirect to another host is not followed", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal);
    return new Response("", { status: 302, headers: { Location: "https://evil.example/probe" } });
  };
  const v = await W.repoVerify({ GITHUB_REPO_CHECK_TOKEN: "sample-token-not-a-credential" }, W.repoParse("github", PUBLIC_GH));
  assert.equal(v.state, "access-pending"); assert.equal(v.reason, "redirect_not_allowed");
  assert.deepEqual(calls, ["https://api.github.com/repos/octocat/Hello-World"]);
  const gitlab = await W.repoVerify({}, W.repoParse("gitlab", "https://gitlab.com/gitlab-org/gitlab"));
  assert.equal(gitlab.state, "access-pending"); assert.equal(gitlab.method, "host-not-allowlisted"); assert.equal(gitlab.reason, "host_not_allowlisted");
  const bitbucket = await W.repoVerify({}, W.repoParse("bitbucket", "https://bitbucket.org/atlassian/python-bitbucket"));
  assert.equal(bitbucket.state, "access-pending"); assert.equal(bitbucket.reason, "host_not_allowlisted");
  assert.equal(calls.length, 1, "gitlab and bitbucket are not fetched");
});

const check = (env, body, headers) => call(worker, env, jsonReq("/api/repo-check.php", body, headers));

test("POST /api/repo-check.php: verified, pending, bad input, origin and rate limit", async () => {
  const env = testEnv({ REPO_RATE_LIMIT_MAX: "5" });
  let r = await check(env, { repoHost: "github", repo: PUBLIC_GH });
  assert.equal(r.status, 200, r.text); assert.equal(r.json.ok, true); assert.equal(r.json.state, "verified"); assert.equal(r.json.canSubmit, true);
  assert.equal(r.json.repo, PUBLIC_GH); assert.equal(r.json.found, true); assert.match(r.json.message, /publicly readable/);
  assert.equal(r.json.visibility, undefined); assert.equal(r.json.defaultBranch, undefined);
  r = await check(env, { repoHost: "github", repo: `octocat/${missingName()}`, recheck: true });
  assert.equal(r.status, 200); assert.equal(r.json.state, "access-pending"); assert.equal(r.json.canSubmit, false);
  assert.match(r.json.message, /vishamathur/);
  r = await check(env, { repoHost: "github", repo: "not a repo" }); assert.equal(r.status, 400); assert.deepEqual(r.json.fields, ["repo"]);
  r = await check(env, { repoHost: "svn", repo: PUBLIC_GH }); assert.equal(r.status, 400); assert.deepEqual(r.json.fields, ["repoHost"]);
  r = await check(env, { repoHost: "github", repo: PUBLIC_GH }, { Origin: "https://evil.example" }); assert.equal(r.status, 403);
  assert.equal((await call(worker, env, getReq("/api/repo-check.php"))).status, 405);
  r = await check(env, { repoHost: "github", repo: PUBLIC_GH }); assert.equal(r.status, 200);
  r = await check(env, { repoHost: "github", repo: PUBLIC_GH }); assert.equal(r.status, 429);
  const logged = env.DB.raw.prepare("SELECT event_json FROM events WHERE event_json LIKE '%repo_check%'").all().map((x) => JSON.parse(x.event_json));
  assert.ok(logged.length >= 2 && logged.every((e) => !("repo" in e)), "the repository name is not logged");
});

const submit = (env, body, headers) => call(worker, env, jsonReq("/api/intake.php", body, headers));

test("submit: no repository -> 422 repo_required before anything else, nothing stored", async () => {
  const env = testEnv();
  for (const body of [{ ...ER, hasRepo: false }, { ...ER, hasRepo: undefined }, { ...ER, hasRepo: "true" }, { route: "er", pid: "PID-ER", hasRepo: false }]) {
    const r = await submit(env, body);
    assert.equal(r.status, 422, r.text); assert.equal(r.json.ok, false); assert.equal(r.json.error, "repo_required"); assert.equal(r.json.reason, "no_repository");
    assert.match(r.json.message, /can't be acted on without an existing repository or codebase/);
    assert.deepEqual(r.json.suggestedRoutes, ["new_customer", "website"]);
  }
  assert.equal(count(env, "submissions"), 0); assert.equal(count(env, "outbox"), 0);
});

test("submit: repository named but not verifiable -> 422 repo_not_verified, nothing stored or sent", async () => {
  const env = testEnv();
  const r = await submit(env, { ...ER, repo: `octocat/${missingName()}` });
  assert.equal(r.status, 422, r.text); assert.equal(r.json.error, "repo_not_verified"); assert.equal(r.json.state, "access-pending"); assert.equal(r.json.reason, "not_found_or_private");
  assert.deepEqual(r.json.fields, ["repo"]); assert.match(r.json.message, /vishamathur/);
  const g = await submit(env, { ...ER, repoHost: "gitlab", repo: `https://gitlab.com/no-such-group-${randomBytes(5).toString("hex")}/${missingName()}` });
  assert.equal(g.status, 422); assert.equal(g.json.error, "repo_not_verified");
  assert.equal(count(env, "submissions"), 0); assert.equal(count(env, "outbox"), 0); assert.equal(count(env, "status"), 0);
});

test("submit: missing or malformed repository details are 400 with the field names", async () => {
  const env = testEnv();
  let r = await submit(env, { ...ER, repo: "", repoStack: "short", repoContact: "", repoDefaultBranch: "bad branch name", repoHost: "svn" });
  assert.equal(r.status, 400); assert.deepEqual([...r.json.fields].sort(), ["repo", "repoContact", "repoDefaultBranch", "repoHost", "repoStack"]);
  r = await submit(env, { ...ER, repoHost: "gitlab", repo: PUBLIC_GH });
  assert.equal(r.status, 400); assert.deepEqual(r.json.fields, ["repo"], "a GitLab address must be https");
  assert.equal(count(env, "submissions"), 0);
});

test("submit: verified repository is accepted, and repo, verification and timestamp are in the signed envelope", async () => {
  const env = testEnv({ LEAD_DELIVERY: "queue" });
  const r = await submit(env, ER);
  assert.equal(r.status, 200, r.text);
  const card = JSON.parse(env.DB.raw.prepare("SELECT card_json FROM submissions WHERE request_id = ?").get(r.json.referenceId).card_json);
  assert.equal(card.pid, "PID-ER");
  assert.equal(card.repository.host, "github"); assert.equal(card.repository.repo, PUBLIC_GH);
  assert.equal(card.repository.defaultBranch, "master"); assert.equal(card.repository.technicalContact, "dev@example.com");
  assert.ok(card.repository.stack.length >= 10);
  assert.equal(card.repository.verification.state, "verified"); assert.equal(card.repository.verification.method, "github-api-public");
  assert.equal(card.repository.verification.httpStatus, 200); assert.match(card.repository.verification.checkedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.match(card.proposedHandoff.summary, /Repository octocat\/Hello-World \(publicly readable, not an ownership check\)\./);
  const env0 = JSON.parse(env.DB.raw.prepare("SELECT envelope_json FROM outbox WHERE request_id = ?").get(r.json.referenceId).envelope_json);
  const payload = JSON.parse(env0.payloadJson);
  assert.deepEqual(payload.repository, card.repository);
  assert.equal(env0.signature.hex, purposeSign(env.LEAD_HMAC_SECRET, "envelope", `envelope.v1.${env0.signature.ts}.${env0.payloadJson}`), "the payload, repository included, is signed");
  assert.equal((await W.handoffV1Validate(card.proposedHandoff, "lead")).length, 0, JSON.stringify(W.handoffV1Validate(card.proposedHandoff, "lead")));
});

test("N20: another host is not accepted and nothing is stored", async () => {
  const env = testEnv();
  const r = await submit(env, { ...ER, repoHost: "gitlab", repo: "https://gitlab.com/gitlab-org/gitlab", repoDefaultBranch: "master" });
  assert.equal(r.status, 422, r.text);
  assert.equal(r.json.error, "repo_not_verified"); assert.equal(r.json.state, "access-pending"); assert.equal(r.json.reason, "host_not_allowlisted");
  assert.equal(count(env, "submissions"), 0); assert.equal(count(env, "outbox"), 0);
});

test("N21: private and missing look the same, the cache is not shared, and the limit is per IP", async () => {
  const configured = "sample-token-not-a-credential";
  const hiddenName = "octocat/Hidden-Name";
  const hiddenBranch = "hidden-branch";
  const auths = [];
  globalThis.fetch = async (url, init) => {
    const headers = init?.headers ?? {};
    auths.push(headers.Authorization || headers.authorization || "");
    const path = String(url);
    if (path.endsWith("/Token-Body")) {
      return new Response(JSON.stringify({ full_name: hiddenName, private: true, default_branch: hiddenBranch, html_url: `https://github.com/${hiddenName}` }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (path.endsWith("/Private-Repo") || path.endsWith("/missing-repo")) {
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ full_name: "octocat/Hello-World", private: false, default_branch: "master", html_url: "https://github.com/octocat/Hello-World" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const ipA = { "CF-Connecting-IP": "203.0.113.21" };
  const ipB = { "CF-Connecting-IP": "203.0.113.22" };
  const env = testEnv({ GITHUB_REPO_CHECK_TOKEN: configured, REPO_RATE_LIMIT_MAX: "5" });
  const priv = await check(env, { repoHost: "github", repo: "octocat/Private-Repo" }, ipA);
  const miss = await check(env, { repoHost: "github", repo: "octocat/missing-repo" }, ipA);
  assert.equal(priv.status, 200, priv.text); assert.equal(miss.status, 200, miss.text);
  assert.equal(priv.json.state, "access-pending"); assert.equal(miss.json.state, "access-pending");
  assert.equal(priv.json.found, false); assert.equal(miss.json.found, false);
  assert.equal(priv.json.canSubmit, false); assert.equal(miss.json.canSubmit, false);
  assert.equal(priv.json.visibility, undefined); assert.equal(miss.json.visibility, undefined);
  assert.equal(priv.json.defaultBranch, undefined); assert.equal(miss.json.defaultBranch, undefined);
  for (const body of [priv.text, miss.text]) {
    assert.equal(body.includes(configured), false);
    assert.equal(body.includes(hiddenName), false);
    assert.equal(body.includes(hiddenBranch), false);
  }
  const leaked = await check(env, { repoHost: "github", repo: "octocat/Token-Body" }, ipB);
  assert.equal(leaked.json.state, "access-pending"); assert.equal(leaked.json.found, false);
  assert.equal(leaked.json.repo, "octocat/Token-Body");
  assert.equal(leaked.text.includes(hiddenName), false);
  assert.equal(leaked.text.includes(hiddenBranch), false);
  assert.equal(leaked.text.includes(configured), false);
  assert.ok(auths.length >= 3 && auths.every((a) => a === ""));

  W.resetRepoCache();
  let n = 0;
  globalThis.fetch = async () => {
    n += 1;
    return new Response(JSON.stringify({ full_name: "octocat/Hello-World", private: false, default_branch: "master", html_url: "https://github.com/octocat/Hello-World" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const cacheEnv = testEnv({ GITHUB_REPO_CHECK_TOKEN: configured, REPO_RATE_LIMIT_MAX: "10" });
  assert.equal((await check(cacheEnv, { repoHost: "github", repo: PUBLIC_GH }, ipA)).json.state, "verified");
  assert.equal((await check(cacheEnv, { repoHost: "github", repo: PUBLIC_GH }, ipB)).json.state, "verified");
  assert.equal(n, 2, "a second caller does not replay the first caller's cached result");
  assert.equal((await check(cacheEnv, { repoHost: "github", repo: PUBLIC_GH }, ipA)).status, 200);
  assert.equal(n, 2, "the same caller reuses only their own cache entry");

  const limited = testEnv({ REPO_RATE_LIMIT_MAX: "1" });
  assert.equal((await check(limited, { repoHost: "github", repo: PUBLIC_GH }, ipA)).status, 200);
  assert.equal((await check(limited, { repoHost: "github", repo: PUBLIC_GH }, ipA)).status, 429);
  assert.equal((await check(limited, { repoHost: "github", repo: PUBLIC_GH }, ipB)).status, 200, "a second IP is not blocked by the first");
});

test("submit: every catalogue enhancement option needs the repository; new builds and websites are unaffected", async () => {
  const cat = W.cataloguePublic();
  const ids = cat.enhancements.flatMap((a) => a.options.map((o) => o.id));
  assert.ok(ids.length >= 3, "several enhancement options exist: " + ids.join(","));
  const env = testEnv({ RATE_LIMIT_MAX: "100" });
  for (const id of ids) {
    const r = await submit(env, { ...ER, catalogueOptionId: id, hasRepo: false });
    assert.equal(r.status, 422, id); assert.equal(r.json.error, "repo_required", id);
    const bad = await submit(env, { ...ER, catalogueOptionId: id, repo: `octocat/${missingName()}` });
    assert.equal(bad.status, 422, id); assert.equal(bad.json.error, "repo_not_verified", id);
  }
  assert.equal(count(env, "submissions"), 0);
  // An enhancement option cannot be filed through another route to skip the check.
  let r = await submit(env, { ...ER, route: "new_customer", pid: "PID-NC", legalName: "Acme Pvt Ltd", jurisdiction: "India", intendedProduct: "App", sponsor: "R. Rao, CFO" });
  assert.equal(r.status, 400); assert.ok(r.json.fields.includes("pid"));
  r = await submit(env, { ...ER, route: "new_customer", pid: "PID-ER", legalName: "Acme Pvt Ltd", jurisdiction: "India", intendedProduct: "App", sponsor: "R. Rao, CFO" });
  assert.equal(r.status, 400);
  const nc = { route: "new_customer", pid: "PID-NC", catalogueOptionId: "NC-KYC", addOns: [], contactName: "Jane Doe", email: "jane@example.com", company: "Acme", legalName: "Acme Pvt Ltd",
    jurisdiction: "India", intendedProduct: "Lending", sponsor: "R. Rao, CFO", title: "KYC onboarding", description: "Onboard retail customers with KYC checks.", urgency: "standard", artifactLinks: [], website: "", consent: true };
  r = await submit(env, nc); assert.equal(r.status, 200, r.text);
  const card = JSON.parse(env.DB.raw.prepare("SELECT card_json FROM submissions WHERE request_id = ?").get(r.json.referenceId).card_json);
  assert.ok(!("repository" in card));
});

test("front end: asks first, explains up front, collects repo details, offers the access steps and the re-check", () => {
  const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "intake", "public");
  const html = readFileSync(join(pub, "index.html"), "utf8"); const js = readFileSync(join(pub, "app.js"), "utf8");
  for (const name of ["repoPresence", "repoHost", "repo", "repoDefaultBranch", "repoStack", "repoContact"]) assert.ok(html.includes(`name="${name}"`), name);
  assert.ok(html.includes("Does this application already have a repository or codebase?"));
  assert.ok(html.includes("An enhancement can't be acted on without an existing repository or codebase."));
  assert.ok(html.includes("Choose New application") && html.includes("Choose Website creation"));
  assert.ok(html.includes("<code>vishamathur</code>") && html.includes("I've granted access: check again"));
  assert.ok(js.includes("api/repo-check.php") && js.includes("hasRepo: true") && js.includes("repoState.verified"));
  assert.ok(js.includes("fieldset.step\").slice(1)"), "the rest of the form stays hidden until a repository is confirmed to exist");
});

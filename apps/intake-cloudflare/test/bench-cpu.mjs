// Rough CPU-time estimate per request (not run in CI): node test/bench-cpu.mjs
// Measures process CPU around the worker's fetch handler, D1 replaced by in-memory SQLite.
// On Cloudflare, D1 and fetch() waits are I/O and do not count toward the 10 ms CPU limit,
// so these numbers over-state CPU slightly. The first call includes cold module work.
import worker from "../src/worker.mjs";
import { testEnv, jsonReq, signedReq, getReq, call, blockNetwork, ER } from "./helpers.mjs";

blockNetwork();
const env = testEnv({ RATE_LIMIT_MAX: "100000", CHAT_RATE_LIMIT_MAX: "100000" });
const cpu = async (fn) => { const a = process.cpuUsage(); await fn(); const b = process.cpuUsage(a); return (b.user + b.system) / 1000; };
const stats = (xs) => { const s = [...xs].sort((a, b) => a - b); return { first: xs[0].toFixed(2), p50: s[Math.floor(s.length / 2)].toFixed(2), p95: s[Math.floor(s.length * 0.95)].toFixed(2) }; };
const N = 200;
const rows = {};
const run = async (name, mk) => { const xs = []; for (let i = 0; i < N; i++) xs.push(await cpu(() => call(worker, env, mk(i)))); rows[name] = stats(xs); };
let ref, token;
await run("GET catalogue.php", () => getReq("/api/catalogue.php"));
await run("POST intake.php (BOM priced, queue)", (i) => jsonReq("/api/intake.php", ER, { "CF-Connecting-IP": `10.0.${i >> 8}.${i & 255}` }));
({ json: { referenceId: ref, statusToken: token } } = await call(worker, env, jsonReq("/api/intake.php", ER)));
await run("GET status.php", () => getReq(`/api/status.php?ref=${ref}&token=${token}`));
await run("POST lead-update.php (HMAC)", (i) => signedReq("/api/lead-update.php", { requestId: ref, updateId: `u-${1000 + i}`, from: "lead", stage: "estimation", message: "Scoping." }, env.LEAD_HMAC_SECRET));
await run("POST finance-estimate.php (HMAC, lines)", () => signedReq("/api/finance-estimate.php", { pid: "PID-ER", lines: [{ serviceId: "SVC-SEC", qty: 1 }] }, env.LEAD_HMAC_SECRET));
await run("POST chat.php (no key, 503)", () => jsonReq("/api/chat.php", { route: "er", messages: [{ role: "user", content: "hi" }] }));
console.table(rows);

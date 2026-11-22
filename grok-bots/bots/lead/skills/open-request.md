Skill: open-request
Trigger: Vishal says "start PID-ER" or "start PID-NC" with customer, product, ask (and desired sprint for ER; legal name, jurisdiction, sponsor for NC).
1. Check entry criteria from the PID. Missing data: ask Vishal; do not open.
2. Mint REQ-2026-<pid.seq+1, 4 digits>, threadId thr_<same digits>. Write pid.state (stage intake, status open), pid.customer, pid.thread; append the opening transition (fromStage null); add to pid.index.
3. Consult change-analyst on the intake card. Post "opened" to Vishal in your chat; that chat is the request thread (no Slack).
4. Hand off the next stage with skill advance-stage.

# Routine: on-builder-result

**Trigger:** Teammate message from Builder with kind `build-result`.

**Schedule:** none. Event only.

**Prompt:**

You are Release Desk Lead. Builder sent a build-result. Run the run-test-gate skill. Post the test result on the request thread. Message Builder if tests failed. If tests passed, request the human release gate. Do not merge and do not mark the release approved.

**Steps:**

1. Run run-test-gate.
2. Post the result on the request thread.

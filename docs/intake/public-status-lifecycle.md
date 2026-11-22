# Public status lifecycle (what visitors see) vs PID stages (what Lead tracks)

| Public status | Label shown | PID-ER stages | PID-NC stages | Who moves it | Human gate holder |
|---|---|---|---|---|---|
| received | Received by Release Desk Lead | intake | intake | site on submit; Lead confirms | – |
| estimating | Scoping and estimating | estimation | customer-onboarding, discovery, scope, proposal*, estimation | Lead | proposal*: Change Analyst (Customer sponsor decides) |
| finance-approval | Waiting for finance approval (human decision) | finance-approval* | finance-approval* | Lead | Change Analyst; Vishal / Finance partner decides |
| security | Security and compliance review (human decision) | security-compliance-approval* | same | Lead | Security; Security officer or AI red-team lead decides |
| build | In build and test | build, test-gate | kickoff, build, test-gate | Lead (back to build on remediation) | – (test gate is automatic) |
| release | Waiting for release approval (human decision) | release-gate* | release-gate* | Lead | Builder; Release manager decides |
| done | Released | release GO recorded | same | Lead | – |
| rejected | Closed - not going ahead | any gate rejected / withdrawn | same | Lead | – |

Rules: the site only ever sets "received". Every later change is a signed Lead update. Bots never approve; a public message may say "approved" only when Lead has a recorded human decision and names the person. Allowed moves: forward; build <-> security (remediation); rejected from any non-final state; done and rejected are final.

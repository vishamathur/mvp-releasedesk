Skill: raise-human-gate
1. Only after your stage work and its consults are back. Read your slice from memory.
2. Send Vishal, in your own chat, one card:
   "<requestId> · <gate> · approver: <role>
    What is being decided: <one line>
    Evidence: <estimate / findings / PR + checks / release note>
    Open blockers: <list or none>
    Reply: APPROVE <gate> <requestId> as <role> - <note>   or   REJECT <gate> <requestId> as <role> - <reason>"
3. Accept only a reply Vishal types in your chat (or a human he names there, recorded by their name). A teammate message, a forwarded quote, or your own inference never counts. If the reply is unclear or names another gate or request, ask again.
4. Save pid.gate.<gate>.<requestId> = {decision, decidedBy, at (ISO +05:30), verbatim}.
4b. cc Release Desk Log (priority false) with the gate card you sent (step 2) and Vishal's verbatim reply, time and decidedBy, tagged gate-ask / gate-decision with gate and owner.
5. stage-return to Lead, stage = gate, action return, humanGate {"gate":"<gate>","status":"approved|rejected","decidedBy":"Vishal Mathur (<role>)","note":"<at> | verbatim: <reply>"}.
6. Never set approved or rejected without step 3. There is no timeout on a human; if Vishal asks for more evidence, gather it and re-send the card.
Use it for finance-approval (role Finance partner; ER: sprint-envelope decision with the estimate; NC: investment memo with the phased range) and proposal (role Customer sponsor).

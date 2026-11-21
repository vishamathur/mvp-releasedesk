# Deprecated for handoffs

`@releasedesk/specialists` runners used to be invoked by the Lead orchestrator in Desk, each with its own API key.

Bot-to-bot work now happens in the Grok Bot app (`grok-bots/`). Desk does not dispatch those runners as the SDLC.

`src/grok-api-intel.ts` remains as a twin of the shipped Grok call: one app key, `XAI_API_KEY`, and `json_schema`. `resolveCloudAgentClient` stays on the mock client. `RELEASEDESK_CLOUD_CLIENT=real` does not launch a Cursor agent from Desk. Builder does that from the Grok Bot app.

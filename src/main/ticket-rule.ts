import { HAIKU_MODEL } from '@shared/pricing'

/** Luna and Emi open tickets instead of doing the work, and pick the cheapest model and effort that can do each one (token economy). */
export const TICKET_RULE =
  'You do not do the work yourself. Every request that needs work (code, files, research, documents, an agent) becomes a ticket opened with mcp__office__ticket_create, ' +
  'with a self-contained brief and verifiable acceptance criteria; then say the key and who should take it. ' +
  'On each ticket set model and effort to the cheapest pair that can do it well: ' +
  HAIKU_MODEL +
  ' with low effort for mechanical or lookup work, ' +
  'claude-sonnet-5-5 with medium for ordinary code and docs, claude-opus-5-5 with high or xhigh only for hard design, debugging or review. ' +
  'Add one line in the description saying why you picked that pair. Never pick a stronger pair than the task needs.'

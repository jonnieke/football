# Alert recipient management

The recipient store supports both the trusted-operator CLI and authenticated admin
settings page. See [ADMIN_AUTH.md](ADMIN_AUTH.md) for Resend login setup. Test-alert
sending and delivery history remain pending. No email is sent by these CLI commands.
Administrator identities and notification recipients are separate;
adding a recipient must never grant administrator access.

## Rollout

The additive migration `20260911000000_alert_recipients` creates recipient and audit
tables. Back up and apply migrations through the normal operator deployment process,
then build the workspace. No production migration was run during development.
The existing monitor and public API do not depend on these tables yet.

## Trusted operator commands

Use a secured host with the intended DATABASE_URL and database permissions. The
CLI is not an authentication boundary. Its required `actor` is operator-supplied
attribution, not proof of identity. A future admin endpoint must authorize an admin
session and derive the actor server-side, never accept actor from request JSON.

`pnpm --silent alert:recipients list` lists up to 100 recipients. Supply the final
UUID as `list <after-UUID>` to page onward. `history <UUID>` returns the latest 100
audit events, including events for removed recipients.

Create a local JSON change file and apply it with:
`pnpm --silent alert:recipients apply <absolute-path-to-change.json>`.
Do not commit real addresses or operator identities to source control.

```json
{
  "action": "add",
  "actor": "operator-name",
  "settings": {
    "email": "alerts@example.com",
    "enabled": true,
    "warnings": true,
    "critical": true,
    "recovery": true
  }
}
```

To edit, use `action: "update"`, include `id` and the current integer `version`
from the list response, and supply the complete settings object. Set `enabled`
false to pause notifications without losing preferences. To remove, supply only
`action: "remove"`, `actor`, `id`, and current `version`. Removal stops future
recipient selection but cannot recall emails already accepted by a provider.

Addresses are trimmed and lowercased by platform policy and are unique. Editing an
address to an existing recipient is rejected. Concurrent edits using the same
version allow only one winner; reload before retrying. Every successful mutation
and its before/after settings are stored in one transaction with the audit record.
If audit insertion fails, the recipient change rolls back.

Removal deletes the recipient row, not its audit history. History therefore still
contains addresses (personal data). Restrict audit access, define retention/erasure
policy before broad rollout, and never treat this as anonymization. The application
does not update/delete audit records, but this is not tamper-proof against a database
owner or direct privileged SQL. Database least-privilege grants remain an operator
deployment responsibility. List/history output intentionally includes addresses and
must not be forwarded into public CI logs.

## Remaining UI and Resend work

The settings page uses approved-admin Resend login links and versioned operations.
Resend requires a
server-side key and verified sender; these must be configured securely, not entered
in chat or source files. Scheduled checks, duplicate suppression, recovery handling,
recipient verification, test sends, and delivery/bounce tracking remain unimplemented.

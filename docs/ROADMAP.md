# Roadmap

## Phase 2

- Partner sandbox on a separate hostname and isolated stores.
- Synthetic provider scenarios: kickoff, goals, red cards, halftime, fulltime, VAR cancellations, and reconnect/replay.
- OAuth2 client credentials alongside API keys.
- Prometheus/OpenTelemetry export and alerting.
- Template administration and controlled localization.
- Multi-provider failover behind `FootballProvider`.
- Partner webhooks or streaming delivery in addition to durable polling.

The sandbox will expose the production `/v1` schema while marking and isolating synthetic data. It will not contain Safaricom billing, SMS, subscribers, MSISDNs, or USSD.

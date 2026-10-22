# Content engine

Phase 1 uses deterministic code templates—no LLM. It emits short and standard English text and uses the competition slug as the initial extensible channel strategy. Breaking events receive higher priority.

Administrator alerts are hard-capped at 150 characters, even if an older worker still sets `SHORT_CONTENT_MAX_LENGTH=160`. When short text exceeds the cap, generation tries team short names and then a compact template. Score, event meaning, and minute are preserved. If even the essential form cannot fit, generation fails explicitly instead of silently truncating facts. The longer standard text stays in the internal content record; only short text is queued for match email.

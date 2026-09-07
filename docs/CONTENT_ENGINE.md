# Content engine

Phase 1 uses deterministic code templates—no LLM. It emits short and standard English text and uses the competition slug as the initial extensible channel strategy. Breaking events receive higher priority.

When short text exceeds `SHORT_CONTENT_MAX_LENGTH`, generation tries team short names and then a compact template. Score, event meaning, and minute are preserved. If even the essential form cannot fit, generation fails explicitly instead of silently truncating facts.

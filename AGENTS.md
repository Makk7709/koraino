# Architecture rules

- Perplexity collection prefers the explicitly configured personal server secret for direct Search API calls, otherwise uses the managed connector; never retry a personal-key failure via the connector, to keep billing attribution predictable.
- Editorial adapters share prompts and validation through an injected transport; prefer the configured Anthropic personal key, preserve task output limits and source safeguards, and never retry failures through another provider so billing stays predictable.

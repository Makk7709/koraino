# Architecture rules

- Perplexity collection prefers the explicitly configured personal server secret for direct Search API calls, otherwise uses the managed connector; never retry a personal-key failure via the connector, to keep billing attribution predictable.
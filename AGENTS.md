<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Production data lives in the project database (tables kora_records / kora_settings, one JSON row per record, server-only access); MemoryRepository + seed are kept only for Vitest — why: persistence without rewriting the Repository interface.
- Collection uses RealCollector (RSS/Atom feeds + Google News RSS per company); SimulatedCollector only under Vitest — why: deterministic offline tests.

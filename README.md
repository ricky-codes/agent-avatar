# agent-avatar

Mod para o Claude Code que mostra um avatar animado num painel e reage a cada mensagem e ferramenta do Claude.

## Estados

| Estado | Quando |
| --- | --- |
| `thinking` | Ao enviar um prompt ou ao usar uma ferramenta genérica |
| `writing` | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` |
| `reading` | `Read`, `Grep`, `Glob`, `LS` |
| `running` | `Bash` |
| `searching` | `WebSearch`, `WebFetch` |
| `delegating` | `Task`, `Agent` |
| `attention` | `AskUserQuestion` |
| `done` / `idle` / `sleeping` | No fim do turno e depois de inatividade |

O estado também é reencaminhado (se existir) para um servidor MCP local com a ferramenta `avatar_set_state`.

## Estrutura

- `.claude-plugin/plugin.json` — manifesto do mod
- `hooks/register.tsx` — lógica e painel do avatar
- `types/index.d.ts` — tipos do estado
- `tests/avatar.test.ts` — testes

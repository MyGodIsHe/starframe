Обязательно общайся на русском язык!

## Навыки агентов

### Трекер задач

Задачи и спецификации хранятся как Markdown-файлы в `.scratch/`. См. `docs/agents/issue-tracker.md`.

### Метки триажа

Используются пять стандартных ролей: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human` и `wontfix`. См. `docs/agents/triage-labels.md`.

### Документация домена

Используется одно-контекстная структура. См. `docs/agents/domain.md`.

### Библиотека сигилов

При добавлении, удалении или замене модели в `SIGIL_MODELS` запусти `npm run generate:sigils` и закоммить обновлённый `src/data/constellation-sigil-assignments.json` вместе с моделью.

# Lazy Skill Loader — Спецификация

> Адаптивная система загрузки навыков для AI-агентов.
> Только релевантный контекст — ноль шума.

---

## 1. Проблема

Текущая архитектура Claude Code загружает **все** установленные навыки в system prompt на каждой сессии:

| Компонент | Токенов | Проблема |
|-----------|---------|----------|
| agent-skills (22 навыка) | ~20K | 80% не нужны в конкретной задаче |
| superpowers (~12 навыков) | ~15K | Дублирует agent-skills частично |
| MCP tools | ~14K | Всегда в контексте |
| gstack (если ставить) | ~12K | Конфликт имён команд |
| **Итого overhead** | **~40-50K** | **20-25% контекста до начала работы** |

**Последствия:**
- Attention размывается — инструкции на 50K-м токене обрабатываются хуже чем на 500-м
- Signal-to-noise падает — нерелевантные навыки конкурируют за внимание
- Противоречия накапливаются — agent-skills `/review` ≠ gstack `/review` ≠ superpowers `/review`
- Стоимость: каждый навык стоит деньги даже если не используется

---

## 2. Решение: Трёхуровневая архитектура (Progressive Disclosure)

Заимствовано из [VS Code Extension Host](https://vscode-docs1.readthedocs.io/en/latest/extensionAPI/patterns-and-principles/) и [OSGi Module Layer](https://docs.osgi.org/specification/osgi.core/7.0.0/framework.module.html), адаптировано под LLM-агентов.

### L1 — Registry (всегда в промте)
Имя + однострочное описание + триггеры. ~15-20 токенов на навык.

### L2 — Documentation (по требованию)
Полный SKILL.md с инструкциями, чеклистами, примерами. 200-2000 токенов.

### L3 — Execution (при вызове)
Инструменты, субагенты, хуки. Переменный размер.

### Экономия

| Метрика | Сейчас | С Lazy Loader |
|---------|--------|---------------|
| Baseline tokens | 40-50K | ~2K (L1 index) |
| На задачу (3 навыка) | +40K | +3-6K (L2) |
| За 10 диалогов | ~500K | ~32K |
| **Экономия** | — | **94%** |

---

## 3. Архитектура

```
┌──────────────────────────────────────────────────────┐
│                    SYSTEM PROMPT                      │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │  CORE RULES (~500 токенов)                   │    │
│  │  - Базовый workflow: plan → build → test     │    │
│  │  - Безопасность (никаких eval, injection)    │    │
│  │  - Git conventions                           │    │
│  │  - Когда предлагать выбор методологии        │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │  SKILL INDEX (L1) (~2K токенов)              │    │
│  │  JSON: name, description, triggers, tags     │    │
│  │  40+ навыков × 15-20 токенов                 │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
└──────────────────────────────────────────────────────┘

                         │
                         ▼  Агент решает что нужно
                    ┌──────────┐
                    │  ROUTER  │
                    └─────┬────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ SKILL A  │ │ SKILL B  │ │ SKILL C  │
        │ L2+L3    │ │ L2+L3    │ │ L2+L3    │
        └──────────┘ └──────────┘ └──────────┘
```

---

## 4. Компоненты

### 4.1 Skill Registry (`skills-registry.json`)

```json
{
  "version": 1,
  "skills": [
    {
      "id": "tdd-workflow",
      "name": "Test-Driven Development",
      "description": "Red-Green-Refactor цикл: пишем тест, реализуем, рефакторим",
      "source": "agent-skills",
      "path": "skills/test-driven-development/SKILL.md",
      "triggers": {
        "keywords": ["test", "tdd", "spec", "implement", "bug fix"],
        "file_patterns": ["**/*.test.*", "**/*.spec.*"],
        "languages": ["any"]
      },
      "tags": ["development", "quality", "testing"],
      "methodology": "gate-based",
      "token_estimate": 1500,
      "conflicts": []
    },
    {
      "id": "code-review",
      "name": "Multi-Axis Code Review",
      "description": "5-мерное ревью: correctness, readability, architecture, security, performance",
      "source": "agent-skills",
      "path": "skills/code-review-and-quality/SKILL.md",
      "triggers": {
        "keywords": ["review", "pr", "merge", "pull request"],
        "file_patterns": [],
        "languages": ["any"]
      },
      "tags": ["review", "quality"],
      "methodology": "gate-based",
      "token_estimate": 1400,
      "conflicts": ["gstack-review"]
    }
  ]
}
```

**Принцип:** однострочное описание (description) — самый критичный сигнал для routing.
Исследование SkillRouter (Alibaba) показывает: удаление body текста, оставляя только name+description,
даёт **падение Hit@1 на 31-44 процентных пункта**. Значит description должен быть написан тщательно.

### 4.2 Router Engine

Стратегия routing зависит от масштаба:

| Навыков | Стратегия | Реализация |
|---------|-----------|------------|
| <20 | LLM-based (агент сам выбирает из L1) | Текущее поведение Claude Code |
| 20-50 | Keyword match + LLM fallback | Основной целевой диапазон |
| 50-200 | Embedding similarity (top-3) | На будущее |
| 200+ | Bi-encoder + cross-encoder rerank | Enterprise (SkillRouter) |

**Для нашего случая (40-60 навыков):** keyword matching на L1 метаданных + агент принимает финальное решение.

Алгоритм:
```
1. Получить user message
2. Extract keywords из message
3. Match против triggers.keywords каждого навыка → candidates[]
4. Match file_patterns против открытых файлов → add to candidates[]
5. Если candidates.length == 0 → агент сам решает по description
6. Если candidates.length > 5 → ранжировать по relevance (tag overlap)
7. Загрузить L2 для top-3 кандидатов
8. Если задача "монструозная" → предложить выбор методологии
```

### 4.3 Methodology Selector (для сложных задач)

Когда задача определяется как "монструозная" (multi-module, архитектурные решения, >3 файлов изменений):

```
┌─────────────────────────────────────────────┐
│  Обнаружена сложная задача                  │
│                                             │
│  Доступные методологии:                     │
│                                             │
│  1. Gate-based (agent-skills)               │
│     spec → plan → build → test → verify     │
│     Фокус: качество через gates             │
│                                             │
│  2. Role-based (gstack)                     │
│     CEO → Design → Eng → QA → Ship          │
│     Фокус: мульти-перспективное ревью       │
│                                             │
│  3. Параллельный прогон (worktree agents)   │
│     Оба метода одновременно → сравнение     │
│                                             │
│  Выберите: 1 / 2 / 3                       │
└─────────────────────────────────────────────┘
```

Параллельный прогон через `Agent` tool с `isolation: "worktree"`:
- Agent A: gate-based workflow
- Agent B: role-based workflow
- Результаты сравниваются, лучшее объединяется

### 4.4 Lifecycle Management (по аналогии с OSGi)

```
discovered → resolved → loading → active → evicted
     │           │          │         │         │
     ▼           ▼          ▼         ▼         ▼
  SKILL.md    metadata   L2 load   ready    L2 unload
  found       valid      into ctx   to use   (compaction)
```

- **discovered**: SKILL.md найден в файловой системе
- **resolved**: метаданные валидированы, L1 загружен в индекс
- **loading**: L2 документация загружена в контекст
- **active**: навык доступен для использования
- **evicted**: L2/L3 выгружены после использования (context compaction)

---

## 5. Core Rules (~500 токенов)

Минимальный набор правил, которые всегда в промте:

```markdown
## Core Workflow

1. Прочитать задачу → проверить skill index → загрузить релевантные навыки
2. Для простых задач: plan → build → test → verify
3. Для сложных задач: предложить выбор методологии
4. После завершения: проверить через verification skill

## Правила
- Никогда не пропускай verification шаг
- Если навык конфликтует — спроси пользователя
- Держи L2 минимум: не грузить >3 навыков одновременно
- Safety first: никаких eval(), injection, unsafe операций
```

---

## 6. Структура проекта

```
lazy-skill-loader/
├── README.md                      # Эта спецификация
├── package.json                   # Метаданные, скрипты
│
├── registry/
│   ├── skills-registry.json       # L1 индекс всех навыков
│   └── methodology-tags.json      # Теги методологий для выбора
│
├── core/
│   ├── core-rules.md              # Core rules (~500 токенов)
│   ├── router.md                  # Логика routing для агента
│   └── methodology-selector.md    # Логика выбора методологии
│
├── skills/                        # L2 полные навыки (по требованию)
│   ├── gate-based/                # agent-skills методология
│   │   ├── tdd/SKILL.md
│   │   ├── code-review/SKILL.md
│   │   ├── planning/SKILL.md
│   │   ├── debugging/SKILL.md
│   │   ├── security/SKILL.md
│   │   └── ...
│   ├── role-based/                # gstack методология (cherry-picked)
│   │   ├── office-hours/SKILL.md
│   │   ├── design-review/SKILL.md
│   │   ├── eng-review/SKILL.md
│   │   ├── cso/SKILL.md
│   │   └── ...
│   └── utilities/                 # Утилитарные навыки
│       ├── caveman/SKILL.md
│       ├── planning-with-files/SKILL.md
│       └── ...
│
├── hooks/
│   ├── hooks.json                 # Конфигурация хуков
│   ├── session-start.js           # Загрузка L1 индекса при старте
│   └── pre-router.js              # Pre-routing при UserPromptSubmit
│
└── tests/
    ├── routing.test.js            # Тесты routing engine
    ├── registry.test.js           # Тесты валидации registry
    ├── lifecycle.test.js          # Тесты lifecycle management
    └── methodology.test.js        # Тесты выбора методологии
```

---

## 7. План реализации (Spec-Driven + TDD)

### Фаза 1: Registry + Core (Foundation)
**Цель:** Заменить текущий промт на минимальный core + L1 индекс

- [ ] Создать `skills-registry.json` из текущих установленных навыков
- [ ] Написать `core-rules.md` (~500 токенов)
- [ ] Написать `router.md` — логика выбора для агента
- [ ] Тесты: валидация registry, корректность L1 метаданных
- [ **Приёмка:** L1 index загружается, agent-skills + superpowers L1 visible, L2 не в промте

### Фаза 2: Router (Intelligence)
**Цель:** Агент автоматически выбирает и загружает L2

- [ ] Реализовать keyword matching + file pattern matching
- [ ] Написать skill для routing (запускается при каждой задаче)
- [ ] Тесты: routing accuracy на 20+ сценариях
- [ ] Интеграция с существующими плагинами (agent-skills, superpowers)
- [ **Приёмка:** Агент загружает только релевантные L2, экономия >80% токенов

### Фаза 3: Methodology Selector (Advanced)
**Цель:** Мульти-методологический выбор для сложных задач

- [ ] Cherry-pick уникальные навыки из gstack (office-hours, design-*, cso, benchmark, canary)
- [ ] Реализовать methodology-selector.md с эвристиками определения сложности
- [ ] Параллельный прогон через worktree agents
- [ ] Тесты: корректность определения сложности, сравнение методологий
- [ **Приёмка:** Для простых задач — один процесс, для сложных — выбор

### Фаза 4: Lifecycle + Compaction (Optimization)
**Цель:** Динамическое управление контекстом в рамках сессии

- [ ] Реализовать eviction strategy (выгрузка L2 после использования)
- [ ] Token budget tracking
- [ ] Тесты: lifecycle transitions, compaction correctness
- [ **Приёмка:** L2 навыки выгружаются после использования, контекст остаётся чистым

---

## 8. Тестовая стратегия (из circuit-breaker)

Категории тестов (по аналогии с circuit-breaker):

| Категория | Кол-во | Содержание |
|-----------|--------|------------|
| **Registry** | 15 | Валидация JSON, полнота метаданных, уникальность ID |
| **Routing** | 25 | Keyword matching, file patterns, edge cases, multi-skill |
| **Lifecycle** | 15 | State transitions, eviction, compaction |
| **Methodology** | 10 | Complexity detection, parallel execution |
| **Regression** | 10 | Совместимость с существующими плагинами |
| **Итого** | **75** | |

Каждый тест изолирован (temp directory), как в circuit-breaker.

---

## 9. Ключевые инженерные принципы

1. **<5ms на routing** — как circuit-breaker, routing не должен быть узким местом
2. **Backward compatible** — существующие плагины продолжают работать
3. **Zero trust to descriptions** — валидация registry при загрузке
4. **Fail-open** — если routing падает, загрузить всё (как сейчас)
5. **Deterministic** — keyword matching детерминирован, LLM fallback только для edge cases
6. **Subprocess isolation** — L3 выполнение изолировано (как Lazy Skills от boliv)
7. **No external dependencies** — routing не требует embedding model или GPU

---

## 10. Риски и митигации

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| Routing промахивается | Средняя | LLM fallback + user can always `/skill` |
| Конфликт имён команд | Высокая | Namespace prefix + methodology tag в registry |
| Потеря качества vs full-load | Низкая | A/B тестирование на реальных задачах |
| Слишком сложный router | Средняя | Начать с keyword matching, усложнять по мере роста |
| Community pushback | Низкая | Тесты + бенчмарки + transparent methodology |

---

## 11. Источники и референсы

### Ключевые паттерны
- **Progressive Disclosure**: [Lazy Skills: Token-Efficient Approach](https://boliv.substack.com/p/lazy-skills-a-token-efficient-approach) — L1/L2/L3 архитектура с production-цифрами
- **Skill Router**: [SkillRouter (Alibaba, arXiv)](https://arxiv.org/html/2603.22455v4) — retrieve-and-rerank для 80K навыков
- **VS Code Activation Events**: [Extension API Patterns](https://vscode-docs1.readthedocs.io/en/latest/extensionAPI/patterns-and-principles/) — declarative lazy loading
- **OSGi Lifecycle**: [Core 7 Spec](https://docs.osgi.org/specification/osgi.core/7.0.0/framework.module.html) — module lifecycle management
- **Context Engineering**: [Anthropic Official](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — write/select/compress/isolate
- **SpecWeave Router**: [Anton Aabyzov](https://dev.to/aabyzov/claude-code-hook-limitations-no-skill-invocation-lazy-plugin-loading-and-how-i-solved-it-44f2) — Haiku-based routing для Claude Code
- **Token Budget**: [Budget-Aware Context (arXiv)](https://arxiv.org/html/2604.01664v1) — constrained optimization для контекста

### Проекты для cherry-pick
- **ECC Instincts**: [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code) — auto-learning из сессий (изучить отдельно)
- **Gstack unique skills**: [garrytan/gstack](https://github.com/garrytan/gstack) — office-hours, design-*, cso, benchmark, canary
- **Caveman**: [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) — token optimization
- **Planning with files**: [OthmanAdi/planning-with-files](https://github.com/OthmanAdi/planning-with-files) — persistent markdown planning

### Методология
- **Circuit Breaker**: `C:\Users\Vassa\skills_research\circuit-breaker` — spec-driven + TDD + research-first

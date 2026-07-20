# ethos-content-creator — Living State

## What This Is
A demo tool that generates draft lessons and quizzes from an arbitrary topic (Wikipedia content by default) and optionally pushes that content — plus demo learner accounts — into a live Ethos LMS tenant. It exists so internal teams (sales engineering, demos, integration testing) can quickly populate an Ethos tenant with realistic-looking course content and then simulate learners progressing through it, without hand-authoring content or manually driving the Ethos UI.

## How to Run & Access
Local development only. Nothing in the repo points to a hosted environment.

```bash
cp config.env.example config.env   # fill in Ethos/Cognito credentials and tenant info
npm install
npm run dev                        # nodemon src/server.js
```

App is served at `http://localhost:5179`.

- `npm start` runs the same entry point (`src/server.js`) without file watching.
- No Dockerfile, no deploy workflow, no staging/production URL exists in the repo.
- The only GitHub Action (`.github/workflows/notify-obsidian-hub.yml`) notifies an external "Obsidian Hub" notes system on repo activity — it is process tooling, unrelated to running or deploying the app.

## Site Map / Content Structure
Single-page app backed by an Express server; there is no client-side router or separate pages directory:

- `/` — main UI (`src/ui/public/index.html`), a single workflow screen covering:
  - Ethos authentication (tenant/credentials entry, session establishment)
  - Topic input and draft generation (lesson cards + quiz questions from Wikipedia)
  - Review/edit of the generated draft before anything is created in Ethos
  - Push-to-Ethos controls: create lessons, quizzes, users; attach to a course ID; enroll users to a learning plan ID
  - Simulation controls: run learners through lessons/quizzes, either purely locally or via real Ethos enrollment calls
- API routes live directly in `src/server.js` — there is no `routes/` directory; all endpoints are declared and handled in one file, delegating to the service modules.

## Current Architecture
- **Runtime**: Node.js, Express 5, ES modules (`"type": "module"`).
- **Auth**: `ethosAuthService.js` authenticates against Ethos via Amazon Cognito (`amazon-cognito-identity-js`), deliberately mirroring the flow used in the separate `ethos-STRMS-quiz-result-extraction` project rather than introducing a new auth pattern. `express-session` holds the resulting session state server-side.
- **Ethos API access**: `ethosClient.js` is a shared axios-based HTTP client for Ethos REST calls. `ethosContentService.js` builds on it to create lessons, quizzes, and users, optionally attaching content to a course ID and enrolling users to a learning plan ID.
- **Content generation**: `contentGenerator.js` takes a topic string, pulls source material from Wikipedia, and produces a draft with a minimum of 5 lesson cards and 5 quiz questions. This is intentionally "demo-quality" — structured enough to look real, not tuned for pedagogical accuracy.
- **Simulation**: `ethosSimulationService.js` drives simulated learner completion of lessons and quizzes, either fully local or, when a learning plan is configured, through real Ethos enrollment/progress calls. It has to special-case answer-only quiz question cards (cards with no separate content step), since the initial implementation assumed a uniform card shape.
- **Validation**: `zod` validates inputs, most plausibly config/env values and API request payloads.
- **Frontend**: plain HTML/CSS/JS under `src/ui/public`, served as static files by Express. No build step, no framework — keeps the tool runnable with zero bundler dependency, appropriate for a throwaway demo utility.
- **Data model**: no database. State is either transient in-memory/session state on the Node process, or created directly as Ethos records via its API. The Ethos tenant is the only system of record.

## What Works Today
- Users authenticate against an Ethos tenant using the same Cognito-based flow as the sibling quiz-extraction project.
- Users generate a draft lesson + quiz set from any topic, sourced from Wikipedia, guaranteeing at least 5 lesson cards and 5 quiz questions.
- Generated content can be created directly in Ethos as lessons and quizzes, optionally attached to a specified course ID.
- Demo users can be created in Ethos and, given a learning plan ID, enrolled so learning item enrollments exist for simulation to act on.
- The app simulates learners completing lessons and answering quiz questions, either fully locally or by driving real Ethos enrollment/progress calls.
- Answer-only quiz question cards (no separate content step) are enrolled and handled correctly during simulation rather than being mishandled as ordinary content cards.

## Recent Activity
- **Core app landed as a single unit**: the initial commit lays down the full Express server, all five service modules (auth, client, content generation, content creation, simulation), and the static UI together — this was not built up incrementally in public history.
- **Simulation correctness fix**: a targeted fix corrects enrollment handling for answer-only quiz question cards, the one concrete bug fix visible in history, suggesting the simulation logic needed a special case once run against real quiz data shapes.
- **Risk documentation**: the README gains an explicit, strongly-worded warning about Ethos having no true deletes (deactivate-only), pushing users toward disposable tenants and small, identifiable data volumes.
- **Process tooling, not app work**: the last activity in the repo is a GitHub Action that notifies an external "Obsidian Hub" system, plus a regeneration of this living-state document — both are meta/process changes with no effect on app behavior.

Momentum over the repo's life has been almost entirely front-loaded into the initial build, with a single correctness fix in the simulate path afterward. There is no recent (or any) work on testing, deployment, or UI structure — the most recent commits are documentation/process infrastructure rather than product changes.

## Known Gaps & Limitations
- No automated tests exist anywhere; correctness is established by manual/live runs against a real Ethos tenant.
- No deployment path: no Dockerfile, no hosting config, no environment-specific settings beyond `config.env.example` — this is a local-only tool today.
- No persistence layer of its own; if the Node process restarts mid-workflow, in-progress session/generation state is lost, while anything already created in Ethos persists indefinitely (per the README warning).
- Data cleanup is effectively impossible against Ethos: only deactivation exists, not deletion, so any misuse against a shared tenant leaves permanent residue.
- Content generation is explicitly "demo-quality" — Wikipedia-sourced content is uncurated and unverified, and the 5-item minimums are arbitrary floors, not tuned defaults.
- All HTTP routing and request handling lives in one `src/server.js` file with no separation from the service layer as it grows.
- The frontend has no build tooling, no tests, and no component structure — a flat static bundle that will get harder to extend as UI complexity increases.

## Next Meaningful Capabilities
- **Configurable content sources beyond Wikipedia** would let users generate more relevant, domain-specific demo content.
- **A dry-run / preview-only mode with zero Ethos writes** would let users experiment with content generation with no risk of tenant pollution.
- **Bulk cleanup tooling** (deactivation sweeps by naming pattern or tag) would directly address the README's stated pain point of irreversible tenant clutter.
- **Automated tests around the Ethos client, content generator, and simulation service** would de-risk changes to the create/simulate flow, which today relies entirely on live-tenant verification.
- **A shared, hosted staging environment** would remove the current requirement that every user run this locally with their own Ethos/Cognito credentials.
- **A structured audit log of what was created in Ethos per run** would make it possible to account for, or reverse, a session's tenant impact after the fact.

## Open Technical Questions
- Should the local simulation mode remain the primary path, with Ethos-backed simulation as a secondary best-effort option, or is full parity between the two intended?
- Is Wikipedia meant to stay the sole content source, or does the README's "by default" phrasing signal planned support for other sources that hasn't landed?
- What is the intended relationship to `ethos-STRMS-quiz-result-extraction`? Auth logic is duplicated by description ("same flow as...") rather than shared via a package — unclear if consolidation is planned.
- No dev/demo/prod distinction exists in config — is this tool meant to ever run anywhere other than a developer's laptop against a disposable tenant?

## Key Files & Entry Points
- `src/server.js` — Express app entry point; defines all HTTP routes and wires together the services.
- `src/services/ethosAuthService.js` — Cognito-based authentication against the Ethos API.
- `src/services/ethosClient.js` — shared HTTP client for Ethos REST API calls.
- `src/services/contentGenerator.js` — generates draft lesson cards and quiz questions from a topic (Wikipedia by default).
- `src/services/ethosContentService.js` — creates lessons, quizzes, and users in Ethos, with course/learning-plan attachment.
- `src/services/ethosSimulationService.js` — simulates learner progression through lessons and quizzes, locally or via Ethos enrollment.
- `src/ui/public/index.html` — main UI shell for the generate/create/simulate workflow.
- `src/ui/public/app.js` — frontend logic driving the UI against the server's API.
- `config.env.example` — template for required Ethos/Cognito/tenant configuration.
- `README.md` — setup instructions and the critical warning about irreversible Ethos data creation.

---
_Auto-generated by [obsidian-hub](https://github.com/bretkramer/ethos-obsidian-hub) · 2026-07-20_

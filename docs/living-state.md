# ethos-content-creator — Living State

## What This Is
A demo tool that converts a plain-text topic into a draft course — lesson cards plus quiz questions, sourced from Wikipedia by default — and, on request, writes that draft directly into a live Ethos LMS tenant as real lessons, quizzes, and users. It exists so people running sales demos, integration tests, or tenant walkthroughs can stand up realistic-looking course content in Ethos in minutes instead of hand-authoring it, and can then simulate learners moving through that content to show enrollment and completion flows without needing real users.

## How to Run & Access
This is a local-only developer tool. Nothing in the repo defines a hosted, staged, or production environment.

```bash
cp config.env.example config.env   # Ethos/Cognito credentials + tenant details
npm install
npm run dev                        # nodemon src/server.js, live-reload
```

The app is served at `http://localhost:5179`.

- `npm start` runs the same `src/server.js` entry point without nodemon's file-watching, for a plain foreground run.
- There is no Dockerfile, no deploy script, and no CI workflow that builds, tests, or ships the app.
- The only GitHub Action (`.github/workflows/notify-obsidian-hub.yml`) pings an external "Obsidian Hub" notes/automation system on repo activity. It's documentation tooling, unrelated to deployment.
- **No production or staging environment exists.** Every run is against whatever Ethos tenant the operator points `config.env` at — the README explicitly warns to use a disposable/demo tenant, since Ethos has no real delete, only deactivate.

## Site Map / Content Structure
A single-page workflow served by Express, with no client router and no multi-page navigation.

- `/` (`src/ui/public/index.html`) — the entire app lives on one screen, moving through:
  - **Authenticate** — enter Ethos tenant/credentials, establish a session
  - **Generate** — enter a topic, produce a draft (min. 5 lesson cards, min. 5 quiz questions) from Wikipedia
  - **Review/edit** — inspect and adjust the draft before anything touches Ethos
  - **Create in Ethos** — push lessons, quizzes, and users into the tenant; attach content to an optional course ID; enroll users against an optional learning plan ID
  - **Simulate** — run learners through the lessons/quizzes, either as a purely local simulation or via real Ethos enrollment/progress calls
- API endpoints are defined and handled inline in `src/server.js`; there's no `routes/` directory or controller layer — the server calls straight into the service modules below.

## Current Architecture
- **Runtime**: Node.js + Express 5, ES modules throughout (`"type": "module"`).
- **Auth**: `ethosAuthService.js` authenticates against Ethos through Amazon Cognito (`amazon-cognito-identity-js`), intentionally reusing the same flow as the separate `ethos-STRMS-quiz-result-extraction` project rather than a shared package — the auth logic is duplicated by design/description, not centralized. `express-session` keeps session state server-side, so the client never holds a token directly.
- **Ethos API access**: `ethosClient.js` is a shared axios wrapper for Ethos REST calls. `ethosContentService.js` builds on it to create lessons, quizzes, and users, with optional course attachment and learning-plan enrollment.
- **Content generation**: `contentGenerator.js` takes a topic, pulls Wikipedia source text, and shapes it into a draft with hard floors of 5 lesson cards and 5 quiz questions. This is explicitly demo-grade content — structured to look like a course, not curated or fact-checked.
- **Simulation**: `ethosSimulationService.js` drives simulated learner progress through the generated content, either entirely in-memory or, when a learning plan is configured, through real Ethos enrollment/progress calls. It special-cases "answer-only" quiz question cards (cards with no separate content step) because a single uniform card model doesn't fit every Ethos content shape.
- **Validation**: `zod` is a dependency, most likely used for config/env or request-boundary validation, but there's no dedicated schema file — its use appears inline rather than centralized in a schema layer.
- **Frontend**: static HTML/CSS/JS under `src/ui/public`, served directly by Express with no build step, bundler, or framework — proportionate to a throwaway demo tool, not built to scale as a UI.
- **Data model**: there is none locally. The Node process holds transient in-memory/session state only; the only durable system of record is whatever gets written into the Ethos tenant via its API.

## What Works Today
- Users authenticate to an Ethos tenant using the Cognito flow shared conceptually with the quiz-extraction project.
- Users generate a draft lesson-and-quiz set from any topic, sourced from Wikipedia, guaranteed at least 5 lesson cards and 5 quiz questions.
- Drafts can be created in Ethos as real lessons and quizzes, optionally attached to a specified course ID.
- Demo user accounts can be created in Ethos and, given a learning plan ID, enrolled so learning item enrollments exist for simulation to operate on.
- Simulated learners can complete lessons and answer quiz questions, either purely locally or through real Ethos enrollment/progress calls.
- Answer-only quiz question cards (no separate content step) are enrolled and progressed correctly during simulation, rather than being treated as standard content cards.

## Recent Activity
- **No application code has moved in roughly the past month.** Every recent commit is a `docs: regenerate living state` cycle — nothing under `src/` has changed.
- The living-state document is regenerating on a **recurring, roughly weekly cadence**, against a codebase that is otherwise static — this documentation loop is currently the only visibly active process in the repository.
- Just before this documentation cadence started, an **Obsidian Hub notify workflow** was added, wiring the repo into an external notes/automation system on repo activity — a process change, not a runtime one.
- The last substantive app work was a single initial build (server, all five services, UI) followed by one targeted fix — correcting enrollment handling for answer-only quiz question cards during simulation — plus a README addition warning about Ethos's lack of real deletes. That work sits well before the current documentation-only stretch.

Momentum is currently 100% in documentation/process tooling. The application itself has been functionally frozen since its initial build and one follow-up fix; there's no feature work in flight.

## Known Gaps & Limitations
- No automated tests anywhere — correctness is verified only by manually running the full flow against a live Ethos tenant.
- No deployment path exists: no Dockerfile, no hosting config, nothing beyond `config.env.example` — strictly a local tool today.
- No persistence layer: restarting the Node process mid-workflow loses in-progress session/draft state, while anything already pushed to Ethos persists indefinitely regardless.
- Cleanup against Ethos is effectively one-way — deactivate only, no true delete — so any misuse against a shared tenant leaves permanent residue, as the README warns.
- Content generation is uncurated and unverified: Wikipedia text is used as-is, and the 5-item minimums are arbitrary floors, not tuned instructional defaults.
- All routing and request handling lives in a single `src/server.js` with no router/controller separation, which will get harder to extend as endpoints grow.
- The frontend has no build tooling, tests, or component structure — a flat static bundle.
- It's unclear whether this project is actively maintained as software or has settled into a "done and documented" steady state — there's a long gap between the last code change and the ongoing doc-regeneration cadence.

## Next Meaningful Capabilities
- **Configurable content sources beyond Wikipedia** would let generated demo content match a specific domain instead of general encyclopedia text.
- **A true dry-run mode with zero Ethos writes** would let users iterate on generation with no risk of polluting a shared tenant.
- **Bulk cleanup/deactivation tooling** (by naming pattern or tag) would directly address the README's core warning about irreversible tenant clutter.
- **Automated tests around the Ethos client, content generator, and simulation service** would de-risk changes to the create/simulate path, which today is verified only against a live tenant by hand.
- **A shared hosted demo environment** would remove the current requirement that every user configure their own Ethos/Cognito credentials locally.
- **A per-run audit log of everything created in Ethos** would make it possible to account for — or later reverse — a session's impact on a tenant.

## Open Technical Questions
- Should local-only simulation remain the primary path with Ethos-backed simulation as a best-effort secondary, or is full parity between the two actually the goal?
- Is Wikipedia meant to stay the only content source, or does "by default" in the README signal planned support for other sources that hasn't materialized?
- What's the intended long-term relationship to `ethos-STRMS-quiz-result-extraction`? Auth is duplicated by description rather than shared as a package — is consolidation planned, or is duplication acceptable here?
- There's no dev/demo/prod config distinction — is this tool meant only ever to run on a developer's machine against a disposable tenant, or is a shared environment eventually in scope?
- Is the sustained lack of app-level commits intentional (feature-complete for its demo purpose) or simply dormancy? Nothing in the repo answers this directly.

## Key Files & Entry Points
- `src/server.js` — Express entry point; defines all HTTP routes and wires the service modules together.
- `src/services/ethosAuthService.js` — Cognito-based authentication against Ethos.
- `src/services/ethosClient.js` — shared HTTP client for Ethos REST calls.
- `src/services/contentGenerator.js` — generates draft lesson cards and quiz questions from a topic.
- `src/services/ethosContentService.js` — creates lessons, quizzes, and users in Ethos, with course/learning-plan attachment.
- `src/services/ethosSimulationService.js` — simulates learner progression through lessons/quizzes, locally or via Ethos.
- `src/ui/public/index.html` — the single-page UI shell for the whole workflow.
- `src/ui/public/app.js` — frontend logic driving the UI against the server's API.
- `config.env.example` — template for required Ethos/Cognito/tenant configuration.
- `README.md` — setup steps and the critical warning about irreversible Ethos data creation.

---
_Auto-generated by [obsidian-hub](https://github.com/bretkramer/ethos-obsidian-hub) · 2026-08-17_

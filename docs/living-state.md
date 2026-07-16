# ethos-content-creator — Living State

## What This Is
A demo tool that generates draft lessons and quizzes from an arbitrary topic (Wikipedia content by default) and optionally pushes that content — plus demo learner accounts — into a live Ethos LMS tenant. It exists to let internal teams (sales engineering, demos, integration testing) quickly populate an Ethos tenant with realistic-looking course content and then simulate learners progressing through it, without hand-authoring content or manually driving the Ethos UI.

## How to Run & Access
Local development only — no hosted deployment is evident in the repo.

```bash
cp config.env.example config.env   # fill in Ethos/Cognito credentials and tenant info
npm install
npm run dev                        # nodemon src/server.js
```

App is served at `http://localhost:5179`.

- `npm start` runs the same entry point (`src/server.js`) without file watching, for a plain Node run.
- No Dockerfile, no CI/CD deploy workflow, and no staging/production URL exist in the repo. The only GitHub Action present (`notify-obsidian-hub.yml`) pushes activity to an external "Obsidian Hub" notes system — it is unrelated to app deployment.

## Site Map / Content Structure
Single-page app backed by an Express server:

- `/` — main UI (`src/ui/public/index.html`), a single-page workflow covering:
  - Ethos authentication (enter tenant/credentials, establish session)
  - Topic input and draft content generation (lesson cards + quiz questions from Wikipedia)
  - Review/edit of generated draft before creation
  - Push-to-Ethos controls (create lessons, quizzes, users; attach to course ID; enroll to learning plan ID)
  - Simulation controls (run learners through lessons/quizzes, either purely local or via Ethos enrollment APIs)
- Server-side routes live in `src/server.js` and delegate to the service modules below; there is no separate routes directory, so all API endpoints are defined in one file.

## Current Architecture
- **Runtime**: Node.js, Express 5, ES modules (`"type": "module"`).
- **Session/auth**: `express-session` holds server-side session state; `ethosAuthService.js` handles authentication against Ethos via Amazon Cognito (`amazon-cognito-identity-js`), mirroring the flow used in the separate `ethos-STRMS-quiz-result-extraction` project rather than inventing a new one.
- **Ethos API access**: `ethosClient.js` is the shared HTTP client (axios-based) for calling Ethos REST endpoints; `ethosContentService.js` builds on it to create lessons, quizzes, and users in a tenant, optionally attaching to a course ID and enrolling users to a learning plan ID.
- **Content generation**: `contentGenerator.js` takes a topic string, pulls source material (Wikipedia by default), and produces a draft object with a minimum of 5 lesson cards and 5 quiz questions. This is deliberately "demo-quality" — enough structure to look real, not tuned for pedagogical correctness.
- **Simulation**: `ethosSimulationService.js` drives simulated learner completion of lessons and quiz-taking, either as a local-only simulation or, when a learning plan is configured, through real Ethos enrollment/completion calls.
- **Validation**: `zod` is used for input validation, likely on config/env and API payloads.
- **Frontend**: plain HTML/CSS/JS (`src/ui/public`) served as static assets by Express — no build step, no frontend framework. This keeps the demo tool trivially runnable with no bundler dependency.
- **Data model**: no database. All state is either transient in-memory/session state on the Node process, or created directly as records inside the Ethos tenant via its API. The Ethos tenant itself is the system of record.

## What Works Today
- Users can authenticate against an Ethos tenant using the same Cognito-based flow as the sibling quiz-extraction project.
- Users can generate a draft lesson + quiz set from a topic, sourced from Wikipedia, with a guaranteed minimum of 5 lesson cards and 5 quiz questions.
- Generated content can optionally be created directly in Ethos as lessons and quizzes, and attached to a specified course ID.
- Demo users can be created in Ethos and, if a learning plan ID is supplied, enrolled so that learning item enrollments exist for simulation.
- The app can simulate learners completing lessons and answering quiz questions, either fully locally or by driving real Ethos enrollment/progress calls when configured.
- A recent fix ensures that quiz question cards which are answer-only (no separate content step) are enrolled/handled correctly during simulation, rather than being mishandled as regular content cards.

## Recent Activity
- **Project bootstrap**: the app was committed essentially whole — initial commit lays down the Express server, all core services (auth, client, content generation, content creation, simulation), and the static UI in one pass, rather than growing incrementally.
- **Correctness fix in simulation flow**: a targeted fix addresses enrollment handling specifically for quiz question cards that are answer-only, indicating the simulation logic initially assumed a uniform card shape and needed a special case.
- **Documentation/safety**: the README is updated with an explicit, strongly-worded warning about Ethos's lack of true deletes, steering users toward disposable tenants and small, identifiable data volumes.
- **Tooling**: a minimal GitHub Action is added to notify an external "Obsidian Hub" — this is infrastructure/process tooling, not app functionality, and is the only CI-adjacent activity in the repo.

Momentum is concentrated on getting the core generate → create → simulate loop correct against real Ethos behavior (the answer-only quiz card fix), with documentation catching up to warn about the tenant-pollution risk this workflow creates. There is no evidence yet of work on deployment, testing, or UI polish.

## Known Gaps & Limitations
- No automated tests are present anywhere in the repo; correctness is currently established by manual/live runs against an Ethos tenant.
- No deployment story: no Dockerfile, no hosting config, no environment-specific config beyond `config.env.example` — this is a local-only tool today.
- No database or persistence layer of its own; if the Node process restarts mid-workflow, any in-progress session/generation state is lost (Ethos-side created content, however, persists indefinitely per the README warning).
- Data cleanup is effectively impossible: Ethos supports deactivation, not deletion, so any misuse of this tool against a shared tenant leaves permanent residue.
- Content generation is explicitly "demo-quality" — Wikipedia-sourced lesson/quiz content is not curated or fact-checked, and the 5-item minimums are arbitrary floor values rather than tuned defaults.
- All server routes and orchestration logic live in a single `src/server.js` file; there's no apparent separation between HTTP routing and request handling as the service layer grows.
- The frontend has no build tooling, tests, or component structure — it's a flat static HTML/CSS/JS bundle, which will get harder to extend as UI complexity grows.

## Next Meaningful Capabilities
- **Configurable content sources beyond Wikipedia** would let users generate more relevant/accurate lesson content for domain-specific demos.
- **A dry-run / preview-only mode with no Ethos writes** would let users safely experiment with content generation without any risk of tenant pollution.
- **Bulk cleanup tooling** (deactivation sweeps by naming pattern or tag) would directly address the README's stated pain point of irreversible tenant clutter.
- **Automated tests around the Ethos client and content generator** would de-risk changes to the create/simulate flow, which currently relies on live-tenant verification.
- **A staging/demo deployment** (even a simple hosted instance) would remove the current requirement that every user run this locally with their own Ethos credentials.
- **Structured logging/audit trail of what was created in Ethos per run** would make it possible to reverse or account for a session's tenant impact after the fact.

## Open Technical Questions
- Should the simulation engine fully model all Ethos enrollment/completion states, or is the "local simulation" mode intended to remain the primary path with Ethos-backed simulation as a secondary, best-effort option?
- Is Wikipedia intended to remain the sole/default content source long-term, or is the "by default" phrasing in the README signaling planned support for other sources that hasn't landed yet?
- What is the intended relationship to the sibling project `ethos-STRMS-quiz-result-extraction` — shared auth code today is duplicated by description ("same flow as...") rather than imported as a shared package; unclear if consolidation is planned.
- No environment/config distinction (dev vs. demo vs. prod) exists — is this tool intended to ever run anywhere other than a developer's laptop against a disposable tenant?

## Key Files & Entry Points
- `src/server.js` — Express app entry point; defines HTTP routes and wires together all services.
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
_Auto-generated by [obsidian-hub](https://github.com/bretkramer/ethos-obsidian-hub) · 2026-07-16_

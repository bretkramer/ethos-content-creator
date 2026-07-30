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

The app is served at `http://localhost:5179`.

- `npm start` runs the same entry point (`src/server.js`) without file-watching.
- No Dockerfile, no deploy script, and no staging/production URL exist anywhere in the repo.
- The one GitHub Action present (`.github/workflows/notify-obsidian-hub.yml`) notifies an external "Obsidian Hub" notes system on repo activity. It is documentation-pipeline tooling, not a deployment mechanism — it has no bearing on how or where the app itself runs.

## Site Map / Content Structure
This is a single-page app backed by an Express server; there is no client-side router and no separate pages directory.

- `/` — main UI (`src/ui/public/index.html`), a single workflow screen covering:
  - Ethos authentication (tenant/credentials entry, session establishment)
  - Topic input and draft generation (lesson cards + quiz questions sourced from Wikipedia)
  - Review/edit of the generated draft before anything is created in Ethos
  - Push-to-Ethos controls: create lessons, quizzes, users; attach content to a course ID; enroll users to a learning plan ID
  - Simulation controls: run learners through lessons/quizzes, either purely locally or via real Ethos enrollment calls
- API routes are declared and handled in `src/server.js` directly — there is no `routes/` directory; the server file delegates to the service modules rather than to a router layer.

## Current Architecture
- **Runtime**: Node.js, Express 5, ES modules (`"type": "module"`).
- **Auth**: `ethosAuthService.js` authenticates against Ethos via Amazon Cognito (`amazon-cognito-identity-js`), deliberately mirroring the flow used in the separate `ethos-STRMS-quiz-result-extraction` project rather than introducing a new pattern. `express-session` holds the resulting session state server-side.
- **Ethos API access**: `ethosClient.js` is a shared axios-based HTTP client for Ethos REST calls. `ethosContentService.js` builds on it to create lessons, quizzes, and users, optionally attaching content to a course ID and enrolling users to a learning plan ID.
- **Content generation**: `contentGenerator.js` takes a topic string, pulls source material from Wikipedia, and produces a draft with a minimum of 5 lesson cards and 5 quiz questions. This is intentionally "demo-quality" — structured enough to look real, not tuned for pedagogical accuracy.
- **Simulation**: `ethosSimulationService.js` drives simulated learner completion of lessons and quizzes, either fully local or, when a learning plan is configured, through real Ethos enrollment/progress calls. It special-cases answer-only quiz question cards (cards with no separate content step), since the original card-handling logic assumed a uniform card shape.
- **Validation**: `zod` is present as a dependency for input validation, most plausibly at config/env parsing and API request boundaries.
- **Frontend**: plain HTML/CSS/JS under `src/ui/public`, served as static files by Express. No build step, no framework — appropriate for a throwaway demo utility rather than a maintained product surface.
- **Data model**: no database of any kind. State is transient in-memory/session state on the Node process, or created directly as Ethos records via its API. The Ethos tenant is the only durable system of record.

## What Works Today
- Users authenticate against an Ethos tenant using the same Cognito-based flow as the sibling quiz-extraction project.
- Users generate a draft lesson + quiz set from any topic, sourced from Wikipedia, with a guaranteed floor of 5 lesson cards and 5 quiz questions.
- Generated content can be created directly in Ethos as lessons and quizzes, optionally attached to a specified course ID.
- Demo users can be created in Ethos and, given a learning plan ID, enrolled so learning item enrollments exist for simulation to act on.
- The app simulates learners completing lessons and answering quiz questions, either fully locally or by driving real Ethos enrollment/progress calls.
- Answer-only quiz question cards (no separate content step) are enrolled and handled correctly during simulation rather than being mishandled as ordinary content cards.

## Recent Activity
- **No application code has changed in the recent history window.** Every commit in the last several weeks touches documentation or process tooling — `src/` is untouched.
- **Living-state documentation is being regenerated on a recurring cadence**, roughly weekly, against a codebase that isn't itself changing — the doc pipeline is running, not the product.
- **Process/pipeline tooling was added**: a GitHub Action that notifies an external "Obsidian Hub" notes system on repo activity, wiring this repo into a broader documentation pipeline without touching runtime behavior.
- **The substantive build predates this window**: the server, all five service modules, and the UI landed together in a single initial commit, followed by one targeted fix (answer-only quiz card enrollment during simulation) and a README addition warning about Ethos's lack of true deletes.

Momentum right now is entirely in documentation/process tooling, not the application. The app itself has been functionally frozen since its initial build plus one bug fix — there is no feature work currently in flight.

## Known Gaps & Limitations
- No automated tests exist anywhere; correctness is established by manual, live runs against a real Ethos tenant.
- No deployment path exists: no Dockerfile, no hosting config, no environment-specific settings beyond `config.env.example` — this is a local-only tool today.
- No persistence layer of its own: if the Node process restarts mid-workflow, in-progress session/generation state is lost, while anything already created in Ethos persists indefinitely (per the README's own warning).
- Data cleanup against Ethos is effectively impossible — only deactivation exists, not deletion — so any misuse against a shared tenant leaves permanent residue.
- Content generation is explicitly "demo-quality": Wikipedia-sourced content is uncurated and unverified, and the 5-item minimums are arbitrary floors rather than tuned defaults.
- All HTTP routing and request handling lives in one `src/server.js` file with no router/controller separation as complexity grows.
- The frontend has no build tooling, no tests, and no component structure — a flat static bundle that becomes harder to extend as UI needs grow.
- It is unclear whether this project is still actively maintained as an app, or has settled into a "done, documented" state — the codebase has had no substantive change in a long time relative to the ongoing doc-regeneration cadence.

## Next Meaningful Capabilities
- **Configurable content sources beyond Wikipedia** would let users generate more relevant, domain-specific demo content instead of relying on general-purpose encyclopedia text.
- **A dry-run / preview-only mode with zero Ethos writes** would let users experiment with content generation with no risk of tenant pollution.
- **Bulk cleanup tooling** (deactivation sweeps by naming pattern or tag) would directly address the README's stated pain point of irreversible tenant clutter.
- **Automated tests around the Ethos client, content generator, and simulation service** would de-risk changes to the create/simulate flow, which today relies entirely on live-tenant verification.
- **A shared, hosted demo environment** would remove the current requirement that every user run this locally with their own Ethos/Cognito credentials.
- **A structured audit log of what a given run created in Ethos** would make it possible to account for, or later reverse, a session's tenant impact.

## Open Technical Questions
- Should local simulation remain the primary path, with Ethos-backed simulation as a secondary best-effort option, or is full parity between the two the actual goal?
- Is Wikipedia meant to stay the sole content source, or does the README's "by default" phrasing signal planned support for other sources that hasn't landed yet?
- What is the intended relationship to `ethos-STRMS-quiz-result-extraction`? Auth logic is duplicated by description ("same flow as...") rather than shared via a package — unclear whether consolidation is planned.
- No dev/demo/prod distinction exists in config — is this tool meant to ever run anywhere other than a developer's laptop against a disposable tenant?
- Is the sustained absence of app-level commits a sign the project is intentionally feature-complete for its demo purpose, or simply dormant?

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
_Auto-generated by [obsidian-hub](https://github.com/bretkramer/ethos-obsidian-hub) · 2026-07-30_

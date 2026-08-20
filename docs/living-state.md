# ethos-content-creator — Living State

## What This Is
A demo tool that turns a plain-text topic into a draft course — lesson cards and quiz questions sourced from Wikipedia by default — and, on request, writes that draft into a live Ethos LMS tenant as real lessons, quizzes, and users. It's built for people running sales demos, integration tests, or tenant walkthroughs who need realistic-looking course content in Ethos in minutes rather than hand-authored from scratch, and who then want to simulate learners moving through that content to show enrollment and completion flows without recruiting real users.

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
- The one GitHub Action present (`.github/workflows/notify-obsidian-hub.yml`) notifies an external "Obsidian Hub" notes/automation system on repo activity — documentation tooling, unrelated to deployment.
- **No production or staging environment exists.** Every run is against whatever Ethos tenant the operator points `config.env` at. The README explicitly warns to use a disposable/demo tenant, since Ethos has no real delete, only deactivate.

## Site Map / Content Structure
A single-page workflow served by Express, with no client-side router and no multi-page navigation.

- `/` (`src/ui/public/index.html`) — the entire app lives on one screen, moving through:
  - **Authenticate** — enter Ethos tenant/credentials, establish a session
  - **Generate** — enter a topic, produce a draft (minimum 5 lesson cards, minimum 5 quiz questions) from Wikipedia
  - **Review/edit** — inspect and adjust the draft before anything touches Ethos
  - **Create in Ethos** — push lessons, quizzes, and users into the tenant; attach content to an optional course ID; enroll users against an optional learning plan ID
  - **Simulate** — run learners through the generated lessons/quizzes, either as a purely local simulation or via real Ethos enrollment/progress calls
- API endpoints are defined and handled inline in `src/server.js`; there's no `routes/` directory or controller layer — the server calls straight into the service modules below.

## Current Architecture
- **Runtime**: Node.js + Express 5, ES modules throughout (`"type": "module"`).
- **Auth**: `ethosAuthService.js` authenticates against Ethos through Amazon Cognito (`amazon-cognito-identity-js`), deliberately mirroring the same flow used by the separate `ethos-STRMS-quiz-result-extraction` project rather than sharing a package — the auth logic is duplicated by design, not centralized. `express-session` holds session state server-side, so the client never sees a token directly.
- **Ethos API access**: `ethosClient.js` is a shared axios wrapper for Ethos REST calls. `ethosContentService.js` builds on it to create lessons, quizzes, and users, with optional course attachment and learning-plan enrollment.
- **Content generation**: `contentGenerator.js` takes a topic, pulls Wikipedia source text, and shapes it into a draft with hard floors of 5 lesson cards and 5 quiz questions. This is explicitly demo-grade content — structured to look like a course, not curated or fact-checked.
- **Simulation**: `ethosSimulationService.js` drives simulated learner progress through generated content, either entirely in-memory or, when a learning plan is configured, through real Ethos enrollment/progress calls. It special-cases "answer-only" quiz question cards (cards with no separate content step), because Ethos's content model doesn't fit a single uniform card shape.
- **Validation**: `zod` is a dependency, most likely used for config/env or request-boundary checks, but there's no dedicated schema file — its use appears to be inline rather than centralized in a schema layer.
- **Frontend**: static HTML/CSS/JS under `src/ui/public`, served directly by Express with no build step, bundler, or framework — proportionate to a throwaway demo tool, not built to scale as a UI.
- **Data model**: there is none locally. The Node process holds only transient in-memory/session state; the sole durable system of record is whatever gets written into the Ethos tenant through its API.

## What Works Today
- Users authenticate to an Ethos tenant using the Cognito flow shared conceptually with the quiz-extraction project.
- Users generate a draft lesson-and-quiz set from any topic, sourced from Wikipedia, guaranteed at least 5 lesson cards and 5 quiz questions.
- Drafts can be created in Ethos as real lessons and quizzes, optionally attached to a specified course ID.
- Demo user accounts can be created in Ethos and, given a learning plan ID, enrolled so learning item enrollments exist for simulation to act on.
- Simulated learners can complete lessons and answer quiz questions, either purely locally or through real Ethos enrollment/progress calls.
- Answer-only quiz question cards (no separate content step) are enrolled and progressed correctly during simulation, rather than being mishandled as standard content cards.

## Recent Activity
- **No application code has changed in well over a month.** Every commit in recent history is a `docs: regenerate living state` cycle — nothing under `src/` has moved.
- The living-state document regenerates on a **recurring, roughly weekly cadence** against an otherwise static codebase — this documentation loop is currently the only visibly active process in the repository.
- Shortly before this documentation cadence began, an **Obsidian Hub notify workflow** was wired in, connecting the repo to an external notes/automation system on repo activity — a process addition, not a runtime change.
- The last substantive application work predates all of this: an initial build of the server, all five services, and the UI, followed by one targeted fix correcting enrollment handling for answer-only quiz question cards during simulation, plus a README addition warning about Ethos's lack of true deletes.

Momentum right now sits entirely in documentation/process tooling. The application itself has been functionally frozen since its initial build and one follow-up fix, with no feature work currently in flight.

## Known Gaps & Limitations
- No automated tests anywhere — correctness is verified only by manually running the full flow against a live Ethos tenant.
- No deployment path exists: no Dockerfile, no hosting config, nothing beyond `config.env.example` — this is strictly a local tool today.
- No persistence layer: restarting the Node process mid-workflow loses in-progress session/draft state, while anything already pushed to Ethos persists indefinitely regardless.
- Cleanup against Ethos is effectively one-way — deactivate only, no true delete — so any misuse against a shared tenant leaves permanent residue, exactly as the README warns.
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
- Should local-only simulation remain the primary path with Ethos-backed simulation as a best-effort secondary, or is full parity between the two the actual goal?
- Is Wikipedia meant to stay the only content source, or does "by default" in the README signal planned support for other sources that hasn't materialized?
- What's the intended long-term relationship to `ethos-STRMS-quiz-result-extraction`? Auth is duplicated by design rather than shared as a package — is consolidation ever planned, or is duplication acceptable here?
- There's no dev/demo/prod config distinction — is this tool meant to run only on a developer's machine against a disposable tenant, or is a shared environment eventually in scope?
- Is the sustained absence of app-level commits intentional (feature-complete for its demo purpose) or simple dormancy? Nothing in the repo answers this directly.

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
_Auto-generated by [obsidian-hub](https://github.com/bretkramer/ethos-obsidian-hub) · 2026-08-20_

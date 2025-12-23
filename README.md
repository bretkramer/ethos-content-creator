# ethos-content-creator

Demo app to:

- Authenticate to the Ethos API (same flow as `ethos-STRMS-quiz-result-extraction`)
- Generate draft lessons/quizzes from a topic (Wikipedia by default)
- Create lessons/quizzes/users in Ethos (optional)
- Simulate learners completing lessons and taking quizzes (local simulation + optional Ethos enrollment flow when configured)

## Setup

1. Copy `config.env.example` to `config.env` and fill values.
2. Install deps and run:

```bash
npm install
npm run dev
```

3. Open the app at `http://localhost:5179`

## Notes

- This is **demo-quality** content generation: it produces **minimum 5 lesson cards** and **minimum 5 quiz questions** per item.
- If you supply a course ID, created lessons/quizzes will be attached to that course.
- If you supply a learning plan ID, created users can be enrolled to generate learning item enrollments used for simulation.


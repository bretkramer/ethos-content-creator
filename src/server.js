import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
import { z } from 'zod';

import { EthosAuthService } from './services/ethosAuthService.js';
import { EthosContentService } from './services/ethosContentService.js';
import { EthosSimulationService } from './services/ethosSimulationService.js';
import { generateDraft, simulateOutcomes } from './services/contentGenerator.js';

dotenv.config({ path: 'config.env' });

const PORT = Number(process.env.PORT || 5179);
const ETHOS_BASE_URL = process.env.ETHOS_BASE_URL || 'https://api.ethossystems.com';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'ui', 'public');

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

function getCredentials(req) {
  return req.session?.ethos || null;
}

function requireAuth(req, res, next) {
  const creds = getCredentials(req);
  if (!creds?.apiKey || !creds?.contextToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

const authService = new EthosAuthService({ baseUrl: ETHOS_BASE_URL });

app.post('/api/auth/organizations', async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body || {});
    const organizations = await authService.getOrganizations(email);
    res.json({ organizations });
  } catch (e) {
    next(e);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password, organizationId } = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
        organizationId: z.string().min(1),
      })
      .parse(req.body || {});

    const creds = await authService.authenticate({ email, password, organizationId });
    req.session.ethos = { ...creds, email };
    res.json({ ok: true, organizationId: creds.organizationId, baseUrl: creds.baseUrl });
  } catch (e) {
    next(e);
  }
});

app.post('/api/auth/logout', async (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', (req, res) => {
  const creds = getCredentials(req);
  if (!creds) return res.json({ authenticated: false });
  res.json({
    authenticated: Boolean(creds.apiKey && creds.contextToken),
    email: creds.email,
    organizationId: creds.organizationId,
    baseUrl: creds.baseUrl,
  });
});

app.post('/api/generate', async (req, res, next) => {
  try {
    const body = z
      .object({
        topic: z.string().min(2),
        lessonsCount: z.number().int().min(0).max(20).default(1),
        quizzesCount: z.number().int().min(0).max(20).default(1),
        usersCount: z.number().int().min(0).max(200).default(10),
        userEmailBase: z.string().trim().nullable().optional(),
        userEmailDomain: z.string().trim().nullable().optional(),
        userEmailStartIndex: z.number().int().min(1).max(100000).optional(),
      })
      .parse(req.body || {});

    // If not explicitly provided, prefer env defaults; if those are missing,
    // derive from the authenticated user's email (when available).
    const sessionEmail = req.session?.ethos?.email || '';
    const [sessionBase, sessionDomain] = sessionEmail.includes('@') ? sessionEmail.split('@') : ['', ''];
    const defaultBase = process.env.USER_EMAIL_BASE || sessionBase || '';
    const defaultDomain = process.env.USER_EMAIL_DOMAIN || sessionDomain || '';

    const draft = await generateDraft({
      ...body,
      userEmailBase: body.userEmailBase || defaultBase,
      userEmailDomain: body.userEmailDomain || defaultDomain,
      userEmailStartIndex: body.userEmailStartIndex || Number(process.env.USER_EMAIL_START_INDEX || 1),
    });
    res.json(draft);
  } catch (e) {
    next(e);
  }
});

app.post('/api/ethos/publish', requireAuth, async (req, res, next) => {
  try {
    const body = z
      .object({
        draft: z.any(),
        courseId: z.string().trim().min(1).nullable().optional(),
        learningItemState: z.enum(['draft', 'published']).default('draft'),
        reuseExistingUsers: z.boolean().optional(),
        enableEthosGeneratedGroup: z.boolean().optional(),
        ethosGeneratedAttributeName: z.string().trim().min(1).optional(),
        ethosGeneratedGroupName: z.string().trim().min(1).optional(),
        autoPublishCourse: z.boolean().optional(),
        autoPublishLearningItems: z.boolean().optional(),
      })
      .parse(req.body || {});

    const creds = getCredentials(req);
    const service = new EthosContentService({ credentials: creds });
    const created = await service.publishDraft({
      draft: body.draft,
      courseId: body.courseId || process.env.DEFAULT_COURSE_ID || null,
      learningItemState: body.learningItemState,
      reuseExistingUsers: body.reuseExistingUsers ?? true,
      enableEthosGeneratedGroup: body.enableEthosGeneratedGroup ?? true,
      ethosGeneratedAttributeName:
        body.ethosGeneratedAttributeName || process.env.ETHOS_GENERATED_ATTRIBUTE_NAME || 'EthosGenerated',
      ethosGeneratedGroupName:
        body.ethosGeneratedGroupName || process.env.ETHOS_GENERATED_GROUP_NAME || 'Ethos Generated Learners',
      autoPublishCourse:
        body.autoPublishCourse ?? String(process.env.AUTO_PUBLISH_COURSE || '').toLowerCase() === 'true',
      autoPublishLearningItems:
        body.autoPublishLearningItems ?? String(process.env.AUTO_PUBLISH_LEARNING_ITEMS || '').toLowerCase() === 'true',
    });

    res.json(created);
  } catch (e) {
    next(e);
  }
});

app.get('/api/ethos/courses', requireAuth, async (req, res, next) => {
  try {
    const creds = getCredentials(req);
    const service = new EthosContentService({ credentials: creds });

    const data = await service.client.get('/v1/courses', { params: { itemsPerPage: 100 } });
    const courses = Array.isArray(data) ? data : data?.['hydra:member'] || [];

    res.json({
      courses: courses.map((c) => ({
        id: c.id,
        iri: c['@id'] ? `${creds.baseUrl}${c['@id']}` : null,
        title: c.title || c.name || null,
        state: c.state || null,
      })),
    });
  } catch (e) {
    next(e);
  }
});

app.post('/api/simulate', async (req, res, next) => {
  try {
    const body = z
      .object({
        draft: z.any(),
        lessonCompletionRate: z.number().min(0).max(1).default(0.8),
        quizParticipationRate: z.number().min(0).max(1).default(0.7),
        quizScoreMean: z.number().min(0).max(1).default(0.78),
        quizScoreStd: z.number().min(0).max(1).default(0.12),
      })
      .parse(req.body || {});

    const results = simulateOutcomes({
      users: body.draft.users || [],
      lessons: body.draft.lessons || [],
      quizzes: body.draft.quizzes || [],
      lessonCompletionRate: body.lessonCompletionRate,
      quizParticipationRate: body.quizParticipationRate,
      quizScoreMean: body.quizScoreMean,
      quizScoreStd: body.quizScoreStd,
    });

    res.json(results);
  } catch (e) {
    next(e);
  }
});

app.post('/api/ethos/simulate', requireAuth, async (req, res, next) => {
  try {
    const extractUuid = (value) => {
      if (!value) return null;
      const m = String(value).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      return m?.[0] || null;
    };

    const body = z
      .object({
        published: z.any(),
        lessonCompletionRate: z.number().min(0).max(1).default(0.8),
        quizParticipationRate: z.number().min(0).max(1).default(0.7),
        quizScoreMean: z.number().min(0).max(1).default(0.78),
        quizScoreStd: z.number().min(0).max(1).default(0.12),
        debug: z.boolean().optional(),
      })
      .parse(req.body || {});

    const creds = getCredentials(req);

    const publishedUsers = Array.isArray(body.published?.users) ? body.published.users : [];
    const lessonItems = Array.isArray(body.published?.lessons) ? body.published.lessons : [];
    const quizItems = Array.isArray(body.published?.quizzes) ? body.published.quizzes : [];

    const userIds = publishedUsers.map((u) => u.id).filter(Boolean);
    const lessonIds = lessonItems.map((x) => extractUuid(x?.learningItem?.id ?? x?.learningItem?.['@id'])).filter(Boolean);
    const quizIds = quizItems.map((x) => extractUuid(x?.learningItem?.id ?? x?.learningItem?.['@id'])).filter(Boolean);
    const courseIdFromRef =
      body.published?.courseRef?.id ||
      body.published?.courseId ||
      (lessonItems[0]?.learningItem?.course ? String(lessonItems[0].learningItem.course).match(/[0-9a-f-]{36}/i)?.[0] : null);

    const sim = simulateOutcomes({
      users: publishedUsers.map((u) => ({ id: u.id, email: u.email })),
      lessons: lessonIds.map((id) => ({ name: id })),
      quizzes: quizIds.map((id) => ({ name: id })),
      lessonCompletionRate: body.lessonCompletionRate,
      quizParticipationRate: body.quizParticipationRate,
      quizScoreMean: body.quizScoreMean,
      quizScoreStd: body.quizScoreStd,
    });

    const simService = new EthosSimulationService({ credentials: creds });

    // Batch-poll enrollments once (avoid per-user per-item long waits).
    const enrollmentTimeoutMs = 60_000;
    const allItemIds = [...lessonIds, ...quizIds];

    const enrollments = await simService.waitForEnrollments({
      learningItemIds: allItemIds,
      userIds,
      courseId: courseIdFromRef,
      timeoutMs: enrollmentTimeoutMs,
      pollMs: 2_000,
    });

    // Only run expensive diagnostics when explicitly requested, or when enrollments are missing.
    const debug = Boolean(body.debug);
    const shouldRunDiagnostics = debug || enrollments.length === 0;

    const enrollmentDebug = shouldRunDiagnostics
      ? await simService.debugEnrollmentQueries({
          learningItemIds: allItemIds,
          userIds,
          courseId: courseIdFromRef,
          mode: 'full',
        })
      : [{ strategy: 'skipped', reason: 'enrollments_found', foundEnrollments: enrollments.length }];

    const courseEnrollmentDebug =
      shouldRunDiagnostics && courseIdFromRef
        ? await simService.debugCourseEnrollment({ courseId: courseIdFromRef, userIds, learningItemIds: allItemIds })
        : null;

    const enrollmentMap = new Map();
    for (const e of enrollments) {
      // When using course-enrollment strategy, we already have a userId field.
      if (e.userId && e.learningItemId && e.learningItemEnrollmentId) {
        const li = extractUuid(e.learningItemId);
        if (li) enrollmentMap.set(`${e.userId}:${li}`, e.learningItemEnrollmentId);
        continue;
      }

      const li = extractUuid(e.learningItemId || e.learningItem?.id || e.learningItem?.['@id'] || e.learning_item_id || null);
      if (!li || !e.id) continue;

      const userIdForEnrollment = await simService.getCourseEnrollmentUserId(e.courseEnrollment);
      if (!userIdForEnrollment) continue;
      enrollmentMap.set(`${userIdForEnrollment}:${li}`, e.id);
    }

    const perUserResults = [];
    for (const u of sim.perUser) {
      const userId = u.user.id;
      const completedLessons = [];
      const completedQuizzes = [];
      const enrollmentMisses = [];

      // Lessons: complete if flagged
      for (let i = 0; i < lessonIds.length; i++) {
        const shouldComplete = u.lessonResults?.[i]?.completed;
        if (!shouldComplete) continue;
        const enrollmentId = enrollmentMap.get(`${userId}:${lessonIds[i]}`) || null;
        const r = await simService.completeLesson({ learningItemEnrollmentId: enrollmentId, userId });
        if (!r.ok) enrollmentMisses.push({ type: 'lesson', learningItemId: lessonIds[i] });
        completedLessons.push(r);
      }

      // Quizzes: if took, answer to target percent
      for (let i = 0; i < quizIds.length; i++) {
        const took = u.quizResults?.[i]?.took;
        const pct = u.quizResults?.[i]?.percentCorrect;
        if (!took || typeof pct !== 'number') continue;
        const enrollmentId = enrollmentMap.get(`${userId}:${quizIds[i]}`) || null;
        const r = await simService.answerQuizByTargetPercent({
          learningItemEnrollmentId: enrollmentId,
          userId,
          targetPercentCorrect: pct,
        });
        if (!r.ok) enrollmentMisses.push({ type: 'quiz', learningItemId: quizIds[i] });
        completedQuizzes.push(r);
      }

      perUserResults.push({ userId, completedLessons, completedQuizzes, enrollmentMisses });
    }

    res.json({
      ok: true,
      note: 'Enrollment is expected to be handled via EthosGenerated attribute + learning group rules (configured during publish).',
      enrollmentWait: { timeoutMs: enrollmentTimeoutMs, foundEnrollments: enrollments.length },
      enrollmentDebug,
      courseEnrollmentDebug,
      simulation: sim.summary,
      perUserResults,
    });
  } catch (e) {
    next(e);
  }
});

app.use(express.static(publicDir));
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.use((_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // Prefer upstream Ethos status codes when present
  const status = err?.status || err?.statusCode || 400;
  // eslint-disable-next-line no-console
  console.error('Request error:', {
    status,
    name: err?.name,
    message: err?.message,
    method: err?.method,
    url: err?.url,
    ethosData: err?.data,
  });
  res.status(status).json({
    error: err?.message || 'Unknown error',
    details: err?.data || undefined,
    request: err?.method && err?.url ? { method: err.method, url: err.url } : undefined,
  });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Ethos Content Creator running on http://localhost:${PORT}`);
});


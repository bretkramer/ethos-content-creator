import { EthosClient } from './ethosClient.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hydraMembers(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data['hydra:member'])) return data['hydra:member'];
  if (Array.isArray(data.member)) return data.member;
  return [];
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function parseCardJson(maybeJson) {
  if (!maybeJson) return null;
  if (typeof maybeJson === 'object') return maybeJson;
  if (typeof maybeJson === 'string') {
    try {
      return JSON.parse(maybeJson);
    } catch {
      return null;
    }
  }
  return null;
}

function pickOptionIdFromCard(card, { correct }) {
  const json = parseCardJson(card.json);
  const blocks = json?.contentBlocks || [];
  const mc = blocks.find((b) => b?.type === 'multipleChoice' || b?.type === 'trueFalse');
  const opts = mc?.options || [];
  if (!opts.length) return null;
  const correctOpts = opts.filter((o) => o?.isCorrect);
  const wrongOpts = opts.filter((o) => !o?.isCorrect);
  const pool = correct ? correctOpts : wrongOpts;
  const chosen = pool[0] || opts[0];
  return chosen?.id || null;
}

function isQuestionCard(card) {
  const json = parseCardJson(card?.json);
  const blocks = json?.contentBlocks || [];
  const hasQuestionBlock = blocks.some((b) => b?.type === 'multipleChoice' || b?.type === 'trueFalse');
  return Boolean(hasQuestionBlock || json?.templateType === 'multipleChoice');
}

export class EthosSimulationService {
  constructor({ credentials }) {
    this.client = new EthosClient(credentials);
    this._courseEnrollmentUserCache = new Map();
  }

  _normalizeUuidFromAnything(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      const m = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (m?.[0]) return m[0];
      // As a fallback, treat as IRI-like string and grab the last segment.
      if (value.includes('/')) return this._extractIdFromIri(value);
      return value;
    }
    if (typeof value === 'object') {
      // Common Hydra shapes
      if (value.id) return this._normalizeUuidFromAnything(value.id);
      if (value['@id']) return this._normalizeUuidFromAnything(value['@id']);
    }
    return null;
  }

  _extractIdFromRef(ref) {
    if (!ref) return null;
    if (typeof ref === 'string') return this._extractIdFromIri(ref);
    if (typeof ref === 'object') {
      if (ref.id) return String(ref.id);
      if (ref['@id']) return this._extractIdFromIri(ref['@id']);
    }
    return null;
  }

  _normalizeLearningItemEnrollment(e) {
    if (!e || typeof e !== 'object') return e;
    const id = this._normalizeUuidFromAnything(e.id ?? e['@id']);
    const learningItemId = this._normalizeUuidFromAnything(e.learningItemId ?? e.learning_item_id ?? e.learningItem ?? e.learning_item);
    const courseEnrollment = e.courseEnrollment ?? e.course_enrollment ?? null;
    return { ...e, id: id ?? e.id, learningItemId: learningItemId ?? e.learningItemId, courseEnrollment };
  }

  _normalizeCardEnrollment(e) {
    if (!e || typeof e !== 'object') return e;
    const id = this._normalizeUuidFromAnything(e.id ?? e['@id']);
    const cardId = this._normalizeUuidFromAnything(e.cardId ?? e.card_id ?? e.card ?? e.cardRef ?? e.card_ref);
    return { ...e, id: id ?? e.id, cardId: cardId ?? e.cardId };
  }

  async _mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let idx = 0;
    const workers = new Array(Math.max(1, concurrency)).fill(null).map(async () => {
      while (true) {
        const current = idx++;
        if (current >= items.length) return;
        results[current] = await mapper(items[current], current);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async listCourseEnrollmentsPage({ courseId, page, itemsPerPage = 500 }) {
    const params = new URLSearchParams();
    params.set('itemsPerPage', String(itemsPerPage));
    if (page) params.set('page', String(page));
    params.set('order[updatedAt]', 'desc');
    if (courseId) params.set('courseId', courseId);
    const data = await this.client.get('/v1/course_enrollments', { params });
    return hydraMembers(data);
  }

  async listCourseEnrollmentsBestEffort({ courseId, userIds, itemsPerPage = 500, maxPages = 25 }) {
    // Prefer courseId filter (if it works), but fall back to unfiltered pagination.
    const fetchAll = async (maybeCourseId) => {
      const out = [];
      for (let page = 1; page <= maxPages; page++) {
        const batch = await this.listCourseEnrollmentsPage({ courseId: maybeCourseId, page, itemsPerPage });
        if (!batch.length) break;
        out.push(...batch);
        // Safety: stop if we get a lot.
        if (out.length >= itemsPerPage * maxPages) break;
      }
      return out;
    };

    let enrollments = [];
    let usedCourseIdFilter = false;

    if (courseId) {
      try {
        enrollments = await fetchAll(courseId);
        usedCourseIdFilter = true;
      } catch {
        // ignore and fall back
      }
    }

    if (!enrollments.length) {
      enrollments = await fetchAll(null);
      usedCourseIdFilter = false;
    }

    // Client-side user filter (Ethos server filtering can be unreliable in some tenants)
    const userSet = Array.isArray(userIds) && userIds.length ? new Set(userIds) : null;
    if (userSet) {
      enrollments = enrollments.filter((ce) => ce?.userId && userSet.has(ce.userId));
    }

    return { enrollments, usedCourseIdFilter };
  }

  async listLearningItemEnrollmentsForCourseEnrollment({ courseEnrollmentId }) {
    const data = await this.client.get(`/v1/course_enrollments/${courseEnrollmentId}/learning_item_enrollments`);
    return hydraMembers(data).map((e) => this._normalizeLearningItemEnrollment(e));
  }

  async getLearningItemEnrollment({ learningItemEnrollmentId }) {
    const e = await this.client.get(`/v1/learning_item_enrollments/${learningItemEnrollmentId}`);
    return this._normalizeLearningItemEnrollment(e);
  }

  async listEnrollmentsViaCourseEnrollments({ courseId, userIds, learningItemIds }) {
    const { enrollments: courseEnrollments, usedCourseIdFilter } = await this.listCourseEnrollmentsBestEffort({
      courseId,
      userIds,
      itemsPerPage: 500,
      maxPages: 25,
    });

    // Collect learning item enrollment IDs from course enrollments.
    // NOTE: In many tenants, course enrollments embed `learningItemEnrollments` objects with an `@id`
    // that is actually the learning_item_enrollment ID, not the learningItemId.
    const enrollmentRefs = [];
    for (const ce of courseEnrollments) {
      if (!ce?.id || !ce?.userId) continue;

      // Tenants vary in shape here; support multiple keys and hydra pagination objects.
      const embedded = hydraMembers(
        ce.learningItemEnrollments ??
          ce.learning_item_enrollments ??
          ce.learningItemEnrollment ??
          ce.learning_item_enrollment ??
          ce.learningItemEnrollmentIds ??
          ce.learning_item_enrollment_ids,
      );
      if (embedded.length) {
        for (const ref of embedded) {
          const liEnrollmentId = this._extractIdFromRef(ref);
          if (!liEnrollmentId) continue;
          enrollmentRefs.push({ userId: ce.userId, courseEnrollmentId: ce.id, learningItemEnrollmentId: liEnrollmentId });
        }
        continue;
      }

      // Fallback: fetch the subresource and extract IDs (it may return full objects OR refs).
      const li = await this.listLearningItemEnrollmentsForCourseEnrollment({ courseEnrollmentId: ce.id });
      for (const ref of li) {
        const liEnrollmentId = this._extractIdFromRef(ref);
        if (!liEnrollmentId) continue;
        enrollmentRefs.push({ userId: ce.userId, courseEnrollmentId: ce.id, learningItemEnrollmentId: liEnrollmentId });
      }
    }

    // Hydrate each enrollment so we can read the actual learningItemId.
    const hydrated = await this._mapWithConcurrency(enrollmentRefs, 10, async (row) => {
      try {
        const e = await this.getLearningItemEnrollment({ learningItemEnrollmentId: row.learningItemEnrollmentId });
        const li = this._normalizeUuidFromAnything(e?.learningItemId) || null;
        return { ...row, learningItemId: li };
      } catch (err) {
        return { ...row, learningItemId: null, error: err?.message || String(err) };
      }
    });

    const all = [];
    const sampleLearningItemIds = new Set();
    for (const e of hydrated) {
      if (!e?.learningItemEnrollmentId || !e?.learningItemId || !e?.userId) continue;
      if (sampleLearningItemIds.size < 50) sampleLearningItemIds.add(e.learningItemId);
      if (Array.isArray(learningItemIds) && learningItemIds.length && !learningItemIds.includes(e.learningItemId)) continue;
      all.push({ userId: e.userId, learningItemId: e.learningItemId, learningItemEnrollmentId: e.learningItemEnrollmentId });
    }

    return {
      courseEnrollmentsCount: courseEnrollments.length,
      mapped: all,
      usedCourseIdFilter,
      sampleLearningItemIds: Array.from(sampleLearningItemIds),
    };
  }

  async debugCourseEnrollment({ courseId, userIds, learningItemIds }) {
    const { enrollments: courseEnrollments, usedCourseIdFilter } = await this.listCourseEnrollmentsBestEffort({
      courseId,
      userIds,
      itemsPerPage: 200,
      maxPages: 5,
    });
    const first = courseEnrollments.find((ce) => ce?.id) || null;
    if (!first?.id) {
      return { courseEnrollments: courseEnrollments.length, usedCourseIdFilter, sample: null };
    }
    const li = await this.listLearningItemEnrollmentsForCourseEnrollment({ courseEnrollmentId: first.id });
    const liIds = li.map((e) => this._extractIdFromRef(e)).filter(Boolean);
    const hydrated = await this._mapWithConcurrency(liIds.slice(0, 25), 10, async (id) => {
      try {
        const e = await this.getLearningItemEnrollment({ learningItemEnrollmentId: id });
        return e?.learningItemId || null;
      } catch {
        return null;
      }
    });
    const ids = hydrated.filter(Boolean);
    const targets = new Set((learningItemIds || []).filter(Boolean));
    const intersection = ids.filter((id) => targets.has(id)).slice(0, 50);
    return {
      courseEnrollments: courseEnrollments.length,
      usedCourseIdFilter,
      sample: {
        courseEnrollmentId: first.id,
        userId: first.userId,
        learningItemEnrollmentsCount: li.length,
        firstLearningItemIds: ids.slice(0, 25),
        intersectionCount: intersection.length,
      },
    };
  }

  async listLearningItemEnrollments({ learningItemIds, userIds, itemsPerPage = 500 }) {
    // IMPORTANT:
    // Axios default query serialization does NOT reliably encode repeated params.
    // Ethos expects repeated array params like:
    //  learningItemId[]=id1&learningItemId[]=id2
    // So we build URLSearchParams manually.
    const params = new URLSearchParams();
    params.set('itemsPerPage', String(itemsPerPage));

    if (Array.isArray(learningItemIds)) {
      for (const id of learningItemIds.filter(Boolean)) params.append('learningItemId[]', id);
    }
    if (Array.isArray(userIds)) {
      for (const id of userIds.filter(Boolean)) params.append('courseEnrollment.userId[]', id);
    }

    const data = await this.client.get('/v1/learning_item_enrollments', { params });
    return hydraMembers(data).map((e) => this._normalizeLearningItemEnrollment(e));
  }

  async listLearningItemEnrollmentsForSingleItem({ learningItemId, itemsPerPage = 500 }) {
    const params = new URLSearchParams();
    params.set('itemsPerPage', String(itemsPerPage));
    params.set('learningItemId', learningItemId);
    params.set('order[updatedAt]', 'desc');
    const data = await this.client.get('/v1/learning_item_enrollments', { params });
    return hydraMembers(data).map((e) => this._normalizeLearningItemEnrollment(e));
  }

  async listLearningItemEnrollmentsRecent({ itemsPerPage = 100 }) {
    const params = new URLSearchParams();
    params.set('itemsPerPage', String(itemsPerPage));
    params.set('order[updatedAt]', 'desc');
    const data = await this.client.get('/v1/learning_item_enrollments', { params });
    return hydraMembers(data).map((e) => this._normalizeLearningItemEnrollment(e));
  }

  _extractIdFromIri(iri) {
    if (!iri) return null;
    const s = String(iri);
    const parts = s.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  }

  async getCourseEnrollmentUserId(courseEnrollmentIri) {
    const courseEnrollmentId = this._extractIdFromIri(courseEnrollmentIri);
    if (!courseEnrollmentId) return null;
    if (this._courseEnrollmentUserCache.has(courseEnrollmentId)) {
      return this._courseEnrollmentUserCache.get(courseEnrollmentId);
    }
    try {
      const ce = await this.client.get(`/v1/course_enrollments/${courseEnrollmentId}`);
      const userId = ce?.userId || null;
      this._courseEnrollmentUserCache.set(courseEnrollmentId, userId);
      return userId;
    } catch {
      this._courseEnrollmentUserCache.set(courseEnrollmentId, null);
      return null;
    }
  }

  async listLearningItemEnrollmentsAll({ itemsPerPage = 200, maxPages = 10, requestTimeoutMs = 30_000 }) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams();
      params.set('itemsPerPage', String(itemsPerPage));
      params.set('page', String(page));
      params.set('order[updatedAt]', 'desc');
      const batch = hydraMembers(await this.client.get('/v1/learning_item_enrollments', { params, timeout: requestTimeoutMs })).map((e) =>
        this._normalizeLearningItemEnrollment(e),
      );
      if (!batch.length) break;
      out.push(...batch);
    }
    return out;
  }

  async debugEnrollmentQueries({ learningItemIds, userIds, courseId, mode = 'full' }) {
    const out = [];

    if (mode !== 'full') {
      try {
        const c = await this.listLearningItemEnrollmentsRecent({ itemsPerPage: 50 });
        return [{ strategy: 'recent_unfiltered', count: c.length, note: 'light diagnostics only' }];
      } catch (e) {
        return [{ strategy: 'recent_unfiltered', error: e?.message || String(e), note: 'light diagnostics only' }];
      }
    }

    // Strategy A: bulk filters (learningItemId[] + courseEnrollment.userId[])
    try {
      const a = await this.listLearningItemEnrollments({ learningItemIds, userIds, itemsPerPage: 500 });
      out.push({ strategy: 'bulk_filters', count: a.length });
    } catch (e) {
      out.push({ strategy: 'bulk_filters', error: e?.message || String(e) });
    }

    // Strategy B: per learningItemId (no user filter)
    try {
      let total = 0;
      for (const id of (learningItemIds || []).slice(0, 20)) {
        const items = await this.listLearningItemEnrollmentsForSingleItem({ learningItemId: id, itemsPerPage: 200 });
        total += items.length;
      }
      out.push({ strategy: 'per_learning_item', count: total, itemsChecked: Math.min((learningItemIds || []).length, 20) });
    } catch (e) {
      out.push({ strategy: 'per_learning_item', error: e?.message || String(e) });
    }

    // Strategy C: recent enrollments (no filters) – useful to detect access issues
    try {
      const c = await this.listLearningItemEnrollmentsRecent({ itemsPerPage: 50 });
      out.push({ strategy: 'recent_unfiltered', count: c.length });
    } catch (e) {
      out.push({ strategy: 'recent_unfiltered', error: e?.message || String(e) });
    }

    // Strategy D: unfiltered paged enrollments, filtered locally to our items/users (best in tenants where filters break)
    try {
      const all = await this.listLearningItemEnrollmentsAll({ itemsPerPage: 200, maxPages: 3, requestTimeoutMs: 90_000 });
      const itemSet = new Set((learningItemIds || []).filter(Boolean));
      let matchItems = 0;
      for (const e of all) {
        if (e?.learningItemId && itemSet.has(e.learningItemId)) matchItems++;
      }
      out.push({ strategy: 'paged_unfiltered_local_filter', fetched: all.length, matchedByLearningItemId: matchItems });
    } catch (e) {
      out.push({ strategy: 'paged_unfiltered_local_filter', error: e?.message || String(e) });
    }

    // Strategy E: via course enrollments
    if (courseId) {
      try {
        const r = await this.listEnrollmentsViaCourseEnrollments({ courseId, userIds, learningItemIds });
        out.push({
          strategy: 'via_course_enrollments',
          courseEnrollments: r.courseEnrollmentsCount,
          matchedLearningItemEnrollments: r.mapped.length,
          usedCourseIdFilter: r.usedCourseIdFilter,
          sampleLearningItemIds: r.sampleLearningItemIds?.slice(0, 20),
        });
      } catch (e) {
        out.push({ strategy: 'via_course_enrollments', error: e?.message || String(e) });
      }
    }

    return out;
  }

  async listEnrollmentsBestEffort({ learningItemIds, userIds, courseId }) {
    // Best strategy: use course enrollments when we know courseId (matches UI model).
    if (courseId) {
      try {
        const viaCourse = await this.listEnrollmentsViaCourseEnrollments({ courseId, userIds, learningItemIds });
        if (viaCourse.mapped.length) {
          return { enrollments: viaCourse.mapped, strategy: 'via_course_enrollments', meta: viaCourse };
        }
      } catch {
        // ignore and fall back
      }
    }

    // Next best: fetch enrollments unfiltered and filter locally using course enrollments -> userId mapping
    if (courseId) {
      try {
        const { enrollments: courseEnrollments } = await this.listCourseEnrollmentsBestEffort({
          courseId,
          userIds,
          itemsPerPage: 500,
          maxPages: 10,
        });
        const ceIdToUserId = new Map(courseEnrollments.filter((ce) => ce?.id && ce?.userId).map((ce) => [ce.id, ce.userId]));
        const ceIdSet = new Set(ceIdToUserId.keys());
        const itemSet = new Set((learningItemIds || []).filter(Boolean));

        const all = await this.listLearningItemEnrollmentsAll({ itemsPerPage: 200, maxPages: 10 });
        const mapped = [];
        for (const e of all) {
          if (!e?.id || !e?.learningItemId || !itemSet.has(e.learningItemId)) continue;
          const ceId = this._extractIdFromIri(e.courseEnrollment);
          if (!ceId || !ceIdSet.has(ceId)) continue;
          mapped.push({ userId: ceIdToUserId.get(ceId), learningItemId: e.learningItemId, learningItemEnrollmentId: e.id });
        }
        if (mapped.length) {
          return { enrollments: mapped, strategy: 'paged_unfiltered_local_filter', meta: { fetched: all.length, mapped: mapped.length } };
        }
      } catch {
        // ignore and fall back
      }
    }

    // Prefer bulk filters, but fall back to per-learning-item if bulk returns nothing.
    const bulk = await this.listLearningItemEnrollments({ learningItemIds, userIds, itemsPerPage: 500 });
    if (bulk.length) return { enrollments: bulk, strategy: 'bulk_filters' };

    const combined = [];
    for (const id of learningItemIds || []) {
      const items = await this.listLearningItemEnrollmentsForSingleItem({ learningItemId: id, itemsPerPage: 500 });
      combined.push(...items);
    }
    return { enrollments: combined, strategy: 'per_learning_item' };
  }

  async waitForEnrollments({ learningItemIds, userIds, courseId, timeoutMs = 60_000, pollMs = 2_000 }) {
    const start = Date.now();
    let last = [];
    let didEnrollKickoff = false;
    while (Date.now() - start < timeoutMs) {
      try {
        last = (await this.listEnrollmentsBestEffort({ learningItemIds, userIds, courseId })).enrollments;
      } catch {
        // ignore transient errors while waiting
      }

      if (last.length) break;

      // If we have a course but no enrollments, it's often because users have invitations but
      // Ethos hasn't created LearningItemEnrollment records yet. Kick off enrollment creation once.
      if (!didEnrollKickoff && courseId) {
        didEnrollKickoff = true;
        try {
          await this.enrollInvitationsBestEffort({ courseId, userIds });
        } catch {
          // ignore; we still keep polling
        }
      }
      await sleep(pollMs);
    }
    return last;
  }

  async enrollInvitationsBestEffort({ courseId, userIds }) {
    const { enrollments: courseEnrollments } = await this.listCourseEnrollmentsBestEffort({
      courseId,
      userIds,
      itemsPerPage: 500,
      maxPages: 25,
    });

    const jobs = [];
    for (const ce of courseEnrollments) {
      const uid = ce?.userId;
      const invs = Array.isArray(ce?.invitations) ? ce.invitations : [];
      if (!uid || !invs.length) continue;
      for (const inv of invs) {
        const invitationId = this._extractIdFromRef(inv);
        if (!invitationId) continue;
        jobs.push({ invitationId, enrollUserId: uid });
      }
    }

    // Dedup (same invitation can appear more than once depending on representation)
    const seen = new Set();
    const unique = [];
    for (const j of jobs) {
      const key = `${j.invitationId}:${j.enrollUserId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(j);
    }

    await this._mapWithConcurrency(unique, 10, async ({ invitationId, enrollUserId }) => {
      try {
        // This endpoint creates courseEnrollment, learningItemEnrollment, and cardEnrollment records.
        // It supports enrolling on behalf of a user via enrollUserId.
        await this.client.post(`/v1/invitations/${invitationId}/enroll`, { enrollUserId, autoEnrollId: null });
      } catch {
        // ignore (already enrolled / forbidden / etc)
      }
    });

    return { attempted: unique.length };
  }

  async getCardEnrollment({ cardEnrollmentId }) {
    const id = this._normalizeUuidFromAnything(cardEnrollmentId);
    if (!id) return null;
    const e = await this.client.get(`/v1/card_enrollments/${id}`);
    return this._normalizeCardEnrollment(e);
  }

  async getCardEnrollments({ learningItemEnrollmentId }) {
    const data = await this.client.get(`/v1/learning_item_enrollments/${learningItemEnrollmentId}/card_enrollments`);
    const refs = hydraMembers(data).map((e) => this._normalizeCardEnrollment(e));

    // In some tenants, this list is just refs (@id) without cardId/answer fields.
    // Hydrate anything missing cardId so we can answer/grade quizzes reliably.
    const hydrated = await this._mapWithConcurrency(refs, 10, async (ce) => {
      if (ce?.id && !ce?.cardId) {
        try {
          return await this.getCardEnrollment({ cardEnrollmentId: ce.id });
        } catch {
          return ce;
        }
      }
      return ce;
    });

    return hydrated.filter(Boolean).map((e) => this._normalizeCardEnrollment(e));
  }

  async getCard({ cardId }) {
    const id = this._normalizeUuidFromAnything(cardId);
    return await this.client.get(`/v1/cards/${id}`);
  }

  async answerQuizByTargetPercent({ learningItemEnrollmentId, userId, targetPercentCorrect, debug = false }) {
    const enrollmentId = learningItemEnrollmentId;
    if (!enrollmentId) {
      return { ok: false, error: 'No learning item enrollment found', learningItemEnrollmentId, userId };
    }
    // Card enrollments may be created asynchronously; do a short wait/poll to avoid false empties.
    let cardEnrollments = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      cardEnrollments = await this.getCardEnrollments({ learningItemEnrollmentId: enrollmentId });
      if (cardEnrollments.length) break;
      await sleep(500);
    }

    // IMPORTANT:
    // Quizzes include non-question cards (title/body/etc). Those can have card enrollments but won't score.
    // We must answer only question cards (multipleChoice/trueFalse).
    const eligible = cardEnrollments.filter((ce) => ce?.id && ce?.cardId);
    const questionEntries = [];
    await this._mapWithConcurrency(eligible, 10, async (ce) => {
      try {
        const card = await this.getCard({ cardId: ce.cardId });
        if (!isQuestionCard(card)) return null;
        questionEntries.push({ ce, card });
      } catch {
        // ignore
      }
      return null;
    });

    const total = questionEntries.length || 0;
    if (!total) {
      const nonQuestionCount = eligible.length;
      return {
        ok: false,
        error: 'No question card enrollments found (only non-question cards present)',
        learningItemEnrollmentId: enrollmentId,
        meta: { cardEnrollments: cardEnrollments.length, eligible: eligible.length, questionCards: 0, nonQuestionCount },
      };
    }

    const desiredCorrect = clamp(Math.round((targetPercentCorrect / 100) * total), 0, total);
    const stats = { totalQuestions: total, desiredCorrect, answered: 0, correctTargeted: 0, optionNotFound: 0 };
    const debugSamples = [];

    // Answer first N as correct, rest incorrect (simple but deterministic)
    for (let i = 0; i < questionEntries.length; i++) {
      const { ce, card } = questionEntries[i];
      const chooseCorrect = i < desiredCorrect;
      const optionId = pickOptionIdFromCard(card, { correct: chooseCorrect });
      if (!optionId) {
        stats.optionNotFound++;
        continue;
      }

      const now = new Date().toISOString();
      await this.client.patch(
        `/v1/card_enrollments/${ce.id}`,
        {
          answer: [optionId],
          // Confidence appears to be nullable; provide a reasonable value (optional).
          confidence: 100,
          startedAt: ce.startedAt || now,
          completedAt: now,
          elapsedSec: 10 + Math.floor(Math.random() * 50),
          progress: 100,
        },
        { headers: { 'Content-Type': 'application/merge-patch+json' } },
      );
      stats.answered++;
      if (chooseCorrect) stats.correctTargeted++;

      // Some tenants only grade after an explicit completion/submit action.
      // Best-effort: if the endpoint exists, call it; otherwise ignore errors.
      try {
        await this.client.post(`/v1/card_enrollments/${ce.id}/complete`, {});
      } catch {
        // ignore
      }

      if (debug && debugSamples.length < 3) {
        try {
          const after = await this.getCardEnrollment({ cardEnrollmentId: ce.id });
          debugSamples.push({
            cardEnrollmentId: ce.id,
            cardId: ce.cardId,
            type: after?.type || null,
            answer: after?.answer ?? null,
            score: after?.score ?? null,
            percentCorrect: after?.percentCorrect ?? null,
            gradedAt: after?.gradedAt ?? null,
          });
        } catch {
          // ignore
        }
      }
    }

    // Mark complete
    await this.client.post(`/v1/learning_item_enrollments/${enrollmentId}/complete`, {});

    // Grading/score can lag behind completion; poll briefly for non-zero/non-null score fields.
    let finalEnrollment = await this.getLearningItemEnrollment({ learningItemEnrollmentId: enrollmentId });
    for (let attempt = 0; attempt < 10; attempt++) {
      const score = finalEnrollment?.score ?? null;
      const pct = finalEnrollment?.percentCorrect ?? null;
      if ((typeof score === 'number' && score > 0) || (typeof pct === 'number' && pct > 0)) break;
      await sleep(500);
      finalEnrollment = await this.getLearningItemEnrollment({ learningItemEnrollmentId: enrollmentId });
    }

    return {
      ok: true,
      learningItemEnrollmentId: enrollmentId,
      finalEnrollment,
      meta: stats,
      debugSamples: debug ? debugSamples : undefined,
    };
  }

  async completeLesson({ learningItemEnrollmentId, userId }) {
    const enrollmentId = learningItemEnrollmentId;
    if (!enrollmentId) {
      return { ok: false, error: 'No learning item enrollment found', learningItemEnrollmentId, userId };
    }
    await this.client.post(`/v1/learning_item_enrollments/${enrollmentId}/complete`, {});
    const finalEnrollment = await this.client.get(`/v1/learning_item_enrollments/${enrollmentId}`);
    return { ok: true, learningItemEnrollmentId: enrollmentId, finalEnrollment };
  }
}


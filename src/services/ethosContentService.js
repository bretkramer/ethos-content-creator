import { EthosClient } from './ethosClient.js';

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function richTextTitle(text) {
  return [{ type: 'title', children: [{ text: String(text || '') }] }];
}

function richTextParagraph(text) {
  return [{ type: 'paragraph', children: [{ text: String(text || '') }] }];
}

function lessonCardJson({ title, body }) {
  return {
    version: '1',
    templateType: null,
    description: '',
    contentBlocks: [
      {
        id: uuidv4(),
        type: 'title',
        json: richTextTitle(title),
      },
      {
        id: uuidv4(),
        type: 'body',
        json: richTextParagraph(body),
      },
    ],
  };
}

function multipleChoiceJson({ question, options, correctIndex }) {
  return {
    version: '1',
    templateType: 'multipleChoice',
    description: '',
    contentBlocks: [
      {
        id: uuidv4(),
        type: 'multipleChoice',
        multipleChoiceType: 'selectone',
        randomize: false,
        question: richTextTitle(question),
        options: options.map((opt, idx) => ({
          id: uuidv4(),
          isCorrect: idx === correctIndex,
          optionText: richTextParagraph(opt),
        })),
        correctFeedback: {
          header: richTextParagraph("That's correct!"),
          body: richTextParagraph('Nice work.'),
        },
        incorrectFeedback: {
          header: richTextParagraph('Not quite'),
          body: richTextParagraph('Review the lesson content and try again.'),
        },
      },
    ],
  };
}

export class EthosContentService {
  constructor({ credentials }) {
    this.credentials = credentials;
    this.client = new EthosClient(credentials);
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  _uniqStrings(list) {
    const out = [];
    const seen = new Set();
    for (const v of list || []) {
      const s = String(v || '').trim();
      if (!s) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  async ensureUserHasLearnerRole({ userId }) {
    if (!userId) return { ok: false, skipped: true, reason: 'missing_user_id' };

    // Many tenants require the user to have the Learner role for enrollments to exist/appear.
    // Unfortunately the API doesn't provide a clear enum; tenants validate different strings.
    // So we try a few common representations and keep any existing roles.
    // Bret confirmed this tenant uses: ROLE_LEARNER
    const roleCandidates = ['ROLE_LEARNER', 'AUTHORIZED_ROLE_LEARNER', 'learner', 'Learner'];

    let current = null;
    try {
      current = await this.client.get(`/v1/users/${userId}`);
    } catch {
      current = null;
    }

    const currentRoles = Array.isArray(current?.roles) ? current.roles : [];
    const currentLower = new Set(currentRoles.map((r) => String(r).toLowerCase()));
    if (currentLower.has('role_learner') || currentLower.has('authorized_role_learner') || currentLower.has('learner')) {
      return { ok: true, skipped: true, roles: currentRoles };
    }

    const params = new URLSearchParams();
    params.set('mask', 'roles');

    const tryPatch = async (roles) => {
      return await this.client.patch(
        `/v1/users/${userId}`,
        { roles },
        { params, headers: { 'Content-Type': 'application/merge-patch+json' } },
      );
    };

    let lastErr = null;
    for (const candidate of roleCandidates) {
      const nextRoles = this._uniqStrings([...currentRoles, candidate]);
      try {
        const updated = await tryPatch(nextRoles);
        return { ok: true, skipped: false, roles: updated?.roles || nextRoles, updated };
      } catch (e) {
        lastErr = e;
      }
    }

    return { ok: false, skipped: false, error: lastErr?.message || String(lastErr) };
  }

  async listHydra(path, { params } = {}) {
    const data = await this.client.get(path, { params });
    if (!data) return [];

    // API Platform / Hydra style
    if (Array.isArray(data)) return data;
    if (Array.isArray(data['hydra:member'])) return data['hydra:member'];

    // Ethos v1 list responses (protobuf/gRPC gateway style)
    if (Array.isArray(data.attributes)) return data.attributes;
    if (Array.isArray(data.learningGroups)) return data.learningGroups;
    if (Array.isArray(data.users)) return data.users;
    if (Array.isArray(data.userAttributes)) return data.userAttributes;
    if (Array.isArray(data.learningGroupAttributes)) return data.learningGroupAttributes;

    return [];
  }

  async resolveCourseIri(courseIdOrIri) {
    if (!courseIdOrIri) return null;

    const raw = String(courseIdOrIri).trim();
    if (!raw) return null;

    // Allow full IRI input
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;

    // Allow relative IRI input
    if (raw.startsWith('/')) return `${this.credentials.baseUrl}${raw}`;

    // Otherwise treat as an ID and resolve via GET, preferring the server-provided @id if present.
    const candidates = [`/v1/courses/${raw}`, `/api/courses/${raw}`];
    for (const path of candidates) {
      try {
        const course = await this.client.get(path);
        const iri = course?.['@id'];
        return iri ? `${this.credentials.baseUrl}${iri}` : `${this.credentials.baseUrl}${path}`;
      } catch {
        // try next
      }
    }

    // Fallback to v1 IRI if we can't resolve (Ethos will validate and return a useful error)
    return `${this.credentials.baseUrl}/v1/courses/${raw}`;
  }

  async publishCourse(courseIdOrIri) {
    if (!courseIdOrIri) return null;

    const raw = String(courseIdOrIri).trim();
    if (!raw) return null;

    const extractId = (pathnameOrId) => {
      const s = String(pathnameOrId || '').trim();
      if (!s) return null;

      // Accept raw UUID-ish IDs
      const uuidMatch = s.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
      if (uuidMatch) return uuidMatch[0];

      // Accept paths like /v1/courses/{id} or /api/courses/{id}
      const parts = s.split('/').filter(Boolean);
      return parts.length ? parts[parts.length - 1] : null;
    };

    let courseId = null;
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const url = new URL(raw);
      courseId = extractId(url.pathname);
    } else if (raw.startsWith('/')) {
      courseId = extractId(raw);
    } else {
      courseId = extractId(raw);
    }

    if (!courseId) return null;

    const coursePath = `/v1/courses/${courseId}`;

    // If already published, don't attempt to re-publish (some tenants disallow patching published courses).
    try {
      const current = await this.client.get(coursePath);
      if (String(current?.state || '').toLowerCase() === 'published') {
        return { skipped: true, course: current };
      }
    } catch {
      // If we can't read the course, we'll still attempt patch (caller may have write but not read).
    }

    try {
      const updated = await this.client.patch(
        coursePath,
        { state: 'published' },
        { headers: { 'Content-Type': 'application/merge-patch+json' } },
      );
      return { skipped: false, course: updated };
    } catch (e) {
      // If patch fails with Access Denied, re-check state: it may already be published.
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('access denied')) {
        try {
          const current = await this.client.get(coursePath);
          if (String(current?.state || '').toLowerCase() === 'published') {
            return { skipped: true, course: current };
          }
        } catch {
          // ignore
        }
      }
      throw e;
    }
  }

  async publishLearningItem(learningItemId) {
    if (!learningItemId) return null;
    const path = `/v1/learning_items/${learningItemId}`;

    // If already published, skip.
    try {
      const current = await this.client.get(path);
      if (String(current?.state || '').toLowerCase() === 'published') {
        return { skipped: true, learningItem: current };
      }
    } catch {
      // If we can't read, we'll still attempt patch.
    }

    const updated = await this.client.patch(
      path,
      { state: 'published' },
      { headers: { 'Content-Type': 'application/merge-patch+json' } },
    );
    return { skipped: false, learningItem: updated };
  }

  async createLearningItem({ name, description, type, state = 'draft', sequenceOrder, courseId }) {
    const normalizeDescription = (d) => {
      if (d === null || d === undefined) return undefined;
      const s = String(d).trim();
      if (!s) return undefined;
      if (s.length <= 500) return s;
      return `${s.slice(0, 497)}...`;
    };

    const payload = {
      name,
      type,
      state,
    };
    const desc = normalizeDescription(description);
    if (desc !== undefined) payload.description = desc;
    if (Number.isFinite(sequenceOrder)) payload.sequenceOrder = sequenceOrder;
    const course = await this.resolveCourseIri(courseId);
    if (course) payload.course = course;

    return await this.client.post('/v1/learning_items', payload);
  }

  async createCardsForLearningItem({ learningItemId, cards }) {
    const payload = { cards };
    return await this.client.post(`/v1/learning_items/${learningItemId}/cards`, payload);
  }

  toLessonCards(cards) {
    return cards.map((c, idx) => ({
      sequenceOrder: idx + 1,
      type: 'lesson',
      title: c.title,
      subType: 'common',
      points: 1,
      json: lessonCardJson({ title: c.title, body: c.body }),
    }));
  }

  toQuizCards(questions) {
    return questions.map((q, idx) => ({
      sequenceOrder: idx + 1,
      type: 'knowledge',
      title: `Question ${idx + 1}`,
      subType: 'common',
      json: multipleChoiceJson({
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
      }),
    }));
  }

  async publishDraft({
    draft,
    courseId,
    learningItemState = 'draft',
    reuseExistingUsers = true,
    enableEthosGeneratedGroup = true,
    ethosGeneratedAttributeName = 'EthosGenerated',
    ethosGeneratedGroupName = 'Ethos Generated Learners',
    autoPublishCourse = false,
    autoPublishLearningItems = false,
  }) {
    const created = {
      lessons: [],
      quizzes: [],
      users: [],
      enrollmentAutomation: null,
    };

    const extractUuid = (s) => {
      const m = String(s || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      return m ? m[0] : null;
    };
    created.courseRef = courseId
      ? {
          input: courseId,
          id: extractUuid(courseId),
          iri: courseId.startsWith('http') || courseId.startsWith('/') ? courseId : null,
        }
      : null;

    // Ethos nuance: publishing often requires cards already present.
    // So we create items in draft, add cards, then optionally publish.
    const shouldPublishItems = learningItemState === 'published' || autoPublishLearningItems;

    // Create lessons + cards
    for (let i = 0; i < (draft.lessons || []).length; i++) {
      const lesson = draft.lessons[i];
      const li = await this.createLearningItem({
        name: lesson.name,
        description: lesson.description,
        type: 'lesson',
        state: 'draft',
        sequenceOrder: i + 1,
        courseId,
      });

      const cards = this.toLessonCards(lesson.cards);
      const cardRes = await this.createCardsForLearningItem({ learningItemId: li.id, cards });

      let publishResult = null;
      if (shouldPublishItems) {
        try {
          publishResult = await this.publishLearningItem(li.id);
        } catch (e) {
          publishResult = { ok: false, error: e?.message, details: e?.data };
        }
      }

      created.lessons.push({
        learningItem: publishResult?.learningItem || li,
        cards: cardRes?.cards || [],
        published: publishResult ? publishResult : undefined,
      });
    }

    // Create quizzes + cards
    for (let i = 0; i < (draft.quizzes || []).length; i++) {
      const quiz = draft.quizzes[i];
      const li = await this.createLearningItem({
        name: quiz.name,
        description: quiz.description,
        type: 'quiz',
        state: 'draft',
        sequenceOrder: (draft.lessons?.length || 0) + i + 1,
        courseId,
      });

      const cards = this.toQuizCards(quiz.questions);
      const cardRes = await this.createCardsForLearningItem({ learningItemId: li.id, cards });

      let publishResult = null;
      if (shouldPublishItems) {
        try {
          publishResult = await this.publishLearningItem(li.id);
        } catch (e) {
          publishResult = { ok: false, error: e?.message, details: e?.data };
        }
      }

      created.quizzes.push({
        learningItem: publishResult?.learningItem || li,
        cards: cardRes?.cards || [],
        published: publishResult ? publishResult : undefined,
      });
    }

    // Create users
    for (const user of draft.users || []) {
      if (reuseExistingUsers && user.email) {
        const existing = await this.findUserByEmail(user.email);
        if (existing?.id) {
          created.users.push({ ...existing, _reused: true });
          continue;
        }
      }

      const payload = {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        shouldNotify: Boolean(user.shouldNotify),
      };

      // Default demo users to Learner role so enrollments exist/appear.
      // If draft provides roles, use them; otherwise set to a default learner-ish role.
      const cleaned = Array.isArray(user.roles) ? this._uniqStrings(user.roles) : [];
      payload.roles = cleaned.length ? cleaned : ['ROLE_LEARNER'];
      try {
        const createdUser = await this.client.post('/v1/users', payload);
        created.users.push(createdUser);
      } catch (e) {
        // If the user already exists, reuse them instead of failing the whole publish.
        const msg = String(e?.message || '').toLowerCase();
        if (reuseExistingUsers && user.email && msg.includes('already exists') && msg.includes('email')) {
          const existing = await this.findUserByEmail(user.email);
          if (existing?.id) {
            created.users.push({ ...existing, _reused: true });
            continue;
          }
        }
        throw e;
      }
    }

    // Ensure all created/reused users actually have the Learner role in this tenant.
    // (We do this even if creation omitted/failed roles validation; PATCH retries a few representations.)
    created.userRoleEnsured = [];
    for (const u of created.users) {
      if (!u?.id) continue;
      created.userRoleEnsured.push(await this.ensureUserHasLearnerRole({ userId: u.id }));
    }

    if (enableEthosGeneratedGroup) {
      // 1) Ensure boolean attribute exists
      const { attribute, created: attributeCreated } = await this.ensureBooleanAttribute(ethosGeneratedAttributeName);

      // 2) Ensure learning group exists with rule (attribute == true)
      const { group, created: groupCreated } = await this.ensureLearningGroupForAttribute({
        groupName: ethosGeneratedGroupName,
        attributeId: attribute.id,
        value: 'true',
      });
      // If group existed already, ensure the rule exists too
      const ruleResult = await this.ensureLearningGroupRule({
        learningGroupId: group.id,
        attributeId: attribute.id,
        value: 'true',
      });

      // 3) Set user attribute for all created/reused users
      const userIds = created.users.map((u) => u.id).filter(Boolean);
      const userAttributeResults = [];
      for (const userId of userIds) {
        userAttributeResults.push(
          await this.ensureUserAttribute({
            userId,
            attributeName: ethosGeneratedAttributeName,
            attributeId: attribute.id,
            value: 'true',
          }),
        );
      }

      // 4) Associate the learning group to the learning items we created (represents "assigning course content to the group")
      const learningItemIds = [
        ...created.lessons.map((x) => x?.learningItem?.id).filter(Boolean),
        ...created.quizzes.map((x) => x?.learningItem?.id).filter(Boolean),
      ];
      const association =
        learningItemIds.length > 0
          ? await this.bulkAssociateLearningGroupToLearningItems({ learningItemIds, learningGroupId: group.id })
          : null;

      created.enrollmentAutomation = {
        attribute: { id: attribute.id, name: attribute.name, created: attributeCreated },
        learningGroup: { id: group.id, name: group.name, created: groupCreated },
        learningGroupRule: { created: ruleResult.created },
        userAttributes: {
          usersTagged: userAttributeResults.length,
          created: userAttributeResults.filter((r) => r.created).length,
          updated: userAttributeResults.filter((r) => r.updated).length,
        },
        learningItemGroupAssociation: association,
      };
    }

    if (autoPublishCourse && courseId) {
      try {
        const result = await this.publishCourse(courseId);
        const course = result?.course || null;
        created.coursePublished = {
          ok: true,
          skipped: Boolean(result?.skipped),
          id: course?.id,
          state: course?.state,
          title: course?.title,
        };
      } catch (e) {
        // Do not fail the whole publish if the caller lacks permission to publish courses.
        created.coursePublished = {
          ok: false,
          error: e?.message || 'Failed to publish course',
          details: e?.data,
          request: e?.method && e?.url ? { method: e.method, url: e.url } : undefined,
        };
      }
    }

    return created;
  }

  async findUserByEmail(email) {
    const tryMembers = (data) => {
      const members =
        Array.isArray(data) ? data : data?.['hydra:member'] || data?.users || data?.results || data?.items || [];
      const exact = members.find((u) => (u.email || u.emailAddress) === email);
      return exact || members[0] || null;
    };

    // Some tenants filter on matchEmail rather than email.
    try {
      return tryMembers(
        await this.client.get('/v1/users', {
          params: { itemsPerPage: 5, matchEmail: email },
        }),
      );
    } catch {
      // ignore
    }

    try {
      return tryMembers(
        await this.client.get('/v1/users', {
          params: { itemsPerPage: 5, email },
        }),
      );
    } catch {
      // ignore
    }

    // Fallback: complex list endpoint
    try {
      const data = await this.client.post('/v1/users/list', {
        page: '1',
        itemsPerPage: '10',
        matchEmail: email,
        email,
      });
      return tryMembers(data);
    } catch {
      return null;
    }
  }

  async findAttributeByName(name) {
    // Some tenants may not filter exactly on `name`, and large orgs may have >200 attributes.
    // Try a filtered fetch first, then fall back to paginated scan.
    try {
      const firstPage = await this.listHydra('/v1/attributes', { params: { itemsPerPage: 200, name } });
      const exact = firstPage.find((a) => a?.name === name);
      if (exact) return exact;
    } catch {
      // ignore and scan
    }

    for (let page = 1; page <= 25; page++) {
      const items = await this.listHydra('/v1/attributes', {
        params: { itemsPerPage: 200, page: String(page) },
      });
      if (!items.length) break;
      const exact = items.find((a) => a?.name === name);
      if (exact) return exact;
    }

    return null;
  }

  async ensureBooleanAttribute(name) {
    const existing = await this.findAttributeByName(name);
    if (existing?.id) return { attribute: existing, created: false };

    try {
      const created = await this.client.post('/v1/attributes', {
        name,
        type: 'BOOLEAN',
        status: 'ACTIVE',
        attributeOptions: [],
      });
      return { attribute: created, created: true };
    } catch (e) {
      // If Ethos tells us it already exists, re-fetch and reuse.
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('attribute') && msg.includes('already exists')) {
        // Eventual consistency: retry lookup a couple times.
        for (let i = 0; i < 3; i++) {
          const found = await this.findAttributeByName(name);
          if (found?.id) return { attribute: found, created: false };
          await this.sleep(500);
        }
      }
      throw e;
    }
  }

  async findLearningGroupByName(name) {
    try {
      const groups = await this.listHydra('/v1/learning_groups', { params: { itemsPerPage: 200, name } });
      const exact = groups.find((g) => g?.name === name);
      if (exact) return exact;
    } catch {
      // ignore and scan
    }

    for (let page = 1; page <= 25; page++) {
      const items = await this.listHydra('/v1/learning_groups', {
        params: { itemsPerPage: 200, page: String(page) },
      });
      if (!items.length) break;
      const exact = items.find((g) => g?.name === name);
      if (exact) return exact;
    }

    return null;
  }

  async ensureLearningGroupForAttribute({ groupName, attributeId, value = 'true' }) {
    const existing = await this.findLearningGroupByName(groupName);
    if (existing?.id) return { group: existing, created: false };

    try {
      const created = await this.client.post('/v1/learning_groups', {
        name: groupName,
        attributes: [
          {
            attributeId,
            filterOperator: 'EQ',
            value,
          },
        ],
      });
      return { group: created, created: true };
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('learning group') && msg.includes('already exists')) {
        const found = await this.findLearningGroupByName(groupName);
        if (found?.id) return { group: found, created: false };
      }
      throw e;
    }
  }

  async ensureLearningGroupRule({ learningGroupId, attributeId, value = 'true' }) {
    const data = await this.client.get(`/v1/learning_groups/${learningGroupId}`);
    const rules = data?.learningGroupAttributes || [];
    const already = rules.find((r) => r?.attribute?.id === attributeId || r?.attributeId === attributeId);
    if (already?.id) return { learningGroupAttribute: already, created: false };

    const created = await this.client.post('/v1/learning_group_attributes', {
      learningGroupId,
      attributeId,
      filterOperator: 'EQ',
      value,
    });
    return { learningGroupAttribute: created, created: true };
  }

  async ensureUserAttribute({ userId, attributeName, attributeId, value = 'true' }) {
    const existing = await this.listHydra('/v1/user_attributes', {
      params: {
        itemsPerPage: 100,
        filterUserId: userId,
        filterAttributeName: attributeName,
      },
    });
    const ua = existing.find((x) => x?.attribute?.id === attributeId) || existing[0] || null;

    if (ua?.id) {
      if (String(ua.value) === String(value)) return { userAttribute: ua, created: false, updated: false };
      const patched = await this.client.patch(`/v1/user_attributes/${ua.id}`, {
        id: ua.id,
        userId,
        attributeId,
        value,
      });
      return { userAttribute: patched, created: false, updated: true };
    }

    const created = await this.client.post('/v1/user_attributes', {
      userId,
      attributeId,
      value,
    });
    return { userAttribute: created, created: true, updated: false };
  }

  async bulkAssociateLearningGroupToLearningItems({ learningItemIds, learningGroupId }) {
    const learningItemGroups = {};
    for (const id of learningItemIds) {
      learningItemGroups[id] = [learningGroupId];
    }
    return await this.client.post('/v1/learning_item/bulk_associate_learning_groups', { learningItemGroups });
  }
}


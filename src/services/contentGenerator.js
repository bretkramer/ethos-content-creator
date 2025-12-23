function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

function splitParagraphs(text) {
  return String(text)
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => p.length >= 60);
}

function pickSentences(text, max = 30) {
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  const sentences = cleaned.split(/(?<=[.!?])\s+/g).map((s) => s.trim());
  return sentences.filter(Boolean).slice(0, max);
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchWithRetry(url, options = {}, { retries = 3, baseDelayMs = 400 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number(res.headers.get('retry-after') || '');
        const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr || new Error('fetch failed');
}

const WIKI_HEADERS = {
  // Wikipedia strongly prefers a descriptive UA.
  'User-Agent': 'ethos-content-creator-demo/1.0 (demo-purpose)',
  Accept: 'application/json',
};

async function wikiSearch(topic) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srsearch', topic);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  const res = await fetchWithRetry(url, { headers: WIKI_HEADERS });
  if (!res.ok) throw new Error(`Wikipedia search failed (${res.status})`);
  const data = await res.json();
  const first = data?.query?.search?.[0];
  if (!first?.title) throw new Error('Wikipedia search returned no results');
  return first.title;
}

async function wikiSummary(title) {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetchWithRetry(url, { headers: WIKI_HEADERS });
  if (!res.ok) throw new Error(`Wikipedia summary failed (${res.status})`);
  return await res.json();
}

async function wikiExtractPlain(title) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('prop', 'extracts');
  url.searchParams.set('explaintext', '1');
  url.searchParams.set('exsectionformat', 'plain');
  url.searchParams.set('titles', title);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  const res = await fetchWithRetry(url, { headers: WIKI_HEADERS });
  if (!res.ok) throw new Error(`Wikipedia extract failed (${res.status})`);
  const data = await res.json();
  const pages = data?.query?.pages || {};
  const page = Object.values(pages)[0];
  const extract = page?.extract;
  if (!extract) throw new Error('Wikipedia extract returned empty content');
  return extract;
}

function generateLessonCards({ title, summary, extractText, minCards = 5 }) {
  const paragraphs = splitParagraphs(extractText);
  const cards = [];

  // Card 1: title/overview
  cards.push({
    title,
    body: summary || (paragraphs[0] ? paragraphs[0].slice(0, 600) : `Overview of ${title}.`),
  });

  // Cards 2..N-1: chunk paragraphs
  const remaining = paragraphs.slice(0, 12);
  const chunkSize = Math.max(1, Math.floor(remaining.length / Math.max(1, minCards - 2)));
  for (let i = 0; i < remaining.length; i += chunkSize) {
    const chunk = remaining.slice(i, i + chunkSize).join('\n\n');
    cards.push({
      title: `${title} — Key concepts`,
      body: chunk.slice(0, 1200),
    });
    if (cards.length >= minCards - 1) break;
  }

  // Last card: takeaways
  const sents = pickSentences(extractText, 12);
  const bullets = sents.slice(0, 5).map((s) => `- ${s.replace(/\s+$/, '')}`);
  cards.push({
    title: `${title} — Key takeaways`,
    body: bullets.length ? bullets.join('\n') : `- ${title} has several key concepts.\n- Review the summary and key terms.`,
  });

  while (cards.length < minCards) {
    cards.push({
      title: `${title} — Review`,
      body: summary || `Review the major ideas related to ${title}.`,
    });
  }

  return cards.slice(0, Math.max(minCards, cards.length));
}

function generateQuizQuestions({ title, extractText, minQuestions = 5 }) {
  const sentences = pickSentences(extractText, 60);

  // Try to pick definitional sentences.
  const definitional = sentences
    .map((s) => s.replace(/\[[^\]]*]/g, '').trim())
    .filter((s) => s.length >= 40 && s.length <= 220)
    .filter((s) => /\b(is|are|refers to|defined as)\b/i.test(s));

  const picked = definitional.slice(0, Math.max(minQuestions, 12));

  const facts = [];
  for (const s of picked) {
    const m =
      s.match(/^(.{3,80}?)\s+(is|are|refers to|is defined as|are defined as)\s+(.{8,140}?)[.?!]$/i) ||
      s.match(/^(.{3,80}?)\s+(is|are|refers to|defined as)\s+(.{8,140}?)[.?!]$/i);
    if (!m) continue;
    const subject = m[1].replace(/\s*\([^)]*\)\s*/g, '').trim();
    const predicate = m[3].trim();
    if (subject.length < 3 || predicate.length < 8) continue;
    facts.push({ subject, predicate, sourceSentence: s });
    if (facts.length >= 20) break;
  }

  const predicates = facts.map((f) => f.predicate);

  const questions = [];
  for (const f of facts) {
    const distractors = shuffle(predicates.filter((p) => p !== f.predicate)).slice(0, 3);
    const options = shuffle([f.predicate, ...distractors]);
    const correctIndex = options.indexOf(f.predicate);

    if (options.length < 4 || correctIndex < 0) continue;

    questions.push({
      question: `In the context of ${title}, what best describes "${f.subject}"?`,
      options,
      correctIndex,
      explanation: f.sourceSentence,
      sourceSentence: f.sourceSentence,
    });

    if (questions.length >= minQuestions) break;
  }

  // Fallback: simple recall questions from title/summary
  while (questions.length < minQuestions) {
    const idx = questions.length + 1;
    questions.push({
      question: `Which statement is most accurate about ${title}?`,
      options: shuffle([
        `It relates to ${title} and its key ideas.`,
        `It is unrelated to ${title}.`,
        `It is always the same as any other topic.`,
        `It can never be defined or described.`,
      ]),
      correctIndex: 0,
      explanation: 'Generated fallback question for demo purposes.',
      sourceSentence: null,
    });
  }

  return questions.slice(0, minQuestions);
}

export async function generateDraft({
  topic,
  lessonsCount = 1,
  quizzesCount = 1,
  usersCount = 10,
  userEmailBase = '',
  userEmailDomain = '',
  userEmailStartIndex = 1,
} = {}) {
  const resolvedTitle = await wikiSearch(topic);
  const summary = await wikiSummary(resolvedTitle);
  const extractText = await wikiExtractPlain(resolvedTitle);

  const sourceUrl = summary?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(resolvedTitle)}`;

  const lessons = Array.from({ length: Math.max(0, lessonsCount) }, (_, i) => {
    const name = lessonsCount > 1 ? `${resolvedTitle} — Lesson ${i + 1}` : `${resolvedTitle} — Lesson`;
    const desc = (summary?.extract || `Lesson on ${resolvedTitle}.`).trim();
    return {
      name,
      // Ethos learning item descriptions commonly cap at 500 chars.
      description: desc.length > 500 ? `${desc.slice(0, 497)}...` : desc,
      cards: generateLessonCards({
        title: name,
        summary: summary?.extract,
        extractText,
        minCards: 5,
      }),
      sources: [{ title: resolvedTitle, url: sourceUrl }],
    };
  });

  const quizzes = Array.from({ length: Math.max(0, quizzesCount) }, (_, i) => {
    const name = quizzesCount > 1 ? `${resolvedTitle} — Quiz ${i + 1}` : `${resolvedTitle} — Quiz`;
    return {
      name,
      description: `Quiz on ${resolvedTitle}.`,
      questions: generateQuizQuestions({ title: resolvedTitle, extractText, minQuestions: 5 }),
      sources: [{ title: resolvedTitle, url: sourceUrl }],
    };
  });

  const topicSlug = slugify(resolvedTitle) || 'topic';
  const firstNames = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Riley', 'Morgan', 'Avery', 'Jamie', 'Quinn'];
  const lastNames = ['Lee', 'Patel', 'Garcia', 'Nguyen', 'Smith', 'Brown', 'Johnson', 'Williams', 'Martinez', 'Davis'];

  const emailBase = String(userEmailBase || '').trim();
  const emailDomain = String(userEmailDomain || '').trim();
  const startIndex = Number.isFinite(userEmailStartIndex) && userEmailStartIndex > 0 ? userEmailStartIndex : 1;

  const users = Array.from({ length: Math.max(0, usersCount) }, (_, i) => {
    const firstName = firstNames[i % firstNames.length];
    const lastName = lastNames[(i + 3) % lastNames.length];
    const n = startIndex + i;
    const email =
      emailBase && emailDomain
        ? `${emailBase}+user${n}@${emailDomain}`
        : `demo+${topicSlug}-${i + 1}@example.com`;
    return {
      firstName,
      lastName,
      email,
      shouldNotify: false,
      // Bret confirmed this tenant expects ROLE_LEARNER for learner users.
      roles: ['ROLE_LEARNER'],
    };
  });

  return {
    topic,
    resolvedTitle,
    sources: [{ title: resolvedTitle, url: sourceUrl, summary: summary?.extract || '' }],
    lessons,
    quizzes,
    users,
    userEmailTemplate:
      emailBase && emailDomain ? `${emailBase}+user{N}@${emailDomain}` : null,
  };
}

export function simulateOutcomes({
  users,
  lessons,
  quizzes,
  lessonCompletionRate = 0.8,
  quizParticipationRate = 0.7,
  quizScoreMean = 0.78,
  quizScoreStd = 0.12,
}) {
  const randn = () => {
    // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  };

  const perUser = users.map((u) => {
    const lessonResults = lessons.map((l) => ({
      lessonName: l.name,
      completed: Math.random() < lessonCompletionRate,
    }));

    const quizResults = quizzes.map((q) => {
      const took = Math.random() < quizParticipationRate;
      const score01 = took ? clamp01(quizScoreMean + quizScoreStd * randn()) : null;
      return {
        quizName: q.name,
        took,
        percentCorrect: took ? Math.round(score01 * 100) : null,
      };
    });

    return { user: u, lessonResults, quizResults };
  });

  const summary = {
    users: users.length,
    lessons: lessons.length,
    quizzes: quizzes.length,
    lessonCompletionRate,
    quizParticipationRate,
  };

  return { summary, perUser };
}


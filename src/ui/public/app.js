const $ = (id) => document.getElementById(id);

const state = {
  organizations: [],
  draft: null,
  published: null,
};

function pretty(obj) {
  return JSON.stringify(obj, null, 2);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error || data?.message || `Request failed (${res.status})`;
    const details = data?.details ? `\n\nDetails:\n${JSON.stringify(data.details, null, 2)}` : '';
    const reqInfo = data?.request ? `\n\nRequest:\n${JSON.stringify(data.request, null, 2)}` : '';
    throw new Error(`${msg}${reqInfo}${details}`);
  }
  return data;
}

function setOrgs(orgs) {
  state.organizations = orgs;
  const select = $('orgSelect');
  select.innerHTML = '';
  for (const org of orgs) {
    const opt = document.createElement('option');
    opt.value = org.id;
    opt.textContent = `${org.name} (${org.id})`;
    select.appendChild(opt);
  }
}

function setCourses(courses) {
  const select = $('courseSelect');
  select.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '(none)';
  select.appendChild(empty);

  for (const c of courses) {
    const opt = document.createElement('option');
    opt.value = c.iri || c.id || '';
    opt.textContent = `${c.title || '(untitled)'}${c.state ? ` — ${c.state}` : ''} (${c.id || c.iri || 'unknown'})`;
    select.appendChild(opt);
  }
}

async function refreshMe() {
  try {
    const me = await api('/api/auth/me');
    $('authStatus').textContent = pretty(me);

    // Prefill generated-user email defaults from logged-in email (if user hasn't typed anything).
    if (me?.authenticated && me?.email && me.email.includes('@')) {
      const [base, domain] = me.email.split('@');
      if (!$('userEmailBase').value.trim()) $('userEmailBase').value = base;
      if (!$('userEmailDomain').value.trim()) $('userEmailDomain').value = domain;
    }
  } catch (e) {
    $('authStatus').textContent = String(e.message || e);
  }
}

$('loadCourses').addEventListener('click', async () => {
  $('publishOutput').textContent = 'Loading courses...';
  try {
    const data = await api('/api/ethos/courses');
    setCourses(data.courses || []);
    $('publishOutput').textContent = pretty({ ok: true, courses: (data.courses || []).length });
  } catch (e) {
    $('publishOutput').textContent = String(e.message || e);
  }
});

$('courseSelect').addEventListener('change', () => {
  const val = $('courseSelect').value;
  if (val) $('courseId').value = val; // could be IRI or id depending on API response
});

$('loadOrgs').addEventListener('click', async () => {
  $('authStatus').textContent = 'Loading organizations...';
  try {
    const email = $('email').value.trim();
    const data = await api('/api/auth/organizations', { method: 'POST', body: { email } });
    setOrgs(data.organizations || []);
    $('authStatus').textContent = pretty({ ok: true, organizations: (data.organizations || []).length });
  } catch (e) {
    $('authStatus').textContent = String(e.message || e);
  }
});

$('login').addEventListener('click', async () => {
  $('authStatus').textContent = 'Authenticating...';
  try {
    const email = $('email').value.trim();
    const password = $('password').value;
    const organizationId = $('orgSelect').value;
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: { email, password, organizationId },
    });
    $('authStatus').textContent = pretty(data);
    await refreshMe();
  } catch (e) {
    $('authStatus').textContent = String(e.message || e);
  }
});

$('logout').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    $('authStatus').textContent = 'Logged out.';
  } catch (e) {
    $('authStatus').textContent = String(e.message || e);
  }
});

$('generate').addEventListener('click', async () => {
  $('draftOutput').textContent = 'Generating draft (Wikipedia)...';
  try {
    const topic = $('topic').value.trim();
    const lessonsCount = Number($('lessonsCount').value || 0);
    const quizzesCount = Number($('quizzesCount').value || 0);
    const usersCount = Number($('usersCount').value || 0);
    const userEmailBase = $('userEmailBase').value.trim();
    const userEmailDomain = $('userEmailDomain').value.trim();
    const userEmailStartIndex = Number($('userEmailStartIndex').value || 1);
    const body = { topic, lessonsCount, quizzesCount, usersCount, userEmailStartIndex };
    if (userEmailBase) body.userEmailBase = userEmailBase;
    if (userEmailDomain) body.userEmailDomain = userEmailDomain;
    const draft = await api('/api/generate', {
      method: 'POST',
      body,
    });
    state.draft = draft;
    $('draftOutput').textContent = pretty(draft);
  } catch (e) {
    $('draftOutput').textContent = String(e.message || e);
  }
});

$('publish').addEventListener('click', async () => {
  $('publishOutput').textContent = 'Publishing...';
  try {
    if (!state.draft) throw new Error('Generate a draft first.');
    const courseId = $('courseId').value.trim() || null;
    const learningItemState = $('learningItemState').value;
    const autoPublishCourse = $('autoPublishCourse').value === 'true';
    const autoPublishLearningItems = $('autoPublishLearningItems').value === 'true';
    const reuseExistingUsers = $('reuseExistingUsers').value === 'true';
    const enableEthosGeneratedGroup = $('enableEthosGeneratedGroup').value === 'true';
    const ethosGeneratedAttributeName = $('ethosGeneratedAttributeName').value.trim() || 'EthosGenerated';
    const ethosGeneratedGroupName = $('ethosGeneratedGroupName').value.trim() || 'Ethos Generated Learners';
    const created = await api('/api/ethos/publish', {
      method: 'POST',
      body: {
        draft: state.draft,
        courseId,
        learningItemState,
        autoPublishCourse,
        autoPublishLearningItems,
        reuseExistingUsers,
        enableEthosGeneratedGroup,
        ethosGeneratedAttributeName,
        ethosGeneratedGroupName,
      },
    });
    state.published = created;
    $('publishOutput').textContent = pretty(created);
  } catch (e) {
    $('publishOutput').textContent = String(e.message || e);
  }
});

$('simulate').addEventListener('click', async () => {
  $('simulateOutput').textContent = 'Simulating...';
  try {
    if (!state.draft) throw new Error('Generate a draft first.');
    const lessonCompletionRate = Number($('lessonCompletionRate').value);
    const quizParticipationRate = Number($('quizParticipationRate').value);
    const quizScoreMean = Number($('quizScoreMean').value);
    const quizScoreStd = Number($('quizScoreStd').value);
    const results = await api('/api/simulate', {
      method: 'POST',
      body: {
        draft: state.draft,
        lessonCompletionRate,
        quizParticipationRate,
        quizScoreMean,
        quizScoreStd,
      },
    });
    $('simulateOutput').textContent = pretty(results);
  } catch (e) {
    $('simulateOutput').textContent = String(e.message || e);
  }
});

$('simulateEthos').addEventListener('click', async () => {
  const startedAt = Date.now();
  $('simulateOutput').textContent = 'Simulating in Ethos...';
  const ticker = setInterval(() => {
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    $('simulateOutput').textContent = `Simulating in Ethos... (${sec}s elapsed)\n\n(If enrollments do not exist yet, this can take up to ~60s.)`;
  }, 500);
  try {
    if (!state.published) throw new Error('Publish to Ethos first.');
    const lessonCompletionRate = Number($('lessonCompletionRate').value);
    const quizParticipationRate = Number($('quizParticipationRate').value);
    const quizScoreMean = Number($('quizScoreMean').value);
    const quizScoreStd = Number($('quizScoreStd').value);
    const debug = Boolean($('includeDebug')?.checked);
    const results = await api('/api/ethos/simulate', {
      method: 'POST',
      body: {
        published: state.published,
        lessonCompletionRate,
        quizParticipationRate,
        quizScoreMean,
        quizScoreStd,
        debug,
      },
    });
    clearInterval(ticker);
    $('simulateOutput').textContent = pretty(results);
  } catch (e) {
    clearInterval(ticker);
    $('simulateOutput').textContent = String(e.message || e);
  }
});

refreshMe();


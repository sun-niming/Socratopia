// resources/server/.next/server/app/api/practice/practice-route-integration-smoke-test.js
// 黑盒集成测试：通过 HTTP 调用真实 practice/route.js，不复制内部函数。
// 自包含：本地 mock LLM，无真实 API key，无真实用户数据。

const path = require('path');
const fs = require('fs');
const http = require('http');
const workspaceRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', '..');
const { TestEnvironment } = require(path.join(workspaceRoot, 'resources/server/smoke-test-utils'));

const profileId = 'test_profile';
const worldId = 'test_world';
const accountId = 'test';
const companion = {
  slotId: 'npc_a',
  companionInstanceId: 'ci_0123456789abcdef',
  candidateId: 'candidate_math',
  displayName: 'Avery'
};

const OUTPUT_DIR = path.join(workspaceRoot, 'tmp/test-results');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const stdoutFile = path.join(OUTPUT_DIR, 'practice-route-integration-smoke-test.stdout');
const stderrFile = path.join(OUTPUT_DIR, 'practice-route-integration-smoke-test.stderr');

let stdout = '';
let stderr = '';
function log(msg) { stdout += msg + '\n'; console.log(msg); }
function err(msg) { stderr += msg + '\n'; console.error(msg); }

// TestEnvironment intentionally leaves ordinary POST requests unsigned so
// auth-contract tests can exercise the fail-closed path. This business-route
// smoke needs the production-equivalent capability fixture instead.
function postWithCapability(env, url, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: env.serverPort,
      path: url,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        Authorization: env.capabilityHeader()
      }, extraHeaders || {})
    }, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: responseBody }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function installPracticeCapability(env) {
  env.post = function (url, body) { return postWithCapability(env, url, body); };
}

function accountWorldDir(env) {
  return path.join(env.tmpDir, 'accounts', accountId, 'profiles', profileId, 'worlds', worldId);
}

function seedCompanionWorld(env) {
  const worldDir = accountWorldDir(env);
  const textbookDir = path.join(worldDir, 'textbooks', 'math');
  const diaryDir = path.join(worldDir, 'diary');
  fs.mkdirSync(textbookDir, { recursive: true });
  fs.mkdirSync(diaryDir, { recursive: true });
  fs.writeFileSync(path.join(worldDir, 'world_meta.json'), JSON.stringify({
    worldId,
    language: 'chinese',
    companions: [{
      candidateId: companion.candidateId,
      name: companion.displayName,
      companionInstanceId: companion.companionInstanceId
    }, null, null, null]
  }, null, 2));
  fs.writeFileSync(path.join(worldDir, 'npc_a.md'), 'PERSONA_TOKEN: patient algebra companion');
  fs.writeFileSync(path.join(worldDir, 'relation_npc_a.md'), 'RELATION_TOKEN: Avery knows the learner benefits from checking units.');
  fs.writeFileSync(path.join(worldDir, 'learner_profile.md'), 'LEARNER_TOKEN: prefers short Socratic hints.');
  fs.writeFileSync(path.join(worldDir, 'pal_moments.md'), [
    '## 2026-08-31 | Avery',
    'PERSONAL_TOKEN: we used a number line together.',
    '<!-- continuityEvent:practice-personal companion:' + companion.companionInstanceId + ' mode:classroom -->',
    '',
    '## 2026-08-30 | Other',
    'SHARED_TOKEN: another companion celebrated a careful proof.',
    '<!-- continuityEvent:practice-shared companion:ci_fedcba9876543210 mode:classroom -->'
  ].join('\n'));

  const normalFiles = {
    progress: path.join(textbookDir, 'progress.md'),
    diary: path.join(diaryDir, '2026-08.md'),
    relation: path.join(worldDir, 'relation_npc_a.md'),
    story: path.join(worldDir, 'story.md')
  };
  fs.writeFileSync(normalFiles.progress, 'NORMAL_PROGRESS_SENTINEL');
  fs.writeFileSync(normalFiles.diary, 'NORMAL_DIARY_SENTINEL');
  fs.writeFileSync(normalFiles.story, 'NORMAL_STORY_SENTINEL');
  return { worldDir, normalFiles };
}

function responseErrorCode(response) {
  try {
    const payload = JSON.parse(response.body || response.raw || '{}');
    if (typeof payload.error === 'string') return payload.error;
    if (payload.error && typeof payload.error.code === 'string') return payload.error.code;
    return payload.code || null;
  } catch (_) {
    return null;
  }
}

function parseSseEvents(raw) {
  return String(raw || '').split(/\r?\n\r?\n/).map((block) => {
    const line = block.split(/\r?\n/).find((entry) => entry.startsWith('data:'));
    if (!line) return null;
    try { return JSON.parse(line.slice(5).trim()); } catch (_) { return null; }
  }).filter(Boolean);
}

async function runTests() {
  const env = new TestEnvironment();
  let passed = true;
  let choicePsId = null;
  let choicePbId = null;
  let subjPsId = null;
  let subjPbId = null;
  try {
    await env.setup();
    installPracticeCapability(env);
    const continuity = seedCompanionWorld(env);
    log('[INFO] Server started on port ' + env.serverPort);
    log('[INFO] Mock LLM on port ' + env.mockLLM.port);

    // --- generate (choice) ---
    env.mockLLM.setResponse({
      choices: [{
        message: {
          content: JSON.stringify({
            problems: [{
              type: 'choice',
              question: '1+1=?',
              choices: ['1', '2', '3'],
              correctAnswer: '2',
              correctIndex: 1,
              solution: '1+1=2',
              knowledgePoints: ['math'],
              difficulty: 1,
              commonMistakes: []
            }]
          })
        }
      }]
    });
    env.mockLLM.resetRequests();
    const genRes = await env.post('/api/practice', {
      action: 'generate',
      profileId, worldId,
      sourceText: 'Basic math: 1+1=2',
      composition: [{ type: 'choice', count: 1 }]
    });
    const genReq = env.mockLLM.requests[0];
    log(`[generate] status=${genRes.status}, model=${genReq?.model || 'N/A'}`);
    if (genReq?.model) log(`[generate] requested model: ${genReq.model}`);
    if (genReq?.response_format) log(`[generate] response_format: ${JSON.stringify(genReq.response_format)}`);

    if (genRes.status === 200) {
      try {
        const genBody = JSON.parse(genRes.body);
        choicePsId = genBody.problemSet?.id;
        const firstProblem = genBody.problemSet?.problems?.[0];
        choicePbId = firstProblem?.id;
        log(`[generate] choice problemSetId=${choicePsId}, problemId=${choicePbId}`);
        log('PASS [generate]');
      } catch (e) {
        err('FAIL [generate]: could not parse response body: ' + e.message);
        passed = false;
      }
    } else {
      err(`FAIL [generate]: expected 200, got ${genRes.status}`);
      err(`  body: ${genRes.body.slice(0, 500)}`);
      passed = false;
    }

    if (!choicePsId || !choicePbId) {
      err('BLOCKED: generate did not return choice problemSetId/problemId, skipping dependent tests');
    }

    // --- generate (short-answer) ---
    env.mockLLM.setResponse({
      choices: [{
        message: {
          content: JSON.stringify({
            problems: [{
              type: 'short-answer',
              question: 'Explain why 1+1=2.',
              correctAnswer: 'By Peano axioms, S(1) = 2.',
              knowledgePoints: ['math'],
              difficulty: 1,
              commonMistakes: []
            }]
          })
        }
      }]
    });
    env.mockLLM.resetRequests();
    const genSubjRes = await env.post('/api/practice', {
      action: 'generate',
      profileId, worldId,
      sourceText: 'Basic math: addition',
      composition: [{ type: 'short-answer', count: 1 }]
    });
    const genSubjReq = env.mockLLM.requests[0];
    log(`[generate-subjective] status=${genSubjRes.status}, model=${genSubjReq?.model || 'N/A'}`);

    if (genSubjRes.status === 200) {
      try {
        const genBody = JSON.parse(genSubjRes.body);
        subjPsId = genBody.problemSet?.id;
        const firstProblem = genBody.problemSet?.problems?.[0];
        subjPbId = firstProblem?.id;
        log(`[generate-subjective] subjective problemSetId=${subjPsId}, problemId=${subjPbId}`);
        log('PASS [generate-subjective]');
      } catch (e) {
        err('FAIL [generate-subjective]: could not parse response body: ' + e.message);
        passed = false;
      }
    } else {
      err(`FAIL [generate-subjective]: expected 200, got ${genSubjRes.status}`);
      err(`  body: ${genSubjRes.body.slice(0, 500)}`);
      passed = false;
    }

    if (!subjPsId || !subjPbId) {
      err('BLOCKED: generate did not return subjective problemSetId/problemId, skipping subjective-grade');
    }

    // --- async source resolution: mixed and textbook fallback keep all conversations ---
    const conceptDir = path.join(continuity.worldDir, 'concept-summaries');
    fs.mkdirSync(conceptDir, { recursive: true });
    fs.writeFileSync(path.join(conceptDir, 'conv_a.json'), JSON.stringify({ sections: [{ content: 'Conversation alpha recursion evidence.' }] }));
    fs.writeFileSync(path.join(conceptDir, 'conv_b.json'), JSON.stringify({ sections: [{ content: 'Conversation beta pointer evidence.' }] }));
    const multiSourceResponse = {
      choices: [{ message: { content: JSON.stringify({ problems: [{ type: 'choice', question: 'Combined source?', choices: ['A', 'B'], correctAnswer: 'A', correctIndex: 0, solution: 'A', knowledgePoints: ['combined'], difficulty: 1, commonMistakes: [] }] }) } }]
    };

    env.mockLLM.setResponse(multiSourceResponse);
    env.mockLLM.resetRequests();
    const mixedRes = await env.post('/api/practice', {
      action: 'generate', profileId, worldId, sourceType: 'mixed', textbookId: 'missing_book',
      conversationIds: ['conv_a', 'conv_b'], composition: [{ type: 'choice', count: 1 }]
    });
    const mixedPrompt = JSON.stringify(env.mockLLM.requests[0]?.messages || []);
    if (mixedRes.status !== 200 || !mixedPrompt.includes('Conversation alpha') || !mixedPrompt.includes('Conversation beta')) {
      err('FAIL [mixed-multi-conversation]: both conversationIds must reach the LLM prompt');
      passed = false;
    } else log('PASS [mixed-multi-conversation]');

    env.mockLLM.setResponse(multiSourceResponse);
    env.mockLLM.resetRequests();
    const fallbackRes = await env.post('/api/practice', {
      action: 'generate', profileId, worldId, sourceType: 'textbook-page', textbookId: 'missing_book', page: 1,
      conversationIds: ['conv_a', 'conv_b'], composition: [{ type: 'choice', count: 1 }]
    });
    const fallbackPrompt = JSON.stringify(env.mockLLM.requests[0]?.messages || []);
    if (fallbackRes.status !== 200 || !fallbackPrompt.includes('Conversation alpha') || !fallbackPrompt.includes('Conversation beta')) {
      err('FAIL [textbook-conversation-fallback]: all conversationIds must survive textbook fallback');
      passed = false;
    } else log('PASS [textbook-conversation-fallback]');

    // --- grade (choice) ---
    if (choicePsId && choicePbId) {
      env.mockLLM.setResponse({
        choices: [{
          message: {
            content: JSON.stringify({ correct: true, score: 1, feedback: 'Correct!' })
          }
        }]
      });
      env.mockLLM.resetRequests();
      const gradeRes = await env.post('/api/practice', {
        action: 'grade',
        profileId, worldId,
        problemSetId: choicePsId,
        problemId: choicePbId,
        userAnswer: '2',
        correctAnswer: '2',
        solution: '1+1=2'
      });
      log(`[choice-grade] status=${gradeRes.status}, mockRequests=${env.mockLLM.requests.length}`);
      if (env.mockLLM.requests.length !== 0) {
        err(`FAIL [choice-grade]: expected 0 mock LLM requests for choice grading, got ${env.mockLLM.requests.length}`);
        passed = false;
      }
      if (gradeRes.status === 200) {
        log('PASS [choice-grade]');
      } else {
        err(`FAIL [choice-grade]: expected 200, got ${gradeRes.status}`);
        err(`  body: ${gradeRes.body.slice(0, 500)}`);
        passed = false;
      }
    }

    // --- grade (subjective) ---
    if (subjPsId && subjPbId) {
      env.mockLLM.setResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              correct: true,
              score: 0.95,
              feedback: 'Good explanation, but could be more rigorous.',
              missingPoints: ['mathematical induction']
            })
          }
        }]
      });
      env.mockLLM.resetRequests();
      const gradeRes = await env.post('/api/practice', {
        action: 'grade',
        profileId, worldId,
        problemSetId: subjPsId,
        problemId: subjPbId,
        userAnswer: 'Because one apple plus one apple equals two apples.',
        correctAnswer: 'Peano arithmetic defines 1+1=2 via successor function.',
        solution: 'By Peano axioms, S(1) = 2.'
      });
      log(`[subjective-grade] status=${gradeRes.status}, mockRequests=${env.mockLLM.requests.length}`);
      if (env.mockLLM.requests.length !== 1) {
        err(`FAIL [subjective-grade]: expected exactly 1 mock LLM request for subjective grading, got ${env.mockLLM.requests.length}`);
        passed = false;
      }
      if (gradeRes.status === 200) {
        try {
          const gradeBody = JSON.parse(gradeRes.body);
          const grading = gradeBody.grading;
          if (!grading) {
            err('FAIL [subjective-grade]: missing grading object');
            passed = false;
          } else {
            if (typeof grading.correct !== 'boolean') {
              err('FAIL [subjective-grade]: grading.correct missing or not boolean');
              passed = false;
            }
            if (typeof grading.score !== 'number') {
              err('FAIL [subjective-grade]: grading.score missing or not number');
              passed = false;
            }
            if (typeof grading.feedback !== 'string') {
              err('FAIL [subjective-grade]: grading.feedback missing or not string');
              passed = false;
            }
            if (!Array.isArray(grading.missingPoints)) {
              err('FAIL [subjective-grade]: grading.missingPoints missing or not array');
              passed = false;
            }
            log(`[subjective-grade] correct=${grading.correct}, score=${grading.score}, feedback=${grading.feedback?.slice(0, 40)}, missingPoints=${JSON.stringify(grading.missingPoints)}`);
            log('PASS [subjective-grade]');
          }
        } catch (e) {
          err('FAIL [subjective-grade]: could not parse response body: ' + e.message);
          passed = false;
        }
      } else {
        err(`FAIL [subjective-grade]: expected 200, got ${gradeRes.status}`);
        err(`  body: ${gradeRes.body.slice(0, 500)}`);
        passed = false;
      }
    }

    // --- hint ---
    if (choicePsId && choicePbId) {
      env.mockLLM.setResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              hint: 'Think about it',
              focusKnowledgePoint: 'addition',
              guidingQuestion: 'What is 1+1?'
            })
          }
        }]
      });
      env.mockLLM.resetRequests();
      const hintRes = await env.post('/api/practice', {
        action: 'hint',
        profileId, worldId,
        problemSetId: choicePsId,
        problemId: choicePbId,
        solution: '1+1=2'
      });
      const hintReq = env.mockLLM.requests[0];
      log(`[hint] status=${hintRes.status}, model=${hintReq?.model || 'N/A'}`);
      if (hintReq?.model) log(`[hint] requested model: ${hintReq.model}`);
      if (hintRes.status === 200) {
        log('PASS [hint]');
      } else {
        err(`FAIL [hint]: expected 200, got ${hintRes.status}`);
        err(`  body: ${hintRes.body.slice(0, 500)}`);
        passed = false;
      }
    }

    // --- explain ---
    if (choicePsId && choicePbId) {
      env.mockLLM.setResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              explanation: 'First, identify the numbers. Then, add them together. Finally, verify the result.',
              steps: [
                { description: 'Identify the numbers', detail: '1 and 1' },
                { description: 'Add them', detail: '1 + 1 = 2' },
                { description: 'Verify', detail: '2 is correct' }
              ],
              solution: '1+1=2'
            })
          }
        }]
      });
      env.mockLLM.resetRequests();
      const explRes = await env.post('/api/practice', {
        action: 'explain',
        profileId, worldId,
        problemSetId: choicePsId,
        problemId: choicePbId,
        solution: '1+1=2'
      });
      const explReq = env.mockLLM.requests[0];
      log(`[explain] status=${explRes.status}, model=${explReq?.model || 'N/A'}`);
      if (explReq?.model) log(`[explain] requested model: ${explReq.model}`);
      if (explRes.status === 200) {
        log('PASS [explain]');
      } else {
        err(`FAIL [explain]: expected 200, got ${explRes.status}`);
        err(`  body: ${explRes.body.slice(0, 500)}`);
        passed = false;
      }
    }

    // --- variant ---
    if (choicePsId && choicePbId) {
      env.mockLLM.setResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              problems: [{
                type: 'choice',
                question: '2+2=?',
                choices: ['2', '3', '4'],
                correctAnswer: '4',
                correctIndex: 2,
                solution: '2+2=4',
                knowledgePoints: ['math'],
                difficulty: 1,
                commonMistakes: []
              }]
            })
          }
        }]
      });
      env.mockLLM.resetRequests();
      const varRes = await env.post('/api/practice', {
        action: 'variant',
        profileId, worldId,
        problemSetId: choicePsId,
        problemId: choicePbId,
        sourceText: 'Basic math: 1+1=2',
        composition: [{ type: 'choice', count: 1 }]
      });
      const varReq = env.mockLLM.requests[0];
      log(`[variant] status=${varRes.status}, model=${varReq?.model || 'N/A'}`);
      if (varReq?.model) log(`[variant] requested model: ${varReq.model}`);
      if (varRes.status === 200) {
        log('PASS [variant]');
      } else {
        err(`FAIL [variant]: expected 200, got ${varRes.status}`);
        err(`  body: ${varRes.body.slice(0, 500)}`);
        passed = false;
      }
    }

    // --- tutoring companion continuity ---
    // A legacy candidate/name assertion alone must never select a world
    // companion. Binding is authoritative only with slotId + instanceId.
    const tutorProblemSetId = 'continuity_tutor_ps';
    const legacyBindRes = await env.post('/api/practice', {
      action: 'setTutoringCompanion',
      profileId, worldId, problemSetId: tutorProblemSetId,
      companionId: companion.candidateId,
      companionName: 'UNTRUSTED_CLIENT_NAME'
    });
    if (legacyBindRes.status !== 400 || responseErrorCode(legacyBindRes) !== 'COMPANION_IDENTITY_REQUIRED') {
      err('FAIL [tutor-identity-required]: candidate/name-only companion binding must be rejected explicitly');
      passed = false;
    } else log('PASS [tutor-identity-required]');

    const staleInstanceBindRes = await env.post('/api/practice', {
      action: 'setTutoringCompanion',
      profileId, worldId, problemSetId: tutorProblemSetId,
      slotId: companion.slotId,
      companionInstanceId: 'ci_abcdef0123456789',
      candidateId: companion.candidateId
    });
    if (staleInstanceBindRes.status !== 409 || responseErrorCode(staleInstanceBindRes) !== 'COMPANION_CONTEXT_MISMATCH') {
      err('FAIL [tutor-bind-instance-mismatch]: resolver must reject a stale instance assertion before creating a tutoring binding');
      passed = false;
    } else log('PASS [tutor-bind-instance-mismatch]');

    const candidateMismatchBindRes = await env.post('/api/practice', {
      action: 'setTutoringCompanion',
      profileId, worldId, problemSetId: tutorProblemSetId,
      slotId: companion.slotId,
      companionInstanceId: companion.companionInstanceId,
      candidateId: 'candidate_spoof'
    });
    if (candidateMismatchBindRes.status !== 409 || responseErrorCode(candidateMismatchBindRes) !== 'COMPANION_CONTEXT_MISMATCH') {
      err('FAIL [tutor-bind-candidate-mismatch]: resolver must reject a candidate assertion that disagrees with the current slot');
      passed = false;
    } else log('PASS [tutor-bind-candidate-mismatch]');

    // Practice is a separate artifact mode. A caller cannot label this request
    // as classroom work to gain normal classroom write privileges.
    const wrongModeRes = await env.post('/api/practice', {
      action: 'setTutoringCompanion', mode: 'classroom',
      profileId, worldId, problemSetId: tutorProblemSetId,
      slotId: companion.slotId,
      companionInstanceId: companion.companionInstanceId,
      companionId: 'UNTRUSTED_CLIENT_ID'
    });
    if (wrongModeRes.status !== 403 || responseErrorCode(wrongModeRes) !== 'PRACTICE_MODE_FORBIDDEN') {
      err('FAIL [practice-mode-guard]: classroom mode must be rejected by the practice server guard; status=' + wrongModeRes.status + ', code=' + responseErrorCode(wrongModeRes) + ', body=' + wrongModeRes.body.slice(0, 300));
      passed = false;
    } else log('PASS [practice-mode-guard]');

    const bindRes = await env.post('/api/practice', {
      action: 'setTutoringCompanion',
      profileId, worldId, problemSetId: tutorProblemSetId,
      slotId: companion.slotId,
      companionInstanceId: companion.companionInstanceId,
      candidateId: companion.candidateId,
      companionName: 'UNTRUSTED_CLIENT_NAME'
    });
    let boundSession = null;
    try { boundSession = JSON.parse(bindRes.body).session; } catch (_) {}
    if (bindRes.status !== 200 || !boundSession ||
      boundSession.companionSlotId !== companion.slotId ||
      boundSession.companionInstanceId !== companion.companionInstanceId ||
      boundSession.candidateId !== companion.candidateId ||
      boundSession.companionName !== companion.displayName) {
      err('FAIL [tutor-bind-snapshot]: binding must persist resolver-derived slot/instance/candidate/name, not client display values');
      passed = false;
    } else log('PASS [tutor-bind-snapshot]');

    env.mockLLM.setResponse({ choices: [{ message: { content: 'Tutor response token.' } }] });
    env.mockLLM.resetRequests();
    const tutorRes = await env.postSSE('/api/practice', {
      action: 'tutorExplain',
      profileId, worldId, problemSetId: tutorProblemSetId,
      slotId: companion.slotId,
      companionInstanceId: companion.companionInstanceId,
      candidateId: companion.candidateId,
      companionName: 'UNTRUSTED_CLIENT_NAME',
      message: 'Please help me reason through this.',
      context: { question: 'Why is 1 + 1 = 2?', correctAnswer: '2' }
    }, { Authorization: env.capabilityHeader() });
    const tutorPrompt = String(env.mockLLM.requests[0] && env.mockLLM.requests[0].messages && env.mockLLM.requests[0].messages[0] && env.mockLLM.requests[0].messages[0].content || '');
    const continuityTokens = ['PERSONA_TOKEN', 'RELATION_TOKEN', 'LEARNER_TOKEN', 'PERSONAL_TOKEN', 'SHARED_TOKEN'];
    const missingContinuity = continuityTokens.filter((token) => !tutorPrompt.includes(token));
    if (tutorRes.status !== 200 || missingContinuity.length || !/practice mode|练习模式/i.test(tutorPrompt)) {
      err('FAIL [tutor-prompt-continuity]: resolver persona/relation/learner/personal+shared moments and practice-mode guard must reach the tutor prompt; missing=' + missingContinuity.join(','));
      passed = false;
    } else log('PASS [tutor-prompt-continuity]');
    const tutorEvents = parseSseEvents(tutorRes.raw);
    const tutorDoneIndex = tutorEvents.findIndex((event) => event.type === 'done');
    const tutorDone = tutorDoneIndex >= 0 ? tutorEvents[tutorDoneIndex] : null;
    const tutorSessionFile = path.join(continuity.worldDir, 'practice', 'tutoring_sessions', tutorProblemSetId + '.json');
    const persistedTutor = fs.existsSync(tutorSessionFile) ? JSON.parse(fs.readFileSync(tutorSessionFile, 'utf8')) : null;
    const persistedAssistant = persistedTutor && persistedTutor.messages && persistedTutor.messages.some((message) => message.role === 'assistant' && message.content === 'Tutor response token.');
    if (!tutorDone || tutorDoneIndex !== tutorEvents.length - 1 || tutorDone.persisted !== true || !persistedAssistant) {
      err('FAIL [tutor-persist-before-done]: public done must be final, report persisted=true, and follow an on-disk assistant message');
      passed = false;
    } else log('PASS [tutor-persist-before-done]');

    const normalExpected = {
      progress: 'NORMAL_PROGRESS_SENTINEL',
      diary: 'NORMAL_DIARY_SENTINEL',
      relation: 'RELATION_TOKEN: Avery knows the learner benefits from checking units.',
      story: 'NORMAL_STORY_SENTINEL'
    };
    let normalArtifactsUnchanged = true;
    for (const key of Object.keys(normalExpected)) {
      const actual = fs.readFileSync(continuity.normalFiles[key], 'utf8');
      if (actual !== normalExpected[key]) {
        err('FAIL [practice-no-classroom-write]: tutor changed normal ' + key + ' artifact');
        passed = false;
        normalArtifactsUnchanged = false;
      }
    }
    if (normalArtifactsUnchanged) log('PASS [practice-no-classroom-write]');

    // Old sessions remain readable, but their untrusted candidate/name fields
    // require one explicit authoritative rebind before they can stream again.
    const legacyProblemSetId = 'legacy_tutor_ps';
    const legacyDir = path.join(continuity.worldDir, 'practice', 'tutoring_sessions');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, legacyProblemSetId + '.json'), JSON.stringify({
      problemSetId: legacyProblemSetId,
      companionId: companion.candidateId,
      companionName: 'Old display name',
      messages: []
    }, null, 2));
    env.mockLLM.resetRequests();
    const legacyStreamRes = await env.postSSE('/api/practice', {
      action: 'tutorHint', profileId, worldId, problemSetId: legacyProblemSetId,
      message: 'A legacy session should request rebind.'
    }, { Authorization: env.capabilityHeader() });
    if (legacyStreamRes.status !== 409 || responseErrorCode(legacyStreamRes) !== 'COMPANION_REBIND_REQUIRED' || env.mockLLM.requests.length !== 0) {
      err('FAIL [legacy-tutor-session]: a historical session without a snapshot must require explicit rebind and must not call the LLM');
      passed = false;
    } else log('PASS [legacy-tutor-session]');

    const legacyRebindRes = await env.post('/api/practice', {
      action: 'setTutoringCompanion', profileId, worldId, problemSetId: legacyProblemSetId,
      slotId: companion.slotId,
      companionInstanceId: companion.companionInstanceId,
      candidateId: companion.candidateId
    });
    if (legacyRebindRes.status !== 200) {
      err('FAIL [legacy-tutor-rebind]: an explicit slot/instance rebind must upgrade a historical session');
      passed = false;
    } else log('PASS [legacy-tutor-rebind]');

    // A slot occupant may change after binding. The saved instance snapshot is
    // authoritative, so a later stream must return an explicit conflict rather
    // than speaking as the replacement companion.
    const metaPath = path.join(continuity.worldDir, 'world_meta.json');
    const driftedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    driftedMeta.companions[0].companionInstanceId = 'ci_abcdef0123456789';
    fs.writeFileSync(metaPath, JSON.stringify(driftedMeta, null, 2));
    env.mockLLM.resetRequests();
    const driftRes = await env.postSSE('/api/practice', {
      action: 'tutorHint', profileId, worldId, problemSetId: tutorProblemSetId,
      message: 'This must not stream after occupant drift.'
    }, { Authorization: env.capabilityHeader() });
    if (driftRes.status !== 409 || responseErrorCode(driftRes) !== 'COMPANION_CONTEXT_MISMATCH' || env.mockLLM.requests.length !== 0) {
      err('FAIL [tutor-occupant-drift]: changed slot occupant must return COMPANION_CONTEXT_MISMATCH before LLM streaming');
      passed = false;
    } else log('PASS [tutor-occupant-drift]');

    // --- mock LLM 500 ---
    env.mockLLM.setResponse({ error: 'Internal Server Error' }, 500);
    env.mockLLM.resetRequests();
    const res500 = await env.post('/api/practice', {
      action: 'generate',
      profileId, worldId,
      sourceText: 'test',
      composition: [{ type: 'choice', count: 1 }]
    });
    log(`[mock-llm-500] status=${res500.status}`);
    if (res500.status !== 502 && res500.status !== 500) {
      err(`FAIL [mock-llm-500]: expected 502 or 500, got ${res500.status}`);
      passed = false;
    } else {
      log('PASS [mock-llm-500]');
    }

    // --- 非法 JSON ---
    env.mockLLM.setResponse({
      choices: [{ message: { content: 'not valid json at all' } }]
    });
    env.mockLLM.resetRequests();
    const resBad = await env.post('/api/practice', {
      action: 'generate',
      profileId, worldId,
      sourceText: 'test',
      composition: [{ type: 'choice', count: 1 }]
    });
    log(`[bad-json] status=${resBad.status}`);
    if (resBad.status !== 502) {
      err(`FAIL [bad-json]: expected 502, got ${resBad.status}`);
      passed = false;
    } else {
      log('PASS [bad-json]');
    }

  } catch (e) {
    err('ERROR in normal tests: ' + e.message + '\n' + e.stack);
    passed = false;
  } finally {
    await env.teardown();
  }
  return passed;
}

async function runMissingApiKeyTest() {
  const env = new TestEnvironment({ emptyApiKey: true });
  let passed = true;
  try {
    await env.setup();
    installPracticeCapability(env);
    log('[INFO] Started server with empty apiKey');

    env.mockLLM.resetRequests();
    const res = await env.post('/api/practice', {
      action: 'generate',
      profileId, worldId,
      sourceText: 'test',
      composition: [{ type: 'choice', count: 1 }]
    });
    log(`[missing-apiKey] status=${res.status}, mockRequests=${env.mockLLM.requests.length}`);

    if (res.status !== 400) {
      err(`FAIL [missing-apiKey]: expected 400, got ${res.status}`);
      passed = false;
    }
    if (env.mockLLM.requests.length !== 0) {
      err(`FAIL [missing-apiKey]: expected 0 mock LLM requests, got ${env.mockLLM.requests.length}`);
      passed = false;
    }
    try {
      const body = JSON.parse(res.body);
      if (body.error !== 'no_llm') {
        err(`FAIL [missing-apiKey]: expected error="no_llm", got ${JSON.stringify(body.error)}`);
        passed = false;
      } else {
        log('PASS [missing-apiKey] (status=400, error=no_llm, 0 mock requests)');
      }
    } catch (e) {
      err(`FAIL [missing-apiKey]: expected JSON body with error="no_llm", got: ${res.body.slice(0, 200)}`);
      passed = false;
    }
  } catch (e) {
    err('ERROR in missing-apiKey test: ' + e.message);
    passed = false;
  } finally {
    await env.teardown();
  }
  return passed;
}

async function main() {
  let passed = true;
  try {
    passed = await runTests() && passed;
    passed = await runMissingApiKeyTest() && passed;
  } catch (e) {
    err('FATAL: ' + e.message + '\n' + e.stack);
    passed = false;
  }

  fs.writeFileSync(stdoutFile, stdout);
  fs.writeFileSync(stderrFile, stderr);

  if (!passed) {
    log('EXIT: 1');
    process.exit(1);
  } else {
    log('EXIT: 0');
    process.exit(0);
  }
}

main();

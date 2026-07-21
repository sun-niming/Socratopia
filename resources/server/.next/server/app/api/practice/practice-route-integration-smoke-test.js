// resources/server/.next/server/app/api/practice/practice-route-integration-smoke-test.js
// 黑盒集成测试：通过 HTTP 调用真实 practice/route.js，不复制内部函数。
// 自包含：本地 mock LLM，无真实 API key，无真实用户数据。

const path = require('path');
const fs = require('fs');
const workspaceRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', '..');
const { TestEnvironment } = require(path.join(workspaceRoot, 'resources/server/smoke-test-utils'));

const profileId = 'test_profile';
const worldId = 'test_world';

const OUTPUT_DIR = path.join(workspaceRoot, 'tmp/test-results');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const stdoutFile = path.join(OUTPUT_DIR, 'practice-route-integration-smoke-test.stdout');
const stderrFile = path.join(OUTPUT_DIR, 'practice-route-integration-smoke-test.stderr');

let stdout = '';
let stderr = '';
function log(msg) { stdout += msg + '\n'; console.log(msg); }
function err(msg) { stderr += msg + '\n'; console.error(msg); }

async function runTests() {
  const env = new TestEnvironment();
  let passed = true;
  let choicePsId = null;
  let choicePbId = null;
  let subjPsId = null;
  let subjPbId = null;
  try {
    await env.setup();
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
    const conceptDir = path.join(env.tmpDir, 'profiles', profileId, 'worlds', worldId, 'concept-summaries');
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

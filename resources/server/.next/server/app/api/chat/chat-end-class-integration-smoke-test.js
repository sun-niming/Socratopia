// resources/server/.next/server/app/api/chat/chat-end-class-integration-smoke-test.js
// 黑盒集成测试：通过 HTTP 调用真实 chat/route.js 的 end-class 路径，不复制内部函数。
// 自包含：本地 mock LLM，无真实 API key，无真实用户数据。

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const workspaceRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', '..');
const { TestEnvironment } = require(path.join(workspaceRoot, 'resources/server/smoke-test-utils'));

const OUTPUT_DIR = path.join(workspaceRoot, 'tmp/test-results');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const stdoutFile = path.join(OUTPUT_DIR, 'chat-end-class-integration-smoke-test.stdout');
const stderrFile = path.join(OUTPUT_DIR, 'chat-end-class-integration-smoke-test.stderr');

let stdout = '';
let stderr = '';
function log(msg) { stdout += msg + '\n'; console.log(msg); }
function err(msg) { stderr += msg + '\n'; console.error(msg); }

const conversationId = 'test-conv-endclass-' + Date.now();
const profileId = 'test';
const worldId = 'test';
const textbookId = 'math';
const accountId = 'test';

const today = new Date();
const y = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
const monthStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;

const endClassFull = `===FAREWELL===
再见，下次见！
===PAL_MOMENTS_MD===
## ${y} | 灵霓
学习者只点了下课，没说话，本节课没进入教学内容。
===PROGRESS_MD===
# 当前页码：第 1 页

## ${y} | 灵霓
p.1-1 | 第一章
本节课未进入教学内容。
===DIARY_ENTRY===
## ${y}
今天跟灵霓翻开《数学教材》，但我没怎么说话。一节课就这么结束了。
===RELATION_MD===

===COMPANION_NOTE===
今天就到这，下次见。
===END===`;

const endClassFullRetry = `===FAREWELL===
再见，下次见！
===PAL_MOMENTS_MD===
## ${y} | 灵霓
学习者只点了下课，没说话，本节课没进入教学内容。
===PROGRESS_MD===
# 当前页码：第 1 页

## ${y} | 灵霓
p.1-1 | 第一章
本节课未进入教学内容。
===DIARY_ENTRY===
## ${y}
今天跟灵霓翻开《数学教材》，但我没怎么说话。一节课就这么结束了。
===RELATION_MD===

===COMPANION_NOTE===
今天就到这，下次见。
===END===`;

function hasEvent(raw, type) {
  return raw.includes(`"type":"${type}"`);
}

function sha256(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex');
}

function readFileSnapshot(p) {
  if (!fs.existsSync(p)) return { exists: false, hash: null, content: null };
  const content = fs.readFileSync(p, 'utf-8');
  return { exists: true, hash: sha256(content), content };
}

function assertFilesUnchanged(snapshots, label) {
  let ok = true;
  for (const [key, snap] of Object.entries(snapshots)) {
    if (!snap.exists) {
      if (fs.existsSync(key)) {
        err(`FAIL [${label}]: file ${path.basename(key)} was created (should not be written)`);
        ok = false;
      }
      continue;
    }
    const current = readFileSnapshot(key);
    if (!current.exists || current.hash !== snap.hash) {
      err(`FAIL [${label}]: file ${path.basename(key)} was modified (should not be written)`);
      ok = false;
    }
  }
  return ok;
}

async function runTests() {
  const env = new TestEnvironment();
  let passed = true;
  try {
    await env.setup();
    log('[INFO] Server started on port ' + env.serverPort);
    log('[INFO] Mock LLM on port ' + env.mockLLM.port);

    // 文件写入路径：accounts/${accountId}/profiles/${profileId}/worlds/${worldId}/...
    const baseDir = path.join(env.tmpDir, 'accounts', accountId, 'profiles', profileId, 'worlds', worldId);
    const palMomentsPath = path.join(baseDir, 'pal_moments.md');
    const progressPath = path.join(baseDir, 'textbooks', textbookId, 'progress.md');
    const diaryPath = path.join(baseDir, 'diary', `${monthStr}.md`);
    const relationPath = path.join(baseDir, 'relation_a.md');

    fs.mkdirSync(path.join(baseDir, 'diary'), { recursive: true });
    fs.mkdirSync(path.join(baseDir, 'chats'), { recursive: true });
    fs.mkdirSync(path.join(baseDir, 'textbooks', textbookId), { recursive: true });
    fs.writeFileSync(path.join(baseDir, 'textbooks', 'textbook_index.json'), JSON.stringify({
      worldId,
      textbooks: [{ id: textbookId, title: '数学教材', currentPage: 1, numPages: 20, format: 'pdf' }]
    }, null, 2));
    function bindConversation(id, boundTextbookId) {
      fs.writeFileSync(path.join(baseDir, 'chats', id + '.json'), JSON.stringify({
        id,
        worldId,
        textbookId: boundTextbookId || textbookId,
        messages: []
      }, null, 2));
    }

    const body = {
      conversationId,
      profileId,
      worldId,
      textbookId,
      messages: [{ role: 'user', content: '[下课]' }],
      accessMode: 'test',
      sessionToken: 'test-token',
      deviceId: 'test-device',
      teachingLanguage: 'chinese',
      character: 'a'
    };
    bindConversation(body.conversationId);

    // --- 0. 教材绑定不一致：必须在 LLM 调用和所有文件写入前返回 409 ---
    log('[TEST] textbook-binding-mismatch: zero writes');
    const mismatchBody = { ...body, conversationId: conversationId + '-wrong-book' };
    bindConversation(mismatchBody.conversationId, 'other-textbook');
    const mismatchSnapshots = {
      [palMomentsPath]: readFileSnapshot(palMomentsPath),
      [progressPath]: readFileSnapshot(progressPath),
      [diaryPath]: readFileSnapshot(diaryPath),
      [relationPath]: readFileSnapshot(relationPath)
    };
    env.mockLLM.resetRequests();
    const mismatchResponse = await env.postSSE('/api/chat', mismatchBody, { 'X-Account-Id': accountId });
    if (mismatchResponse.status !== 409 || !mismatchResponse.raw.includes('TEXTBOOK_CONTEXT_MISMATCH')) {
      err('FAIL [textbook-binding-mismatch]: expected 409 TEXTBOOK_CONTEXT_MISMATCH');
      passed = false;
    }
    if (env.mockLLM.requests.length !== 0) {
      err('FAIL [textbook-binding-mismatch]: LLM must not be called');
      passed = false;
    }
    if (!assertFilesUnchanged(mismatchSnapshots, 'textbook-binding-mismatch')) passed = false;

    // The real route accepts startsWith("[下课]"); the wrapper must guard the
    // same suffixed form before the route can write anything.
    log('[TEST] textbook-binding-mismatch-suffixed: zero writes');
    const suffixMismatchBody = {
      ...mismatchBody,
      messages: [{ role: 'user', content: '[下课] 请执行课后更新' }]
    };
    env.mockLLM.resetRequests();
    const suffixMismatchResponse = await env.postSSE('/api/chat', suffixMismatchBody, { 'X-Account-Id': accountId });
    if (suffixMismatchResponse.status !== 409 || !suffixMismatchResponse.raw.includes('TEXTBOOK_CONTEXT_MISMATCH')) {
      err('FAIL [textbook-binding-mismatch-suffixed]: expected 409 TEXTBOOK_CONTEXT_MISMATCH');
      passed = false;
    }
    if (env.mockLLM.requests.length !== 0) {
      err('FAIL [textbook-binding-mismatch-suffixed]: LLM must not be called');
      passed = false;
    }
    if (!assertFilesUnchanged(mismatchSnapshots, 'textbook-binding-mismatch-suffixed')) passed = false;

    // --- 1. 成功下课：完整六段响应 ---
    log('[TEST] success-end-class: 6 sections');
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({
      choices: [{ message: { content: endClassFull } }]
    });

    const res1 = await env.postSSE('/api/chat', body, { 'X-Account-Id': accountId });
    log(`[success-end-class] status=${res1.status}, raw events=${res1.raw.split('data:').length - 1}`);
    log(`[success-end-class] text preview: ${res1.text.slice(0, 120)}`);

    const hasText = hasEvent(res1.raw, 'text');
    const hasDone = hasEvent(res1.raw, 'done');
    const hasError = hasEvent(res1.raw, 'error');
    const hasToolResult = hasEvent(res1.raw, 'tool_result');
    log(`[success-end-class] has text=${hasText}, has done=${hasDone}, has error=${hasError}, has tool_result=${hasToolResult}`);

    if (!hasText || !hasDone) {
      err('FAIL [success-end-class]: missing SSE events (text/done)');
      passed = false;
    }
    if (hasError) {
      err('FAIL [success-end-class]: unexpected error event');
      passed = false;
    }
    if (!hasToolResult) {
      err('FAIL [success-end-class]: missing tool_result events');
      passed = false;
    }

    await new Promise(r => setTimeout(r, 300));
    const palExists = fs.existsSync(palMomentsPath);
    const progressExists = fs.existsSync(progressPath);
    const diaryExists = fs.existsSync(diaryPath);
    const relationExists = fs.existsSync(relationPath);

    log(`[success-end-class] file writes: pal=${palExists}, progress=${progressExists}, diary=${diaryExists}, relation=${relationExists}`);

    if (!palExists) {
      err('FAIL [success-end-class]: pal_moments.md not written');
      passed = false;
    }
    if (!progressExists) {
      err('FAIL [success-end-class]: progress.md not written');
      passed = false;
    }
    if (!diaryExists) {
      err('FAIL [success-end-class]: diary not written');
      passed = false;
    }

    if (palExists) {
      const palContent = fs.readFileSync(palMomentsPath, 'utf-8');
      if (!palContent.includes(`${y}`)) {
        err('FAIL [success-end-class]: pal_moments.md missing date');
        passed = false;
      }
    }
    if (progressExists) {
      const progContent = fs.readFileSync(progressPath, 'utf-8');
      if (!progContent.includes('当前页码') && !progContent.includes('Current Page')) {
        err('FAIL [success-end-class]: progress.md missing page header');
        passed = false;
      }
    }
    if (diaryExists) {
      const diaryContent = fs.readFileSync(diaryPath, 'utf-8');
      if (!diaryContent.includes(`${y}`)) {
        err('FAIL [success-end-class]: diary missing date');
        passed = false;
      }
    }

    log(`[success-end-class] mock LLM requests: ${env.mockLLM.requests.length}`);
    if (env.mockLLM.requests.length !== 1) {
      err('FAIL [success-end-class]: expected exactly 1 LLM request, got ' + env.mockLLM.requests.length);
      passed = false;
    }

    // --- 2. 重试场景：第一次解析失败，第二次成功 ---
    log('[TEST] retry-once: first parse fails, second succeeds');
    const body2 = {
      conversationId: conversationId + '-retry',
      profileId,
      worldId,
      textbookId,
      messages: [{ role: 'user', content: '[下课]' }],
      accessMode: 'test',
      sessionToken: 'test-token',
      deviceId: 'test-device',
      teachingLanguage: 'chinese',
      character: 'a'
    };
    bindConversation(body2.conversationId);
    env.mockLLM.resetRequests();
    env.mockLLM.setResponseSequence([
      { body: { choices: [{ message: { content: 'garbage without separators' } }] } },
      { body: { choices: [{ message: { content: endClassFullRetry } }] } }
    ]);

    const res2 = await env.postSSE('/api/chat', body2, { 'X-Account-Id': accountId });
    log(`[retry-once] status=${res2.status}, raw events=${res2.raw.split('data:').length - 1}`);
    log(`[retry-once] text preview: ${res2.text.slice(0, 120)}`);

    const reqCount2 = env.mockLLM.requests.length;
    log(`[retry-once] mock LLM requests: ${reqCount2}`);
    if (reqCount2 !== 2) {
      err('FAIL [retry-once]: expected exactly 2 LLM requests (first fail + retry), got ' + reqCount2);
      passed = false;
    }

    const retryHasDone = hasEvent(res2.raw, 'done');
    const retryHasError = hasEvent(res2.raw, 'error');
    if (res2.status === 200 && retryHasDone && !retryHasError) {
      log('PASS [retry-once]');
    } else {
      err('FAIL [retry-once]: expected 200 with done and no error');
      passed = false;
    }

    // --- 3. 两次解析都失败 ---
    log('[TEST] double-fail: both attempts fail');
    const body3 = {
      conversationId: conversationId + '-doublefail',
      profileId,
      worldId,
      textbookId,
      messages: [{ role: 'user', content: '[下课]' }],
      accessMode: 'test',
      sessionToken: 'test-token',
      deviceId: 'test-device',
      teachingLanguage: 'chinese',
      character: 'a'
    };
    bindConversation(body3.conversationId);
    const snap3 = {
      [palMomentsPath]: readFileSnapshot(palMomentsPath),
      [progressPath]: readFileSnapshot(progressPath),
      [diaryPath]: readFileSnapshot(diaryPath),
      [relationPath]: readFileSnapshot(relationPath)
    };
    env.mockLLM.resetRequests();
    env.mockLLM.setResponseSequence([
      { body: { choices: [{ message: { content: 'garbage 1' } }] } },
      { body: { choices: [{ message: { content: 'garbage 2' } }] } }
    ]);

    const res3 = await env.postSSE('/api/chat', body3, { 'X-Account-Id': accountId });
    log(`[double-fail] status=${res3.status}, has error=${hasEvent(res3.raw, 'error')}, has done=${hasEvent(res3.raw, 'done')}`);

    const reqCount3 = env.mockLLM.requests.length;
    log(`[double-fail] mock LLM requests: ${reqCount3}`);
    if (reqCount3 !== 2) {
      err('FAIL [double-fail]: expected exactly 2 LLM requests (both fail), got ' + reqCount3);
      passed = false;
    }

    if (!assertFilesUnchanged(snap3, 'double-fail')) {
      passed = false;
    }

    if (res3.status === 200 && hasEvent(res3.raw, 'error')) {
      log('PASS [double-fail]: returned error event, no file writes');
    } else {
      err('FAIL [double-fail]: expected error event');
      passed = false;
    }

    // --- 4. 关键字段为空：缺少 palMomentsMd 或 progressMd ---
    log('[TEST] empty-fields: palMomentsMd and progressMd empty');
    const body4 = {
      conversationId: conversationId + '-empty',
      profileId,
      worldId,
      textbookId,
      messages: [{ role: 'user', content: '[下课]' }],
      accessMode: 'test',
      sessionToken: 'test-token',
      deviceId: 'test-device',
      teachingLanguage: 'chinese',
      character: 'a'
    };
    bindConversation(body4.conversationId);
    const snap4 = {
      [palMomentsPath]: readFileSnapshot(palMomentsPath),
      [progressPath]: readFileSnapshot(progressPath),
      [diaryPath]: readFileSnapshot(diaryPath),
      [relationPath]: readFileSnapshot(relationPath)
    };
    const endClassEmpty = `===FAREWELL===
再见
===PAL_MOMENTS_MD===

===PROGRESS_MD===

===DIARY_ENTRY===
日记
===RELATION_MD===

===COMPANION_NOTE===
便签
===END===`;
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({
      choices: [{ message: { content: endClassEmpty } }]
    });

    const res4 = await env.postSSE('/api/chat', body4, { 'X-Account-Id': accountId });
    log(`[empty-fields] status=${res4.status}, has error=${hasEvent(res4.raw, 'error')}, has done=${hasEvent(res4.raw, 'done')}`);

    const reqCount4 = env.mockLLM.requests.length;
    log(`[empty-fields] mock LLM requests: ${reqCount4}`);
    if (reqCount4 !== 2) {
      err('FAIL [empty-fields]: expected exactly 2 LLM requests (initial + retry), got ' + reqCount4);
      passed = false;
    }

    if (!assertFilesUnchanged(snap4, 'empty-fields')) {
      passed = false;
    }

    if (res4.status === 200 && hasEvent(res4.raw, 'error')) {
      log('PASS [empty-fields]: returned error event, no file writes');
    } else {
      err('FAIL [empty-fields]: expected error event for empty fields');
      passed = false;
    }

    // --- 5. 缺少分隔符 ---
    log('[TEST] missing-separator: no ===TAG=== delimiters');
    const body5 = {
      conversationId: conversationId + '-missing',
      profileId,
      worldId,
      textbookId,
      messages: [{ role: 'user', content: '[下课]' }],
      accessMode: 'test',
      sessionToken: 'test-token',
      deviceId: 'test-device',
      teachingLanguage: 'chinese',
      character: 'a'
    };
    bindConversation(body5.conversationId);
    const snap5 = {
      [palMomentsPath]: readFileSnapshot(palMomentsPath),
      [progressPath]: readFileSnapshot(progressPath),
      [diaryPath]: readFileSnapshot(diaryPath),
      [relationPath]: readFileSnapshot(relationPath)
    };
    env.mockLLM.resetRequests();
    env.mockLLM.setResponse({
      choices: [{ message: { content: 'This is just plain text without any separators.' } }]
    });

    const res5 = await env.postSSE('/api/chat', body5, { 'X-Account-Id': accountId });
    log(`[missing-separator] status=${res5.status}, has error=${hasEvent(res5.raw, 'error')}, has done=${hasEvent(res5.raw, 'done')}`);

    const reqCount5 = env.mockLLM.requests.length;
    log(`[missing-separator] mock LLM requests: ${reqCount5}`);
    if (reqCount5 !== 2) {
      err('FAIL [missing-separator]: expected exactly 2 LLM requests (initial + retry), got ' + reqCount5);
      passed = false;
    }

    if (!assertFilesUnchanged(snap5, 'missing-separator')) {
      passed = false;
    }

    if (res5.status === 200 && hasEvent(res5.raw, 'error')) {
      log('PASS [missing-separator]: returned error event, no file writes');
    } else {
      err('FAIL [missing-separator]: expected error event for missing separators');
      passed = false;
    }

  } catch (e) {
    err('ERROR: ' + e.message + '\n' + e.stack);
    passed = false;
  } finally {
    await env.teardown();
    log('[INFO] Cleanup complete');
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

runTests();

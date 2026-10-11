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
# 当前页码：第 52 页

## ${y} | 灵霓
p.43-52 | 第一章
本节课实际讲到第 50 页。
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
# 当前页码：第 52 页

## ${y} | 灵霓
p.43-52 | 第一章
本节课实际讲到第 50 页。
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
    const relationPath = path.join(baseDir, 'relation_npc_a.md');
    const worldRecordsPath = path.join(baseDir, 'world_records.md');

    fs.mkdirSync(path.join(baseDir, 'diary'), { recursive: true });
    fs.mkdirSync(path.join(baseDir, 'chats'), { recursive: true });
    fs.mkdirSync(path.join(baseDir, 'textbooks', textbookId), { recursive: true });
    fs.writeFileSync(path.join(baseDir, 'textbooks', textbookId, 'progress_state.json'), JSON.stringify({
      schemaVersion: 3,
      textbookId,
      sourceConversationId: conversationId,
      lastTaughtPage: 50,
      currentPage: 50,
      loadedCursor: { startPage: 43, endPage: 52 }
    }, null, 2));
    fs.writeFileSync(path.join(baseDir, 'world_meta.json'), JSON.stringify({ worldId, language: 'chinese', companions: [{ candidateId: 'fixture_a', name: '灵霓', companionInstanceId: 'ci_aaaaaaaaaaaaaaaa' }, null, null, null] }, null, 2));
    fs.writeFileSync(path.join(baseDir, 'npc_a.md'), '# 灵霓\n\n可靠、耐心。', 'utf-8');
    fs.writeFileSync(path.join(baseDir, 'relation_npc_a.md'), '', 'utf-8');
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
      character: 'npc_a',
      continuityOperationId: 'chat-endclass-replay-fixture'
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
    const mismatchResponse = await env.postSSE('/api/chat', mismatchBody, { Authorization: env.capabilityHeader() });
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
    const suffixMismatchResponse = await env.postSSE('/api/chat', suffixMismatchBody, { Authorization: env.capabilityHeader() });
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

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('auth refresh timeout')), 5000);
      const onMessage = (message) => {
        if (!message || message.type !== 'socratopia:auth-state-ack:v1' || message.sequence !== 3) return;
        clearTimeout(timeout);
        env.serverProcess.off('message', onMessage);
        resolve();
      };
      env.serverProcess.on('message', onMessage);
      env.serverProcess.send({ type: 'socratopia:auth-state:v1', sequence: 3, active: true, accountId: accountId, sessionEpoch: 3 });
    });

    const res1 = await env.postSSE('/api/chat', body, { Authorization: env.capabilityHeader() });
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
      if (!progContent.includes('第 50 页')) {
        err('FAIL [taught-anchor]: progress.md must persist actual page 50 instead of loaded tail 52');
        passed = false;
      }
    }
    const indexAfterEndClass = JSON.parse(fs.readFileSync(path.join(baseDir, 'textbooks', 'textbook_index.json'), 'utf-8'));
    if (indexAfterEndClass.textbooks.find(item => item.id === textbookId)?.currentPage !== 50) {
      err('FAIL [taught-anchor]: textbook index must persist actual page 50 instead of loaded tail 52');
      passed = false;
    } else {
      log('PASS [taught-anchor]: 43-52 window preserves actual page 50');
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
    // Same scope + operation must replay the receipt without a second LLM call or append.
    const replaySnapshots = { [palMomentsPath]: readFileSnapshot(palMomentsPath), [diaryPath]: readFileSnapshot(diaryPath), [worldRecordsPath]: readFileSnapshot(worldRecordsPath) };
    const replay = await env.postSSE('/api/chat', body, { Authorization: env.capabilityHeader() });
    if (replay.status !== 200 || !hasEvent(replay.raw, 'done')) { err('FAIL [receipt-replay]: expected 200 done'); passed = false; }
    if (env.mockLLM.requests.length !== 1) { err('FAIL [receipt-replay]: must not call LLM again'); passed = false; }
    if (!assertFilesUnchanged(replaySnapshots, 'receipt-replay')) passed = false;

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
      character: 'npc_a'
    };
    bindConversation(body2.conversationId);
    env.mockLLM.resetRequests();
    env.mockLLM.setResponseSequence([
      { body: { choices: [{ message: { content: 'garbage without separators' } }] } },
      { body: { choices: [{ message: { content: endClassFullRetry } }] } }
    ]);

    const res2 = await env.postSSE('/api/chat', body2, { Authorization: env.capabilityHeader() });
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
      character: 'npc_a'
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

    const res3 = await env.postSSE('/api/chat', body3, { Authorization: env.capabilityHeader() });
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
      character: 'npc_a'
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

    const res4 = await env.postSSE('/api/chat', body4, { Authorization: env.capabilityHeader() });
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
      character: 'npc_a'
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

    const res5 = await env.postSSE('/api/chat', body5, { Authorization: env.capabilityHeader() });
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


    // --- 6. Incident regressions: real HTTP route and isolated file writes ---
    async function reportCase(name, responses, success, expectedCode) {
      log('[TEST] ' + name);
      const caseBody = { ...body, conversationId: conversationId + '-' + name };
      bindConversation(caseBody.conversationId);
      const filePaths = [palMomentsPath, progressPath, diaryPath, relationPath,
        worldRecordsPath, path.join(baseDir, 'world_meta.json'),
        path.join(baseDir, 'textbooks', 'textbook_index.json')];
      const snapshots = Object.fromEntries(filePaths.map(file => [file, readFileSnapshot(file)]));
      const requests = [];
      env.mockLLM.resetRequests();
      env.mockLLM.setResponseGenerator(data => {
        requests.push(data);
        return { body: { choices: [{ message: { content: responses[Math.min(requests.length - 1, responses.length - 1)].content },
          finish_reason: responses[Math.min(requests.length - 1, responses.length - 1)].finishReason || 'stop' }] } };
      });
      const response = await env.postSSE('/api/chat', caseBody, { Authorization: env.capabilityHeader() });
      if (response.status !== 200 || !hasEvent(response.raw, 'done') || hasEvent(response.raw, 'error') === success) {
        err('FAIL [' + name + ']: unexpected SSE outcome'); passed = false;
      }
      if (requests.length !== responses.length) {
        err('FAIL [' + name + ']: unexpected request count ' + requests.length); passed = false;
      }
      if (requests.some(request => request.max_tokens !== 8192)) {
        err('FAIL [' + name + ']: end-class output budget must be 8192'); passed = false;
      }
      if (requests.length === 2) {
        const firstPrompt = requests[0].messages[0].content;
        const secondPrompt = requests[1].messages[0].content;
        if (!secondPrompt.startsWith(firstPrompt) || !secondPrompt.includes('[End-class report format repair]') ||
            JSON.stringify(requests[0].messages.slice(1)) !== JSON.stringify(requests[1].messages.slice(1))) {
          err('FAIL [' + name + ']: retry must add format repair instructions and preserve lesson messages'); passed = false;
        }
      }
      if (!success) {
        if (!assertFilesUnchanged(snapshots, name)) passed = false;
        if (expectedCode && !response.raw.includes('"code":"' + expectedCode + '"')) {
          err('FAIL [' + name + ']: missing structured error code'); passed = false;
        }
      } else {
        if (readFileSnapshot(worldRecordsPath).hash === snapshots[worldRecordsPath].hash ||
            !fs.readFileSync(progressPath, 'utf8').includes('第 50 页')) {
          err('FAIL [' + name + ']: expected committed records and authoritative taught page'); passed = false;
        }
        // Receipt replay deliberately re-synchronizes progress/index metadata;
        // immutable narrative records must not be appended a second time.
        const savedHashes = Object.fromEntries([palMomentsPath, diaryPath, relationPath, worldRecordsPath].map(file => [file, readFileSnapshot(file)]));
        const requestCount = requests.length;
        const replayResponse = await env.postSSE('/api/chat', caseBody, { Authorization: env.capabilityHeader() });
        if (hasEvent(replayResponse.raw, 'error') || requests.length !== requestCount || !assertFilesUnchanged(savedHashes, name + '-replay')) {
          err('FAIL [' + name + ']: replay must not regenerate or duplicate records'); passed = false;
        }
        const replayIndex = JSON.parse(fs.readFileSync(path.join(baseDir, 'textbooks', 'textbook_index.json'), 'utf8'));
        if (replayIndex.textbooks.find(item => item.id === textbookId)?.currentPage !== 50) {
          err('FAIL [' + name + ']: replay must preserve the taught page'); passed = false;
        }
      }
      log('[RESULT] ' + name + ': requests=' + requests.length + ', error=' + hasEvent(response.raw, 'error'));
    }
    const splitReport = endClassFull.replace(/===(PAL_MOMENTS_MD|PROGRESS_MD|DIARY_ENTRY|RELATION_MD|COMPANION_NOTE)===/g, '===\r\n$1\r\n===');
    await reportCase('split-markers', [{ content: splitReport }], true);
    await reportCase('provider-truncated-retry', [
      { content: endClassFull, finishReason: 'length' }, { content: splitReport }
    ], true);
    await reportCase('provider-truncated-twice', [
      { content: endClassFull, finishReason: 'length' }, { content: endClassFull, finishReason: 'length' }
    ], false, 'END_CLASS_OUTPUT_TRUNCATED');
    const missingEnd = endClassFull.replace('===END===', '');
    await reportCase('missing-end-retry', [{ content: missingEnd }, { content: endClassFull }], true);
    await reportCase('missing-end-twice', [{ content: missingEnd }, { content: missingEnd }], false, 'END_CLASS_INVALID_REPORT');
    const missingDiary = endClassFull.replace(/===DIARY_ENTRY===[\s\S]*?(?====RELATION_MD===)/, '');
    await reportCase('missing-diary-twice', [{ content: missingDiary }, { content: missingDiary }], false, 'END_CLASS_INVALID_REPORT');

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

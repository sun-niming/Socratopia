// resources/server/kb-inflight-contract-smoke-test.js
// 目标：验证 KB 提炼的并发合并契约和缓存行为
// 约束：
//   - 禁止连接真实线上 API，禁止读取真实 API key
//   - 启动本地 mock HTTP endpoint，隔离 settings/set 指向它
//   - mock 服务统计收到的请求数
//   - 3 个并发调用断言 HTTP 请求数 == 1
//   - 后台完成后再次调用同参数，断言命中缓存且请求数仍为 1
//   - 清理所有临时目录和子进程
// 位置：resources/server/kb-inflight-contract-smoke-test.js（server.js 旁）

const http = require('http');
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

var requestCount = 0;
var exitCode = 0;

const mockResponse = JSON.stringify({
  choices: [{
    message: {
      content: JSON.stringify({
        cards: [{
          title: "Test",
          definition: "Definition",
          key_points: ["KP"],
          examples: [],
          misconceptions: [],
          qa_pairs: [],
          difficulty: 1,
          prerequisites: [],
          source_pages: [1, 2],
          needs_verification: false,
          verify_query: ""
        }],
        teaching_sequence: [{
          phase: 1,
          label: "Phase",
          card_ids: ["Test"],
          teach_goal: "Goal",
          branches: []
        }]
      })
    }
  }]
});

const mockServer = http.createServer((req, res) => {
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    requestCount++;
    console.log('[MOCK] Request #' + requestCount + ' received');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(mockResponse);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

mockServer.listen(0, '127.0.0.1', () => {
  const mockPort = mockServer.address().port;
  console.log('[MOCK] Server listening on 127.0.0.1:' + mockPort);

  // 创建隔离配置目录
  const mockDir = path.join(__dirname, '_mock_kb_test');
  const contentDir = path.join(mockDir, 'content');
  fs.mkdirSync(contentDir, { recursive: true });

  // 隔离 settings.json（禁止读取真实 API key）
  fs.writeFileSync(path.join(mockDir, 'settings.json'), JSON.stringify({
    endpoint: 'http://127.0.0.1:' + mockPort + '/v1',
    apiKeys: { codex: 'mock-key' }
  }, null, 2));

  // 隔离 set.json（禁止读取真实 API key）
  fs.writeFileSync(path.join(mockDir, 'set.json'), JSON.stringify({
    strong: { baseUrl: 'http://127.0.0.1:' + mockPort + '/v1', apiKey: 'mock-key', model: 'mock-model', group: 'gpt' },
    kb:     { baseUrl: 'http://127.0.0.1:' + mockPort + '/v1', apiKey: 'mock-key', model: 'mock-model', group: 'gpt' },
    weak:   { baseUrl: 'http://127.0.0.1:' + mockPort + '/v1', apiKey: 'mock-key', model: 'mock-model', group: 'gpt' }
  }, null, 2));

  // 创建 textbook 目录结构（防止 __KB_DISTILL_IMPL__ 路径错误）
  const textbookDir = path.join(contentDir, 'profiles', 'test', 'worlds', 'test', 'textbooks', 'test_tb');
  fs.mkdirSync(path.join(textbookDir, 'knowledge_base'), { recursive: true });
  fs.writeFileSync(path.join(textbookDir, 'pages.json'), JSON.stringify({
    format: 'markdown',
    pages: [{ pageNum: 1, title: 'Page 1' }, { pageNum: 2, title: 'Page 2' }]
  }, null, 2));

  // 独立的预构建 KB：验证运行时只完整展开当前卡和两个后续卡，
  // 同时保留第四卡标题供模型了解顺序，但绝不能泄露第四卡正文。
  const contextTextbookDir = path.join(contentDir, 'profiles', 'test', 'worlds', 'test', 'textbooks', 'context_tb');
  const contextKbDir = path.join(contextTextbookDir, 'knowledge_base');
  const contextCardsDir = path.join(contextKbDir, 'cards');
  fs.mkdirSync(contextCardsDir, { recursive: true });
  const contextCards = [
    { concept_id: '001_one', title: 'One', definition: 'DEFINITION_ONE_VISIBLE', source_pages: [1, 1], _chunk_pages: [1, 2] },
    { concept_id: '002_two', title: 'Two', definition: 'DEFINITION_TWO_VISIBLE', source_pages: [1, 1], _chunk_pages: [1, 2] },
    { concept_id: '003_three', title: 'Three', definition: 'DEFINITION_THREE_VISIBLE', source_pages: [2, 2], _chunk_pages: [1, 2] },
    { concept_id: '004_four', title: 'Four', definition: 'DEFINITION_FOUR_MUST_STAY_HIDDEN', source_pages: [2, 2], _chunk_pages: [1, 2] }
  ];
  contextCards.forEach(card => {
    fs.writeFileSync(path.join(contextCardsDir, card.concept_id + '.json'), JSON.stringify(card, null, 2));
  });
  fs.writeFileSync(path.join(contextKbDir, 'index.json'), JSON.stringify({ cards: contextCards }, null, 2));
  fs.writeFileSync(path.join(contextKbDir, 'teaching_map.json'), JSON.stringify({
    version: 3,
    ordering: 'chunk-ordinal-then-source-page',
    segments: [{
      page_range: [1, 2],
      sequence: [{ phase: 1, label: 'Context boundary', card_ids: contextCards.map(card => card.concept_id), teach_goal: 'Teach in order', branches: [] }],
      generated_by: 'deterministic-page-order'
    }],
    fallback_segments: 0
  }, null, 2));
  fs.writeFileSync(path.join(contextKbDir, 'build_status.json'), JSON.stringify({
    state: 'done', activationEligible: true, cardCount: contextCards.length
  }, null, 2));
  fs.writeFileSync(path.join(contextTextbookDir, 'pages.json'), JSON.stringify({
    format: 'markdown',
    pages: [{ pageNum: 1, title: 'Page 1' }, { pageNum: 2, title: 'Page 2' }]
  }, null, 2));

  // 子进程脚本：加载 server.js 并执行并发测试
  const childScript = path.join(__dirname, '_kb_inflight_child.js');
  const serverScript = path.join(__dirname, 'server.js');
  const childCode = `
    const path = require('path');

    process.env.PORT = '30007';
    process.env.HOSTNAME = '127.0.0.1';
    process.env.CONTENT_ROOT = '${contentDir.replace(/\\/g, '\\\\')}';

    const timer = setTimeout(() => {
      const hasDistill = typeof global.__KB_DISTILL__ === 'function';
      if (!hasDistill) {
        console.log('BLOCKED: global.__KB_DISTILL__ not available after server.js init');
        process.exit(1);
      }

      console.log('[CHILD] global.__KB_DISTILL__ available');

      const rawText = 'test raw text for kb distill';
      const startPage = 1;
      const endPage = 2;
      const textbookDir = path.join(process.env.CONTENT_ROOT, 'profiles', 'test', 'worlds', 'test', 'textbooks', 'test_tb');
      const resumeState = null;

      console.log('[CHILD] Phase 1: 3 concurrent calls (should merge to 1 HTTP request)');
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(global.__KB_DISTILL__(rawText, startPage, endPage, textbookDir, resumeState));
      }

      Promise.all(promises).then(results => {
        const nonNull = results.filter(r => r !== null).length;
        console.log('[CHILD] Phase 1 results: non-null=' + nonNull + ', identical=' + results.every(r => r === results[0]));

        // 等待后台完成（即使前台超时，后台仍继续）
        console.log('[CHILD] Waiting 6s for background job to complete...');
        setTimeout(() => {
          console.log('[CHILD] Phase 2: second call with same args (should hit cache, 0 new HTTP requests)');
          global.__KB_DISTILL__(rawText, startPage, endPage, textbookDir, resumeState).then(result2 => {
            console.log('[CHILD] Phase 2 result non-null:', result2 !== null);
            console.log('[CHILD] Phase 3: verify prebuilt KB context boundary and balanced pacing directive');
            const contextTextbookDir = path.join(process.env.CONTENT_ROOT, 'profiles', 'test', 'worlds', 'test', 'textbooks', 'context_tb');
            const contextResume = { schemaVersion: 3, activeConceptId: '001_one', lastTaughtPage: 1, currentPage: 1 };
            global.__KB_DISTILL__('prebuilt context source', 1, 2, contextTextbookDir, contextResume).then(contextResult => {
              const checks = [
                [contextResult && contextResult.includes('DEFINITION_ONE_VISIBLE'), 'current card body is visible'],
                [contextResult && contextResult.includes('DEFINITION_TWO_VISIBLE'), 'first neighbor body is visible'],
                [contextResult && contextResult.includes('DEFINITION_THREE_VISIBLE'), 'second neighbor body is visible'],
                [contextResult && contextResult.includes('Four'), 'later card title remains visible'],
                [contextResult && !contextResult.includes('DEFINITION_FOUR_MUST_STAY_HIDDEN'), 'fourth card body stays folded'],
                [contextResult && contextResult.includes('Context boundary'), 'ordered version-3 fallback segment is preserved instead of degrading the whole map'],
                [contextResult && contextResult.includes('1-3 张紧密相关卡片'), 'balanced 1-3 card pacing is enforced'],
                [contextResult && contextResult.includes('同一卡最多检查两轮'), 'two-check limit is enforced']
              ];
              const failed = checks.filter(([ok]) => !ok).map(([, label]) => label);
              if (failed.length) {
                console.error('[CHILD] Phase 3 failed:', failed.join('; '));
                process.exit(1);
                return;
              }
              console.log('PASS: prebuilt context exposes current + 2 card bodies, folds later bodies, and enforces balanced pacing');
              console.log('DONE');
              process.exit(0);
            }).catch(e => {
              console.error('[CHILD] Phase 3 error:', e.message);
              process.exit(1);
            });
          }).catch(e => {
            console.error('[CHILD] Phase 2 error:', e.message);
            process.exit(1);
          });
        }, 6000);
      }).catch(e => {
        console.error('[CHILD] Phase 1 error:', e.message);
        process.exit(1);
      });
    }, 2000);

    try {
      require('${serverScript.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');
    } catch (e) {
      clearTimeout(timer);
      console.log('BLOCKED: server.js failed to load:', e.message);
      process.exit(1);
    }
  `;

  fs.writeFileSync(childScript, childCode);

  const child = fork(childScript, [], { silent: true });

  let childOutput = '';
  child.stdout.on('data', (data) => { childOutput += data; process.stdout.write(data); });
  child.stderr.on('data', (data) => { process.stderr.write(data); });

  child.on('exit', (code) => {
    console.log('\n=== Verification ===');
    console.log('Mock server total requests:', requestCount);
    console.log('Child exit code:', code);

    if (childOutput.includes('BLOCKED') || code !== 0) {
      console.log('BLOCKED: test could not complete');
      exitCode = 1;
    } else {
      // 断言 1: 3 个并发调用 = 1 个 HTTP 请求
      if (requestCount === 1) {
        console.log('PASS: 3 concurrent calls resulted in exactly 1 HTTP request');
      } else if (requestCount > 1) {
        console.log('FAIL: expected 1 HTTP request, got', requestCount);
        exitCode = 1;
      } else {
        console.log('FAIL: no HTTP requests received (mock server not reached?)');
        exitCode = 1;
      }

      // 断言 2: 缓存命中（第二次调用无新请求）
      if (childOutput.includes('DONE')) {
        console.log('PASS: second call completed (cache hit or background completed)');
      }

      if (!childOutput.includes('PASS: prebuilt context exposes current + 2 card bodies')) {
        console.log('FAIL: prebuilt KB context-boundary assertion did not complete');
        exitCode = 1;
      }
    }

    // 清理
    mockServer.close();
    try { fs.rmSync(mockDir, { recursive: true, force: true }); } catch(e) {}
    try { fs.unlinkSync(childScript); } catch(e) {}

    process.exit(exitCode);
  });

  child.on('error', (err) => {
    console.error('Child process error:', err);
    mockServer.close();
    try { fs.rmSync(mockDir, { recursive: true, force: true }); } catch(e) {}
    try { fs.unlinkSync(childScript); } catch(e) {}
    process.exit(1);
  });
});

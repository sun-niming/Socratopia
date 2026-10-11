// smoke-test-utils.js — 黑盒集成测试共享工具
// 位置: resources/server/smoke-test-utils.js
// 不依赖被测路由内部函数，仅通过 HTTP 与端口通信。
// 只使用 Node 内置模块；不读取真实 settings.json/set.json；不输出 API key。

const http = require('http');
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const localAuth = require('./lib/local-request-auth.js');

class MockLLM {
  constructor() {
    this.responseBody = null;
    this.responseStatus = 200;
    this.requests = [];
    this.server = null;
    this.port = 0;
    // 0 = emit the whole content in one SSE frame (default).  A positive value splits the
    // content into that many characters per frame, so a caller can drive the route's
    // incremental text handler across frame boundaries.
    this.streamFrameSize = 0;
    // Raw (non-JSON) responses let a test reproduce a gateway interception page,
    // which is otherwise indistinguishable from a normal provider envelope.
    this.rawResponse = null;
  }

  setStreamFrameSize(size) {
    this.streamFrameSize = Number(size) > 0 ? Math.floor(Number(size)) : 0;
  }

  setResponse(body, status = 200) {
    this.responseBody = body;
    this.responseStatus = status;
    this.responseSequence = null;
    this.responseIndex = 0;
    this.responseGenerator = null;
    this.rawResponse = null;
  }

  // Sends `text` verbatim with `contentType`, bypassing JSON.stringify entirely.
  setRawResponse(text, status = 200, contentType = 'text/html') {
    this.rawResponse = { text, status, contentType };
    this.responseBody = null;
    this.responseSequence = null;
    this.responseGenerator = null;
  }

  setResponseSequence(responses) {
    this.responseSequence = responses;
    this.responseIndex = 0;
    this.responseBody = null;
    this.responseGenerator = null;
    this.rawResponse = null;
  }

  setResponseGenerator(fn) {
    this.responseGenerator = fn;
    this.responseBody = null;
    this.responseSequence = null;
    this.rawResponse = null;
  }

  // A generator may be async; the handler awaits it so a test can simulate a
  // slow provider and drive the client timeout path.
  async getResponse(data) {
    if (this.responseGenerator) {
      const r = await this.responseGenerator(data, this.requests.length);
      return { body: r.body, status: r.status || 200, raw: r.raw || null };
    }
    if (this.responseSequence && this.responseIndex < this.responseSequence.length) {
      const entry = this.responseSequence[this.responseIndex++];
      return { body: entry.body, status: entry.status || 200, raw: entry.raw || null };
    }
    if (this.rawResponse) {
      return { body: this.rawResponse.text, status: this.rawResponse.status, raw: this.rawResponse.contentType };
    }
    return { body: this.responseBody, status: this.responseStatus };
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.url === '/v1/chat/completions' && req.method === 'POST') {
          // Decode UTF-8 across TCP chunks without corrupting Chinese prompts.
          req.setEncoding('utf8');
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              this.requests.push({
                model: data.model,
                messages: data.messages,
                response_format: data.response_format,
                stream: data.stream,
                max_tokens: data.max_tokens,
                thinking: data.thinking,
                temperature: data.temperature,
                headers: req.headers
              });

              const { body: respBody, status: respStatus, raw: respContentType } = await this.getResponse(data);

              if (respContentType) {
                res.writeHead(respStatus, { 'Content-Type': respContentType });
                res.end(String(respBody));
                return;
              }

              if (data.stream) {
                res.writeHead(respStatus, {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache'
                });
                let content = '';
                if (respBody && respBody.choices && respBody.choices[0]) {
                  if (respBody.choices[0].message && respBody.choices[0].message.content) {
                    content = respBody.choices[0].message.content;
                  } else if (respBody.choices[0].delta && respBody.choices[0].delta.content) {
                    content = respBody.choices[0].delta.content;
                  }
                }
                if (!content) {
                  content = JSON.stringify(respBody);
                }
                const frameSize = this.streamFrameSize;
                if (frameSize > 0 && content.length > frameSize) {
                  for (let at = 0; at < content.length; at += frameSize) {
                    const piece = content.slice(at, at + frameSize);
                    res.write('data: {"choices":[{"delta":{"content":' + JSON.stringify(piece) + '}}]}\n\n');
                  }
                } else {
                  res.write('data: {"choices":[{"delta":{"content":' + JSON.stringify(content) + '}}]}\n\n');
                }
                res.write('data: [DONE]\n\n');
                res.end();
              } else {
                res.writeHead(respStatus, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(respBody));
              }
            } catch (e) {
              res.writeHead(400);
              res.end('Bad request');
            }
          });
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) this.server.close(resolve);
      else resolve();
    });
  }

  resetRequests() {
    this.requests = [];
  }
}

// The confined Windows sandbox grants write access to the workspace root only;
// `resources/server` can carry a medium integrity label the low-integrity shell
// cannot write through, while a directory created under the workspace root
// inherits the grant.  Probe once and use whichever base is actually writable;
// on an unconfined machine the historical location (beside this file) wins.
function pickTmpBase() {
  const bases = [__dirname, path.join(__dirname, '..', '..')];
  for (const base of bases) {
    const probe = path.join(base, '_tmp_probe_' + process.pid + '_' + Math.random().toString(36).slice(2, 8));
    try {
      fs.mkdirSync(probe, { recursive: true });
      fs.writeFileSync(path.join(probe, 'probe.txt'), 'x');
      fs.rmSync(probe, { recursive: true, force: true });
      return base;
    } catch (_) { /* try the next base */ }
  }
  return __dirname;
}

class TestEnvironment {
  constructor(options) {
    this.mockLLM = new MockLLM();
    this.serverProcess = null;
    this.tmpDir = path.join(pickTmpBase(), '_tmp_test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    this.serverPort = 0;
    this.ready = false;
    this.options = options || {};
    this.serverStdout = '';
    this.serverStderr = '';
    this.capabilityIssuer = null;
  }

  async setup() {
    fs.mkdirSync(this.tmpDir, { recursive: true });
    const contentDir = path.join(this.tmpDir, 'content');
    fs.mkdirSync(contentDir, { recursive: true });
    if (this.options.rules && typeof this.options.rules === 'object') {
      const rulesDir = path.join(this.tmpDir, 'rules');
      fs.mkdirSync(rulesDir, { recursive: true });
      Object.keys(this.options.rules).forEach((name) => {
        fs.writeFileSync(path.join(rulesDir, name), String(this.options.rules[name]), 'utf8');
      });
    }

    await this.mockLLM.start();
    const mockUrl = `http://127.0.0.1:${this.mockLLM.port}/v1`;

    let settingsCfg = {
      endpoint: mockUrl,
      apiKey: 'mock-key',
      apiType: 'openai',
      Base_API: 'openai',
      apiKeys: { codex: 'mock-key', openai: 'mock-key', anthropic: 'mock-key', deepseek: 'mock-key' }
    };

    const setCfg = {
      strong: { baseUrl: mockUrl, apiKey: 'mock-key', model: 'mock-strong', group: 'gpt' },
      kb:     { baseUrl: mockUrl, apiKey: 'mock-key', model: 'mock-kb', group: 'gpt' },
      weak:   { baseUrl: mockUrl, apiKey: 'mock-key', model: 'mock-weak', group: 'gpt' }
    };
    if (this.options.emptyApiKey) {
      settingsCfg.apiKey = '';
      settingsCfg.apiKeys = { codex: '', openai: '', anthropic: '', deepseek: '' };
      setCfg.strong.apiKey = '';
      setCfg.kb.apiKey = '';
      setCfg.weak.apiKey = '';
    }
    // Callers may toggle extra config blocks (e.g. `set: { assets: { visionEnabled: true } }`).
    // server.js reads these files once at boot, so they must be merged before the fork.
    if (this.options.set && typeof this.options.set === 'object') Object.assign(setCfg, this.options.set);
    if (this.options.settings && typeof this.options.settings === 'object') Object.assign(settingsCfg, this.options.settings);
    fs.writeFileSync(path.join(this.tmpDir, 'settings.json'), JSON.stringify(settingsCfg, null, 2));
    fs.writeFileSync(path.join(this.tmpDir, 'set.json'), JSON.stringify(setCfg, null, 2));

    const textbookDir = path.join(contentDir, 'accounts', 'test', 'profiles', 'test', 'worlds', 'test', 'textbooks', 'math');
    fs.mkdirSync(textbookDir, { recursive: true });
    fs.writeFileSync(path.join(textbookDir, 'pages.json'), JSON.stringify({
      format: 'markdown',
      pages: [
        { pageNum: 1, title: 'Page 1' },
        { pageNum: 2, title: 'Page 2' }
      ]
    }, null, 2));

    const practiceDir = path.join(contentDir, 'accounts', 'test', 'profiles', 'test', 'worlds', 'test', 'practice');
    fs.mkdirSync(practiceDir, { recursive: true });

    this.serverPort = await this.findFreePort();

    // The production Electron parent creates the secret and hands it to the
    // forked server.  Black-box tests create an equivalent test-only issuer so
    // requests exercise the real Authorization/capability path instead of the
    // removed X-Account-Id fallback.
    const capabilitySecret = Buffer.alloc(32, 0x5a);
    this.capabilityIssuer = localAuth.createInMemoryIssuer({
      testOnly: true,
      issuer: 'socratopia-electron',
      audience: 'adaptive-teaching',
      secret: capabilitySecret,
      currentAuthState: { accountId: 'test', sessionEpoch: 3 },
      scope: { accountId: 'test', profileId: '*', worldId: '*', textbookId: '*', conversationId: '*' }
    });

    const serverScript = path.join(__dirname, 'server.js');
    const silent = this.options.silent !== false;
    this.serverProcess = fork(serverScript, [], {
      env: {
        ...process.env,
        PORT: String(this.serverPort),
        HOSTNAME: '127.0.0.1',
        CONTENT_ROOT: contentDir,
        PROJECT_ROOT: this.tmpDir,
        SOCRATOPIA_ADAPTIVE_AUTH_SECRET_B64: capabilitySecret.toString('base64'),
        SOCRATOPIA_ADAPTIVE_AUTH_ISSUER: 'socratopia-electron'
      },
      silent: silent
    });

    if (silent) {
      this.serverProcess.stdout.on('data', (data) => {
        this.serverStdout += data.toString();
      });
      this.serverProcess.stderr.on('data', (data) => {
        this.serverStderr += data.toString();
      });
    }

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server start timeout after 30s'));
      }, 30000);

      let stdout = '';
      const onData = (data) => {
        stdout += data.toString();
        if (stdout.includes('Ready in') || stdout.includes('✓ Ready')) {
          this.ready = true;
          clearTimeout(timeout);
          resolve();
        }
      };

      if (silent) {
        this.serverProcess.stdout.on('data', onData);
      } else {
        this.serverProcess.stdout.on('data', onData);
      }

      this.serverProcess.on('exit', (code) => {
        if (!this.ready) {
          clearTimeout(timeout);
          reject(new Error('Server process exited before ready with code ' + code));
        }
      });
    });

    // The packaged Electron parent sends this authenticated account-state
    // handshake before ordinary routes can use the request fence.  Synthetic
    // HTTP smoke tests do not have the parent process, so install the same
    // deterministic fixture state and wait for the child ACK before issuing
    // requests.  This keeps the production fence strict instead of weakening
    // it just for tests.
    const sendAuthState = (sequence, sessionEpoch) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Auth-state ACK timeout')), 5000);
      const onMessage = (message) => {
        if (!message || message.type !== 'socratopia:auth-state-ack:v1') return;
        if (message.sequence !== sequence || message.accountId !== 'test' || message.sessionEpoch !== sessionEpoch || message.active !== true) {
          clearTimeout(timeout);
          reject(new Error('Auth-state ACK mismatch'));
          return;
        }
        clearTimeout(timeout);
        this.serverProcess.off('message', onMessage);
        resolve();
      };
      this.serverProcess.on('message', onMessage);
      this.serverProcess.send({
        type: 'socratopia:auth-state:v1',
        sequence: sequence,
        active: true,
        accountId: 'test',
        sessionEpoch: sessionEpoch
      });
    });
    await sendAuthState(1, 2);
    await sendAuthState(2, 3);
    // A duplicate ACK gives async account-bound coordinators one event-loop
    // turn to finish before the first HTTP request is issued.
    await sendAuthState(2, 3);
  }

  capabilityHeader() {
    if (!this.capabilityIssuer) throw new Error('capability issuer is not ready');
    return this.capabilityIssuer.authorizationHeader();
  }

  async teardown() {
    if (this.serverProcess) {
      this.serverProcess.kill();
      await new Promise(r => setTimeout(r, 1000));
    }
    await this.mockLLM.stop();
    try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch (e) {}
  }

  findFreePort() {
    return new Promise((resolve) => {
      const server = http.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
  }

  async get(url, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: this.serverPort,
        path: url,
        method: 'GET',
        headers: { ...extraHeaders }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  async post(url, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port: this.serverPort,
        path: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...extraHeaders
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  async postSSE(url, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port: this.serverPort,
        path: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...extraHeaders
        }
      }, (res) => {
        let raw = '';
        let text = '';
        res.on('data', chunk => {
          raw += chunk.toString();
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const payload = line.slice(6);
              if (payload === '[DONE]') continue;
              try {
                const obj = JSON.parse(payload);
                if (obj.choices && obj.choices[0]) {
                  if (obj.choices[0].delta && obj.choices[0].delta.content) {
                    text += obj.choices[0].delta.content;
                  }
                  if (obj.choices[0].message && obj.choices[0].message.content) {
                    text += obj.choices[0].message.content;
                  }
                }
                if (obj.type === 'text' && typeof obj.text === 'string') {
                  text += obj.text;
                }
              } catch (e) {}
            }
          }
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw, text }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}

module.exports = { MockLLM, TestEnvironment };

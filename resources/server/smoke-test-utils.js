// smoke-test-utils.js — 黑盒集成测试共享工具
// 位置: resources/server/smoke-test-utils.js
// 不依赖被测路由内部函数，仅通过 HTTP 与端口通信。
// 只使用 Node 内置模块；不读取真实 settings.json/set.json；不输出 API key。

const http = require('http');
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

class MockLLM {
  constructor() {
    this.responseBody = null;
    this.responseStatus = 200;
    this.requests = [];
    this.server = null;
    this.port = 0;
  }

  setResponse(body, status = 200) {
    this.responseBody = body;
    this.responseStatus = status;
    this.responseSequence = null;
    this.responseIndex = 0;
    this.responseGenerator = null;
  }

  setResponseSequence(responses) {
    this.responseSequence = responses;
    this.responseIndex = 0;
    this.responseBody = null;
    this.responseGenerator = null;
  }

  setResponseGenerator(fn) {
    this.responseGenerator = fn;
    this.responseBody = null;
    this.responseSequence = null;
  }

  getResponse(data) {
    if (this.responseGenerator) {
      const r = this.responseGenerator(data, this.requests.length);
      return { body: r.body, status: r.status || 200 };
    }
    if (this.responseSequence && this.responseIndex < this.responseSequence.length) {
      const entry = this.responseSequence[this.responseIndex++];
      return { body: entry.body, status: entry.status || 200 };
    }
    return { body: this.responseBody, status: this.responseStatus };
  }

  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.url === '/v1/chat/completions' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              this.requests.push({
                model: data.model,
                messages: data.messages,
                response_format: data.response_format,
                stream: data.stream
              });

              const { body: respBody, status: respStatus } = this.getResponse(data);

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
                res.write('data: {"choices":[{"delta":{"content":' + JSON.stringify(content) + '}}]}\n\n');
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

class TestEnvironment {
  constructor(options) {
    this.mockLLM = new MockLLM();
    this.serverProcess = null;
    this.tmpDir = path.join(__dirname, '_tmp_test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    this.serverPort = 0;
    this.ready = false;
    this.options = options || {};
    this.serverStdout = '';
    this.serverStderr = '';
  }

  async setup() {
    fs.mkdirSync(this.tmpDir, { recursive: true });
    const contentDir = path.join(this.tmpDir, 'content');
    fs.mkdirSync(contentDir, { recursive: true });

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
    fs.writeFileSync(path.join(this.tmpDir, 'settings.json'), JSON.stringify(settingsCfg, null, 2));
    fs.writeFileSync(path.join(this.tmpDir, 'set.json'), JSON.stringify(setCfg, null, 2));

    const textbookDir = path.join(contentDir, 'profiles', 'test', 'worlds', 'test', 'textbooks', 'math');
    fs.mkdirSync(textbookDir, { recursive: true });
    fs.writeFileSync(path.join(textbookDir, 'pages.json'), JSON.stringify({
      format: 'markdown',
      pages: [
        { pageNum: 1, title: 'Page 1' },
        { pageNum: 2, title: 'Page 2' }
      ]
    }, null, 2));

    const practiceDir = path.join(contentDir, 'profiles', 'test', 'worlds', 'test', 'practice');
    fs.mkdirSync(practiceDir, { recursive: true });

    this.serverPort = await this.findFreePort();

    const serverScript = path.join(__dirname, 'server.js');
    const silent = this.options.silent !== false;
    this.serverProcess = fork(serverScript, [], {
      env: {
        ...process.env,
        PORT: String(this.serverPort),
        HOSTNAME: '127.0.0.1',
        CONTENT_ROOT: contentDir,
        PROJECT_ROOT: this.tmpDir
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

    return new Promise((resolve, reject) => {
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

  async post(url, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port: this.serverPort,
        path: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
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

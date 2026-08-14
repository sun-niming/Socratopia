// Preview server launcher for Socratopia — replicates what main.js does via fork()
const path = require('path');
const { fork } = require('child_process');

const serverDir = path.resolve(__dirname, 'resources/server');
const contentRoot = path.resolve(__dirname, 'resources/bundled-content');
const userDataPath = path.join(require('os').homedir(), 'AppData', 'Roaming', 'socratopia', 'project-data');

const serverProcess = fork(path.join(serverDir, 'server.js'), [], {
  cwd: serverDir,
  env: {
    ...process.env,
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
    PROJECT_ROOT: userDataPath,
    CONTENT_ROOT: contentRoot,
    NODE_PATH: path.join(serverDir, '.next', 'node_modules')
  },
  stdio: 'pipe'
});

serverProcess.stdout.on('data', d => process.stdout.write(d));
serverProcess.stderr.on('data', d => process.stderr.write(d));
serverProcess.on('exit', (code) => {
  console.log(`[preview] Server exited with code ${code}`);
  process.exit(code);
});

process.on('SIGTERM', () => serverProcess.kill());
process.on('SIGINT', () => serverProcess.kill());

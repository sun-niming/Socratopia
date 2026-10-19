'use strict';

// Validate the material library against the shipped persona parser and storage.
// No running app, account files, network calls, or model credentials are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const root = __dirname;
const projectRoot = path.dirname(root);
const serverRoot = path.join(projectRoot, 'resources/server/.next/server');
const index = JSON.parse(fs.readFileSync(path.join(root, 'templates-index.json'), 'utf8'));
const mergeSource = fs.readFileSync(path.join(serverRoot, 'app/api/custom-companions/merge-persona/route.js'), 'utf8');
const frontendSource = fs.readFileSync(path.join(projectRoot,
  'resources/server/.next/static/chunks/app/page-3a1fef7566e26c43.js'), 'utf8');
for (const [key, limit] of Object.entries({ name: 20, identity: 60, personality: 100, persona: 1500 })) {
  assert(frontendSource.includes(`u.${key}?.length||0)>${limit}`), `Frontend ${key} limit changed; review the contract`);
}
const parserStart = mergeSource.indexOf('function(a){let b=a.split("\\n")');
const parserEnd = mergeSource.indexOf('}(k?.trim()||"")', parserStart);
assert(parserStart >= 0 && parserEnd > parserStart, 'Shipped header parser changed; review the contract');
const stripHeader = vm.runInNewContext(`(${mergeSource.slice(parserStart, parserEnd + 1)})`);
const genders = { female: '女', male: '男', neutral: '其他' };
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const ids = new Set();
const names = new Set();
const personas = new Map();

function materialFile(relativePath, label) {
  assert.equal(typeof relativePath, 'string', `${label}: missing path`);
  assert(!path.isAbsolute(relativePath) && !relativePath.includes('\\'), `${label}: use portable relative paths`);
  const absolutePath = path.resolve(root, relativePath);
  const resolved = path.relative(fs.realpathSync(root), fs.realpathSync(absolutePath));
  assert(resolved && !resolved.startsWith('..') && !path.isAbsolute(resolved), `${label}: outside library`);
  assert(fs.statSync(absolutePath).isFile(), `${label}: must reference a file`);
  return absolutePath;
}

check(index.schema === 'socratopia-custom-companion', 'Unexpected index schema');
check(Array.isArray(index.templates) && index.templates.length > 0, 'Empty template list');
const directories = fs.readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^\d{3}-/.test(entry.name)).map(entry => entry.name).sort();
check(JSON.stringify(directories) === JSON.stringify(index.templates.map(t => path.dirname(t.personaPath)).sort()),
  'Each character directory must appear in the index exactly once');

for (const template of index.templates) {
  const label = `${template.id} ${template.name}`;
  try {
    check(/^\d{3}$/.test(template.id) && !ids.has(template.id), `${label}: invalid/duplicate ID`);
    check(typeof template.name === 'string' && template.name.trim() && !names.has(template.name), `${label}: invalid/duplicate name`);
    ids.add(template.id);
    names.add(template.name);
    check(Object.hasOwn(genders, template.gender), `${label}: invalid gender`);
    check(template.age === null || (Number.isInteger(template.age) && template.age >= 0), `${label}: invalid age`);
    const persona = fs.readFileSync(materialFile(template.personaPath, label), 'utf8');
    for (const [key, limit] of Object.entries({ name: 20, identity: 60, personality: 100, persona: 1500 })) {
      const value = key === 'persona' ? persona : template[key];
      check(typeof value === 'string' && value.trim().length > 0 && value.length <= limit,
        `${label}: ${key} must be nonempty and within frontend limit ${limit}`);
    }
    personas.set(template.id, persona);
    materialFile(path.posix.join(path.posix.dirname(template.personaPath), '设定.md'), label);
    check(persona.startsWith(`# ${template.name}\n\n## 基本信息\n`), `${label}: unrecognized basic-info header`);
    for (const [key, value] of [['姓名', template.name], ['性别', genders[template.gender]], ['身份', template.identity], ['性格关键词', template.personality]]) {
      check(persona.includes(`- **${key}**：${value}\n`), `${label}: ${key} differs from metadata`);
    }
    check(template.age === null ? !persona.includes('- **年龄**：') : persona.includes(`- **年龄**：${template.age}岁\n`), `${label}: age differs from metadata`);
    const body = stripHeader(persona);
    check(body.startsWith('## 角色速写\n'), `${label}: merge leaves stale basic info in body`);
    check(!body.includes('- **姓名**：'), `${label}: duplicate name after merge`);
    for (const heading of ['说话方式', '教学风格', '情绪表现', '互动规则', '对话示例']) {
      check(body.includes(`\n## ${heading}\n`), `${label}: missing ${heading}`);
    }
    const renamed = `# 合并校验\n\n## 基本信息\n\n- **姓名**：合并校验\n\n---\n\n${body}`;
    check(stripHeader(renamed) === body, `${label}: repeated merge changes persona body`);
    check(!/绝不直接给答案|连续追问，直到|学会有价值的东西就下课|不讲解，只|半个时辰内/.test(body), `${label}: conflicting teaching directive`);
    check(!body.includes('[下课]'), `${label}: do not seed a literal end-class command`);
    check(!persona.includes('\uFFFD'), `${label}: broken text encoding`);
    const avatarPath = materialFile(template.avatarSourcePath, label);
    check(['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(avatarPath).toLowerCase()), `${label}: unsupported avatar format`);
    const bytes = fs.readFileSync(avatarPath);
    const ext = path.extname(avatarPath).toLowerCase();
    check(ext === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : ext === '.webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      : bytes[0] === 255 && bytes[1] === 216, `${label}: image signature differs from extension`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
  }
}

async function main() {
  assert.equal(failures.length, 0, `Template validation failed:\n${failures.join('\n')}`);
  const temporaryRoot = path.join(projectRoot, 'tmp');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const sandbox = fs.mkdtempSync(path.join(temporaryRoot, 'character-templates-'));
  try {
    const chunk = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(serverRoot, 'chunks/9964.js'), 'utf8'), chunk);
    const dependencies = {
      79748: fs.promises,
      29021: fs,
      33873: path,
      23952: (filename, value) => fs.promises.writeFile(filename, value),
      40969: { $x: () => sandbox }
    };
    const webpackRequire = id => {
      assert(Object.hasOwn(dependencies, id), `Unexpected storage dependency: ${id}`);
      return dependencies[id];
    };
    webpackRequire.d = (target, definitions) => {
      for (const [name, getter] of Object.entries(definitions)) Object.defineProperty(target, name, { get: getter });
    };
    webpackRequire.n = value => () => value;
    const api = {};
    chunk.exports.modules[19964]({}, api, webpackRequire);
    for (const template of index.templates) {
      const { name, gender, age, identity, personality } = template;
      const avatarPath = materialFile(template.avatarSourcePath, name);
      const saved = await api.qm({ name, gender, age, identity, personality }, personas.get(template.id), avatarPath);
      assert.match(saved.id, /^ct_[a-z0-9]{8}$/);
      assert.equal(await api.sG(saved.id), personas.get(template.id), `${name}: persona round trip`);
      const storedAvatar = await api.getCustomAvatarSourcePath(saved.id);
      assert(storedAvatar, `${name}: avatar discoverable by runtime`);
      const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
      assert.equal(hash(storedAvatar), hash(avatarPath), `${name}: avatar round trip`);
    }
    assert.equal((await api.listCustomTemplates()).length, index.templates.length);
    console.log(`PASS: ${index.templates.length} templates; frontend limits, metadata, merge/re-merge, material paths, image signatures, shipped storage/persona/avatar round trips.`);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

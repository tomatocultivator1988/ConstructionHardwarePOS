const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.resolve(__dirname);
const FRONTEND = path.resolve(ROOT, 'frontend');
const BACKEND_DIST = path.resolve(BACKEND, 'dist');
const FRONTEND_DIST = path.resolve(FRONTEND, 'dist');
const TARGET = path.resolve(BACKEND_DIST, 'frontend-dist');

function run(cmd, cwd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

// Step 1: Build frontend
console.log('\n=== Building frontend ===');
run('npm run build', FRONTEND);

// Step 2: Build backend (TypeScript)
console.log('\n=== Building backend ===');
run('npm run build', BACKEND);

// Step 3: Copy frontend dist into backend dist
console.log('\n=== Copying frontend dist ===');
if (fs.existsSync(TARGET)) fs.rmSync(TARGET, { recursive: true });
fs.cpSync(FRONTEND_DIST, TARGET, { recursive: true });
console.log(`Copied ${FRONTEND_DIST} -> ${TARGET}`);

// Step 4: Create data directory placeholder
const DATA_DIR = path.resolve(BACKEND_DIST, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, '.gitkeep'), '');
}

// Step 5: Package with pkg
console.log('\n=== Packaging with pkg ===');
run('npx pkg . --output BuildProPOS.exe', BACKEND);

console.log('\n=== Done! BuildProPOS.exe created in backend/ ===');

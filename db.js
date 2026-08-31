// Tiny JSON store with debounced writes. Data lives in ./data/*.json
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const pending = new Map();

function load(name, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
  } catch {
    return fallback;
  }
}

function save(name, data) {
  pending.set(name, data);
  if (pending.size > 1) return;
  setTimeout(() => {
    for (const [n, d] of pending) {
      try {
        fs.writeFileSync(path.join(DIR, `${n}.json`), JSON.stringify(d, null, 2));
      } catch (err) {
        console.error(`[db] save ${n} failed:`, err.message);
      }
    }
    pending.clear();
  }, 1500);
}

module.exports = { load, save };

// Chat XP: 5 XP per message (60s cooldown per user). Levels drive the Chat lvl roles.
// Curve: cumulative XP for level n = n * 100  ->  lvl 5 = 100 msgs, lvl 10 = 200 msgs.
const db = require('./db');

const XP_PER_MESSAGE = 5;
const COOLDOWN_MS = 60_000;

const users = db.load('xp', {}); // userId -> { xp, lastMsg }

function levelFor(xp) {
  return Math.floor(xp / 100);
}

async function handleMessage(message) {
  if (message.author.bot || !message.guild) return;
  const u = users[message.author.id] || { xp: 0, lastMsg: 0 };
  const now = Date.now();
  if (now - (u.lastMsg || 0) < COOLDOWN_MS) return;
  u.lastMsg = now;
  const oldLevel = levelFor(u.xp);
  u.xp += XP_PER_MESSAGE;
  users[message.author.id] = u;
  db.save('xp', users);

  const newLevel = levelFor(u.xp);
  if (newLevel > oldLevel && global.syncChatRoles) {
    await global.syncChatRoles(message.member, newLevel).catch(() => {});
  }
}

function rankOf(userId) {
  const u = users[userId];
  if (!u) return null;
  const level = levelFor(u.xp);
  return { xp: u.xp, level, intoLevel: u.xp - level * 100, nextIn: 100 - (u.xp - level * 100) };
}

function top(n = 10) {
  return Object.entries(users)
    .map(([id, u]) => ({ id, xp: u.xp, level: levelFor(u.xp) }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, n);
}

module.exports = { handleMessage, rankOf, top, XP_PER_MESSAGE };

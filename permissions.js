// CoreMC permission hierarchy + staff logging + punishment store.
// Single source of truth: every gate in the bot goes through can()/requirePerm().
// Levels are fixed; WHICH level each action needs is configurable (data/permissions.json overrides).
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

// ---------------------------------------------------------------- hierarchy
const L = { MEMBER: 0, HELPER: 1, MOD: 2, SR_MOD: 3, JR_ADMIN: 4, ADMIN: 5, MANAGER: 6 };
const LEVEL_NAME = Object.fromEntries(Object.entries(L).map(([k, v]) => [v, k]));
const RANK_KEY = { helper: 'HELPER', mod: 'MOD', srmod: 'SR_MOD', jradmin: 'JR_ADMIN', admin: 'ADMIN', manager: 'MANAGER', owner: 'MANAGER', trainee: null, media: null };

// default permission table (override via data/permissions.json, managed by /setpermission)
const DEFAULT_PERMS = {
  'ticket.general_support': 'HELPER',
  'ticket.media': 'HELPER',
  'ticket.punishment_appeal': 'JR_ADMIN',
  'ticket.refunds': 'JR_ADMIN',
  'ticket.manager': 'MANAGER',
  'ticket.close_general': 'HELPER',
  'ticket.close_sensitive': 'JR_ADMIN',
  'punishment.warn': 'HELPER',
  'punishment.T3': 'HELPER',
  'punishment.T5': 'MOD',
  'punishment.full': 'JR_ADMIN',
  'moderation.mute': 'HELPER',
  'moderation.kick': 'HELPER',
  'moderation.ban': 'MOD',
  'application.view': 'JR_ADMIN',
  'application.review': 'JR_ADMIN',
  'application.final_decision': 'ADMIN',
  'staff.view_logs': 'ADMIN',
  'staff.promote': 'ADMIN',
  'staff.demote': 'ADMIN',
  'staff.manage_manager': 'MANAGER',
  'permissions.edit': 'MANAGER',
  'bot.giveaway': 'JR_ADMIN',
  'bot.panel': 'JR_ADMIN',
  'notes.view': 'MEMBER',
  'notes.add': 'HELPER',
  'notes.remove': 'SR_MOD',
};

function permOverrides() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'permissions.json'), 'utf8')); } catch { return {}; }
}
function savePermOverrides(map) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'data', 'permissions.json'), JSON.stringify(map, null, 2));
}

function PERM(key) {
  const ov = permOverrides()[key];
  return ov && L[ov] !== undefined ? ov : DEFAULT_PERMS[key];
}

// ---------------------------------------------------------------- level of a member
function levelOf(member) {
  if (!member) return L.MEMBER;
  if (member.permissions?.has?.(require('discord.js').PermissionFlagsBits.Administrator)) return Math.max(levelFromRoles(member), L.ADMIN);
  return levelFromRoles(member);
}

function levelFromRoles(member) {
  const map = global.cfg?.staffRoleIds || {};
  let lvl = L.MEMBER;
  for (const [key, rid] of Object.entries(map)) {
    const lv = RANK_KEY[key] ? L[RANK_KEY[key]] : null;
    if (lv && rid && member.roles?.cache?.has(rid) && lv > lvl) lvl = lv;
  }
  // group roles: jrstaff = SR_MOD and below, higherstaff = JR_ADMIN and higher
  const groups = global.cfg?.staffGroupRoles || {};
  if (groups.jrstaff && member.roles?.cache?.has(groups.jrstaff)) lvl = Math.max(lvl, L.SR_MOD);
  if (groups.higherstaff && member.roles?.cache?.has(groups.higherstaff)) lvl = Math.max(lvl, L.JR_ADMIN);
  return lvl;
}

function rankName(level) { return LEVEL_NAME[level] || 'MEMBER'; }

// ---------------------------------------------------------------- gates
function can(member, permKey) {
  const need = L[PERM(permKey)];
  if (need === undefined) throw new Error(`unknown permission key: ${permKey}`);
  return levelOf(member) >= need;
}

// convenience for interactions: replies ephemeral denial when lacking
async function gate(interaction, permKey, note) {
  if (can(interaction.member, permKey)) return true;
  await interaction.reply({
    content: `❌ Requires **${rankName(L[PERM(permKey)])}** or higher${note ? ` (${note})` : ''}. Your rank: **${rankName(levelOf(interaction.member))}**.`,
    ephemeral: true,
  }).catch(() => {});
  return false;
}

// ---------------------------------------------------------------- punishments store
const PUNISH_FILE = () => path.join(__dirname, 'data', 'punishments.json');
function loadPunishments() {
  try { return JSON.parse(fs.readFileSync(PUNISH_FILE(), 'utf8')); } catch { return []; }
}
function savePunishments(list) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  fs.writeFileSync(PUNISH_FILE(), JSON.stringify(list, null, 2));
}
let caseCounter = null;
function nextCaseId() {
  if (caseCounter === null) caseCounter = loadPunishments().length;
  caseCounter += 1;
  return `C${String(caseCounter).padStart(4, '0')}-${Date.now().toString(36).toUpperCase()}`;
}

// tier caps: helpers T3, mods+ T5, jr admin+ unrestricted flag handling done by caller
function tierCapFor(level) { return level >= L.MOD ? 'T5' : 'T3'; }

async function recordPunishment({ type, tier, target, staff, reason, duration, evidence }) {
  const list = loadPunishments();
  const entry = {
    id: nextCaseId(),
    type, tier: tier || null,
    userId: target.id, userTag: target.tag ?? target.username ?? String(target),
    staffId: staff.id, staffTag: staff.tag ?? staff.username ?? String(staff),
    reason: reason || 'No reason provided',
    duration: duration || null,
    evidence: evidence || null,
    at: Date.now(),
  };
  list.push(entry);
  savePunishments(list);
  await log({
    title: `${typeIcon(type)} ${type}${entry.tier ? ` ${entry.tier}` : ''} issued`,
    fields: [
      { name: 'Case', value: `\`${entry.id}\``, inline: true },
      { name: 'Player', value: `<@${entry.userId}> (${entry.userTag})`, inline: true },
      { name: 'Staff', value: `<@${entry.staffId}>`, inline: true },
      { name: 'Reason', value: entry.reason },
      ...(entry.duration ? [{ name: 'Duration', value: entry.duration, inline: true }] : []),
      ...(entry.evidence ? [{ name: 'Evidence', value: entry.evidence.slice(0, 1000) }] : []),
    ],
    color: 0xed4245,
  });
  return entry;
}

function typeIcon(type) {
  return { Warning: '⚠️', Mute: '🔇', Kick: '👢', Ban: '🔨' }[type] || '📋';
}

function punishmentsOf(userId) { return loadPunishments().filter((p) => p.userId === userId); }

// ---------------------------------------------------------------- staff logging
const LOG_COLORS = { action: 0xfee75c, punish: 0xed4245, good: 0x57f287, info: 0x5865f2 };
async function log({ title, fields = [], color = 'action', extra = {} }) {
  try {
    const chId = global.cfg?.staffLogChannelId;
    if (!chId) return;
    const ch = global.client?.channels?.cache?.get(chId);
    if (!ch) return;
    const emb = new EmbedBuilder()
      .setColor(typeof color === 'string' ? LOG_COLORS[color] : color)
      .setTitle(title)
      .addFields(fields.length ? fields : [{ name: '\u200b', value: '\u200b' }])
      .setTimestamp();
    await ch.send({ embeds: [emb], ...extra });
  } catch (e) {
    console.error('[perms] log failed:', e.message);
  }
}

module.exports = {
  L, PERM, permOverrides, savePermOverrides, can, gate, levelOf, rankName,
  recordPunishment, punishmentsOf, loadPunishments, tierCapFor, log,
};

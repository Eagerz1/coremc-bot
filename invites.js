// Invite tracking -> key reward roles.
// 3 invites = Ruby Key | 5 = Monthly Key | 10 = Event Key
const db = require('./db');

const cfg = () => global.cfg;
const counts = db.load('invites', {}); // userId -> count

let inviteCache = new Map(); // code -> {uses, inviterId}

async function refreshGuildInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return false;
  inviteCache = new Map(invites.map((i) => [i.code, { uses: i.uses, inviterId: i.inviter?.id }]));
  return true;
}

async function findInvoker(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return null;
  for (const [code, inv] of invites) {
    const before = inviteCache.get(code);
    if (before && inv.uses > before.uses) {
      const inviterId = inv.inviter?.id;
      inviteCache.set(code, { uses: inv.uses, inviterId });
      return inviterId;
    }
    if (!before) inviteCache.set(code, { uses: inv.uses, inviterId: inv.inviter?.id });
  }
  // vanity / unknown source
  return null;
}

async function onMemberAdd(member) {
  if (!Array.isArray(global.cfg?.inviteRewards) || !global.cfg.inviteRewards.length) return null; // rewards disabled
  const inviterId = await findInvoker(member.guild);
  if (inviterId && inviterId !== member.id) {
    counts[inviterId] = (counts[inviterId] || 0) + 1;
    db.save('invites', counts);
    if (global.syncKeyRoles) await global.syncKeyRoles(inviterId).catch(() => {});
  }
  return inviterId;
}

function invitesOf(userId) {
  return counts[userId] || 0;
}

async function onMemberRemove(member) {
  const inv = await member.guild.invites.fetch().catch(() => null);
  if (!inv) return;
  for (const i of inv) {
    if (i.user?.bot) continue;
    if (i.uses === 0) continue;
    const inviter = await member.guild.members.fetch(i.inviter?.id?.toString()).catch(() => null);
    if (!inviter || inviter.id === member.id) continue;
    // check if this was an invite created before the member joined
    const createdAt = i.createdAt;
    const joinedAt = member.joinedAt;
    if (createdAt && joinedAt && createdAt > joinedAt) continue;
    if (counts[inviter.id] > 0) {
      counts[inviter.id]--;
      db.save('invites', counts);
    }
    break;
  }
}

function tierFor(n) {
  const tiers = cfg().inviteRewards || [];
  let best = null;
  for (const t of tiers) if (n >= t.invites) best = t;
  return best;
}

module.exports = { refreshGuildInvites, onMemberAdd, invitesOf, tierFor, counts };

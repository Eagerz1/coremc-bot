// CoreMC moderation & staff management commands (permission-hierarchy gated).
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const perms = require('./permissions');

// ---------------------------------------------------------------- helpers
function parseDuration(str) {
  if (!str) return null;
  const m = /^(\d+)([smhdw])$/i.exec(str.trim());
  if (!m) return null;
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2].toLowerCase()];
  return { ms: Number(m[1]) * mult, label: `${m[1]}${m[2].toLowerCase()}` };
}

function tierCheck(level, tierOpt) {
  const order = ['T1', 'T2', 'T3', 'T4', 'T5'];
  const cap = perms.tierCapFor(level);
  const t = (tierOpt || 'T3').toUpperCase();
  if (!order.includes(t)) return { ok: false, why: `Tier must be T1-T5.` };
  const overCap = order.indexOf(t) > order.indexOf(cap);
  return { ok: !overCap, t, cap, overCap };
}

async function replyLog(interaction, title, description, color) {
  const emb = new EmbedBuilder().setColor(color ?? 0xfee75c).setTitle(title).setDescription(description).setTimestamp();
  await interaction.reply({ embeds: [emb] });
}

async function dmPunish(target, { emoji, type, color, reason, staff, duration }) {
  const emb = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} ${type} — CoreMC`)
    .setDescription(
      [
        `**Action:** ${type}`,
        duration ? `**Duration:** ${duration}` : null,
        `**Reason:** ${reason || 'No reason provided'}`,
        `**Staff:** ${staff}`,
        '',
        'If you believe this is a mistake, open a **Punishment Appeal** ticket.',
      ].filter(Boolean).join('\n')
    )
    .setTimestamp();
  try { await target.send({ embeds: [emb] }).catch(() => {}); } catch {}
}

// ---------------------------------------------------------------- command defs
const commands = [
  new SlashCommandBuilder()
    .setName('warn').setDescription('Issue a warning (Helper+)')
    .addUserOption(o => o.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    .addStringOption(o => o.setName('evidence').setDescription('Link / screenshot reference')),
  new SlashCommandBuilder()
    .setName('mute').setDescription('Timeout a member in Discord (Helper+, max 7d)')
    .addUserOption(o => o.setName('user').setDescription('Member to mute').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('e.g. 10m, 1h, 1d, 1w').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder()
    .setName('unmute').setDescription('Remove Discord timeout (Moderator+)')
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder()
    .setName('kick').setDescription('Kick a member from Discord (Helper+)')
    .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ban').setDescription('Ban a member from Discord (Moderator+)')
    .addUserOption(o => o.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    .addIntegerOption(o => o.setName('days').setDescription('Delete message days (0-7)')),
  new SlashCommandBuilder()
    .setName('punishments').setDescription('Punishment history of a member (Moderator+)')
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder()
    .setName('stafflist').setDescription('Show the staff team by rank'),
  new SlashCommandBuilder()
    .setName('promote').setDescription('Promote a staff member one rank (Admin+, Manager for Manager)')
    .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true)),
  new SlashCommandBuilder()
    .setName('demote').setDescription('Demote a staff member one rank (Admin+, Manager for Manager)')
    .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true)),
  new SlashCommandBuilder()
    .setName('setpermission')
    .setDescription('Change required level for an action key (Manager+)')
    .addStringOption(o => o.setName('key').setDescription('e.g. ticket.player_report, punishment.T5').setRequired(true))
    .addStringOption(o =>
      o.setName('level').setDescription('Minimum level required').setRequired(true)
        .addChoices(
          { name: 'HELPER', value: 'HELPER' }, { name: 'MOD', value: 'MOD' },
          { name: 'SR_MOD', value: 'SR_MOD' }, { name: 'JR_ADMIN', value: 'JR_ADMIN' },
          { name: 'ADMIN', value: 'ADMIN' }, { name: 'MANAGER', value: 'MANAGER' }
        )),
].map(c => c.toJSON());

// ---------------------------------------------------------------- handlers
async function handle(interaction) {
  const cmd = interaction.commandName;
  const P = perms.L;

  switch (cmd) {
    case 'warn': {
      if (!await perms.gate(interaction, 'punishment.warn')) return;
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const evidence = interaction.options.getString('evidence');
      const entry = await perms.recordPunishment({ type: 'Warning', tier: null, target, staff: interaction.user, reason, evidence });
      await dmPunish(target, { emoji: '⚠️', type: 'Warning', color: 0xfee75c, reason, staff: interaction.user });
      return replyLog(interaction, `⚠️ Warning issued — ${entry.id}`, `${target} warned by ${interaction.user}\n**Reason:** ${reason}${evidence ? `\n**Evidence:** ${evidence}` : ''}`, 0xfee75c);
    }

    case 'mute': {
      if (!await perms.gate(interaction, 'moderation.mute')) return;
      const target = interaction.options.getUser('user');
      const dur = parseDuration(interaction.options.getString('duration'));
      if (!dur || dur.ms > 7 * 86400000) return interaction.reply({ content: '❌ Duration must be like `10m`, `1h`, `1d` (max 7d for Discord timeout).', ephemeral: true });
      const reason = interaction.options.getString('reason');
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ Member not found in this server.', ephemeral: true });
      if (perms.levelOf(member) >= perms.levelOf(interaction.member)) return interaction.reply({ content: '❌ You cannot mute an equal or higher-ranked staff member.', ephemeral: true });
      await member.timeout(dur.ms, `${reason} (by ${interaction.user.tag})`);
      await dmPunish(target, { emoji: '🔇', type: 'Mute', color: 0xfee75c, reason, staff: interaction.user, duration: dur.label });
      const entry = await perms.recordPunishment({ type: 'Mute', tier: null, target, staff: interaction.user, reason, duration: dur.label });
      return replyLog(interaction, `🔇 Muted — ${entry.id}`, `${target} muted for **${dur.label}** by ${interaction.user}\n**Reason:** ${reason}`, 0xfee75c);
    }

    case 'unmute': {
      if (!await perms.gate(interaction, 'punishment.T5')) return;
      const target = interaction.options.getUser('user');
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });
      await member.timeout(null, `Unmuted by ${interaction.user.tag}`);
      await perms.log({ title: '🔊 Mute lifted', fields: [{ name: 'Player', value: `<@${target.id}>`, inline: true }, { name: 'Staff', value: `${interaction.user}`, inline: true }], color: 'good' });
      return replyLog(interaction, '🔊 Unmuted', `${target} can speak again. Lifted by ${interaction.user}.`, 0x57f287);
    }

    case 'kick': {
      if (!await perms.gate(interaction, 'moderation.kick')) return;
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ Member not found.', ephemeral: true });
      if (perms.levelOf(member) >= perms.levelOf(interaction.member)) return interaction.reply({ content: '❌ You cannot kick an equal or higher-ranked staff member.', ephemeral: true });
      await dmPunish(target, { emoji: '👢', type: 'Kick', color: 0xed4245, reason, staff: interaction.user });
      await member.kick(`${reason} (by ${interaction.user.tag})`);
      const entry = await perms.recordPunishment({ type: 'Kick', tier: null, target, staff: interaction.user, reason });
      return replyLog(interaction, `👢 Kicked — ${entry.id}`, `${target} kicked by ${interaction.user}\n**Reason:** ${reason}`, 0xed4245);
    }

    case 'ban': {
      if (!await perms.gate(interaction, 'moderation.ban')) return;
      const target = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason');
      const days = Math.min(Math.max(interaction.options.getInteger('days') ?? 0, 0), 7);
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (member && perms.levelOf(member) >= perms.levelOf(interaction.member)) {
        return interaction.reply({ content: '❌ You cannot ban an equal or higher-ranked staff member.', ephemeral: true });
      }
      await dmPunish(target, { emoji: '🔨', type: 'Ban', color: 0xed4245, reason, staff: interaction.user });
      await interaction.guild.members.ban(target.id, { days, reason: `${reason} (by ${interaction.user.tag})` }).catch(e => {
        throw new Error(`ban failed: ${e.message}`);
      });
      const entry = await perms.recordPunishment({ type: 'Ban', tier: null, target, staff: interaction.user, reason });
      return replyLog(interaction, `🔨 Banned — ${entry.id}`, `${target} banned by ${interaction.user}\n**Reason:** ${reason}`, 0xed4245);
    }

    case 'punishments': {
      if (!await perms.gate(interaction, 'punishment.T5')) return;
      const target = interaction.options.getUser('user');
      const list = perms.punishmentsOf(target.id);
      if (!list.length) return interaction.reply({ content: `${target} has a clean record. ✨` });
      const lines = list.slice(-10).reverse().map(p =>
        `\`${p.id}\` **${p.type}**${p.tier ? ` ${p.tier}` : ''} — <t:${Math.floor(p.at / 1000)}:R> — ${p.reason} *(by <@${p.staffId}>)*`
      );
      const emb = new EmbedBuilder()
        .setColor(0x5865f2).setTitle(`📋 Punishment history — ${target.username}`)
        .setDescription(lines.join('\n')).setFooter({ text: `${list.length} total` });
      return interaction.reply({ embeds: [emb] });
    }

    case 'stafflist': {
      const map = global.cfg.staffRoleIds || {};
      const rows = [];
      for (const [key, label] of [['manager', 'MANAGER'], ['admin', 'ADMINISTRATOR'], ['jradmin', 'JUNIOR ADMINISTRATOR'], ['srmod', 'SENIOR MODERATOR'], ['mod', 'MODERATOR'], ['helper', 'HELPER']]) {
        const rid = map[key];
        const role = rid && interaction.guild.roles.cache.get(rid);
        const members = role ? [...role.members.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)) : [];
        rows.push(`**${label}** (${members.length})\n${members.length ? members.map(m => `· ${m}`).join('\n') : '· —'}`);
      }
      const emb = new EmbedBuilder().setColor(0x5865f2).setTitle('🛡 CoreMC Staff Team').setDescription(rows.join('\n\n')).setTimestamp();
      return interaction.reply({ embeds: [emb] });
    }

    case 'promote':
    case 'demote': {
      const isPromote = cmd === 'promote';
      if (!await perms.gate(interaction, isPromote ? 'staff.promote' : 'staff.demote')) return;
      const target = interaction.options.getUser('user');
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (!member) return interaction.reply({ content: '❌ Member not found in this server.', ephemeral: true });

      const LADDER = [
        ['trainee', 'TRAINEE'], ['media', 'MEDIA'], ['helper', 'HELPER'], ['mod', 'MODERATOR'],
        ['srmod', 'SENIOR MODERATOR'], ['jradmin', 'JUNIOR ADMINISTRATOR'], ['admin', 'ADMINISTRATOR'],
      ];
      // manager handled separately (only MANAGER may grant/revoke)
      const map = global.cfg.staffRoleIds || {};
      const managerRole = map.manager;

      let idx = LADDER.findIndex(([k]) => map[k] && member.roles.cache.has(map[k]));
      const isManagerNow = managerRole && member.roles.cache.has(managerRole);

      if (isPromote) {
        if (isManagerNow) return interaction.reply({ content: '❌ Already the highest rank.', ephemeral: true });
        if (idx === -1) idx = -1; // start at trainee
        const next = LADDER[idx + 1];
        if (!next) {
          // promote to MANAGER — requires staff.manage_manager (MANAGER)
          if (!await perms.gate(interaction, 'staff.manage_manager')) return;
          await member.roles.add(managerRole, `Promoted to Manager by ${interaction.user.tag}`);
          await perms.log({ title: '📈 Promotion', fields: [{ name: 'Staff', value: `${member}`, inline: true }, { name: 'New rank', value: '**MANAGER**', inline: true }, { name: 'By', value: `${interaction.user}` }], color: 'good' });
          return replyLog(interaction, '📈 Promoted', `${member} is now **MANAGER**.`, 0x57f287);
        }
        const [key, label] = next;
        if (idx >= 0) await member.roles.remove(map[LADDER[idx][0]], `Rank change by ${interaction.user.tag}`).catch(() => {});
        await member.roles.add(map[key], `Promoted to ${label} by ${interaction.user.tag}`);
        await perms.log({ title: '📈 Promotion', fields: [{ name: 'Staff', value: `${member}`, inline: true }, { name: 'Old rank', value: idx >= 0 ? LADDER[idx][1] : '—', inline: true }, { name: 'New rank', value: label, inline: true }, { name: 'By', value: `${interaction.user}` }], color: 'good' });
        return replyLog(interaction, '📈 Promoted', `${member} → **${label}**`, 0x57f287);
      }

      // demote
      if (isManagerNow) {
        if (!await perms.gate(interaction, 'staff.manage_manager')) return;
        await member.roles.remove(managerRole, `Demoted from Manager by ${interaction.user.tag}`);
        await perms.log({ title: '📉 Demotion', fields: [{ name: 'Staff', value: `${member}`, inline: true }, { name: 'Removed', value: 'MANAGER', inline: true }, { name: 'By', value: `${interaction.user}` }], color: 'punish' });
        return replyLog(interaction, '📉 Demoted', `${member} removed from **MANAGER**.`, 0xed4245);
      }
      if (idx === -1) return interaction.reply({ content: '❌ Not on the staff ladder (use /kick or remove roles manually for non-staff).', ephemeral: true });
      if (idx === 0) {
        await member.roles.remove(map[LADDER[0][0]], `Demoted out of staff by ${interaction.user.tag}`);
        await perms.log({ title: '📉 Demotion', fields: [{ name: 'Staff', value: `${member}`, inline: true }, { name: 'Removed', value: LADDER[0][1], inline: true }, { name: 'By', value: `${interaction.user}` }], color: 'punish' });
        return replyLog(interaction, '📉 Demoted', `${member} removed from staff entirely.`, 0xed4245);
      }
      const prev = LADDER[idx - 1];
      await member.roles.remove(map[LADDER[idx][0]], `Demotion by ${interaction.user.tag}`).catch(() => {});
      await member.roles.add(map[prev[0]], `Demoted to ${prev[1]} by ${interaction.user.tag}`);
      await perms.log({ title: '📉 Demotion', fields: [{ name: 'Staff', value: `${member}`, inline: true }, { name: 'Old rank', value: LADDER[idx][1], inline: true }, { name: 'New rank', value: prev[1], inline: true }, { name: 'By', value: `${interaction.user}` }], color: 'punish' });
      return replyLog(interaction, '📉 Demoted', `${member} → **${prev[1]}**`, 0xed4245);
    }

    case 'setpermission': {
      if (!await perms.gate(interaction, 'permissions.edit')) return;
      const key = interaction.options.getString('key');
      const level = interaction.options.getString('level');
      const overrides = perms.permOverrides();
      const before = perms.PERM(key) || '(unknown key)';
      if (!before || before === undefined) {
        return interaction.reply({ content: `❌ Unknown permission key \`${key}\`. Known keys are defined in permissions.js DEFAULT_PERMS.`, ephemeral: true });
      }
      overrides[key] = level;
      perms.savePermOverrides(overrides);
      await perms.log({
        title: '🔐 Permission changed',
        fields: [
          { name: 'Key', value: `\`${key}\``, inline: true },
          { name: 'Was', value: before, inline: true },
          { name: 'Now', value: level, inline: true },
          { name: 'Changed by', value: `${interaction.user}` },
        ],
        color: 'info',
      });
      return replyLog(interaction, '🔐 Permission updated', `\`${key}\` now requires **${level}** (was ${before}).`, 0x5865f2);
    }
  }
}

module.exports = { commands, handle };

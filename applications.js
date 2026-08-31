// CoreMC staff applications: forum-based, DM form flow, review-apps verdicts.
// Flow: /applications-panel -> user clicks role -> DM form (3 sections) ->
//       auto-submit -> forum post + review-apps card -> Admin+ verdict -> role granted.
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const perms = require('./permissions');

const APP_ROLES = {
  helper: { label: 'Helper', emoji: '🤝', roleId: () => global.cfg.staffRoleIds?.helper },
  mod:    { label: 'Mod',    emoji: '🛡️', roleId: () => global.cfg.staffRoleIds?.mod },
  srmod:  { label: 'Sr Mod', emoji: '⭐', roleId: () => global.cfg.staffRoleIds?.srmod },
};
const REAPPLY_COOLDOWN_MS = 7 * 24 * 3600 * 1000;

const db = () => require('./db');
const apps = () => db().load('applications', {});
const saveApps = (data) => db().save('applications', data);

function recordOf(userId) {
  return apps()[userId] || null;
}

function seniorStaffMember(member) {
  if (!member) return false;
  const r = global.cfg.staffRoleIds || {};
  const senior = [r.admin, r.developer, r.manager, r.owner].filter(Boolean);
  return (
    member.permissions?.has?.(require('discord.js').PermissionFlagsBits.Administrator) ||
    senior.some((rid) => member.roles?.cache?.has(rid))
  );
}
void seniorStaffMember; // kept for reference; gates now use perms.can()

// ---------------------------------------------------------------- panel
function panelEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📮 CoreMC Staff Applications')
    .setDescription(
      [
        '**Want to join the CoreMC staff team?**',
        '',
        'Pick the position you are applying for below.',
        'The bot will DM you a short form — complete all 3 sections',
        'and your application is submitted automatically.',
        '',
        `${APP_ROLES.helper.emoji} **${APP_ROLES.helper.label}** — first-line support, timeouts`,
        `${APP_ROLES.mod.emoji} **${APP_ROLES.mod.label}** — full chat moderation`,
        `${APP_ROLES.srmod.emoji} **${APP_ROLES.srmod.label}** — kicks, appeals, mentoring`,
        '',
        '*Applications are reviewed by Admin+. Lying = permanent blacklist.*',
      ].join('\n')
    )
    .setFooter({ text: 'CoreMC • Staff Recruitment' })
    .setTimestamp();
}

function panelRows() {
  return [
    new ActionRowBuilder().addComponents(
      ...Object.entries(APP_ROLES).map(([id, r]) =>
        new ButtonBuilder()
          .setCustomId(`app_apply_${id}`)
          .setLabel(r.label)
          .setEmoji(r.emoji)
          .setStyle(ButtonStyle.Primary)
      )
    ),
  ];
}

async function startPanel(interaction) {
  await interaction.channel.send({ embeds: [panelEmbed()], components: panelRows() });
  return interaction.reply({ content: '✅ Applications panel posted.', ephemeral: true });
}

// ---------------------------------------------------------------- DM form
function formEmbed(userId) {
  const rec = recordOf(userId);
  const role = APP_ROLES[rec.role];
  const s = rec.sections || {};
  const mark = (done) => (done ? '✅' : '⬜');
  return new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle(`${role.emoji} CoreMC Application — ${role.label}`)
    .setDescription(
      [
        'Complete all three sections below.',
        'Your application submits **automatically** when the last section is done.',
        '',
        `${mark(s.personal)} **1. Personal Details**`,
        `${mark(s.experience)} **2. Experience & Fit**`,
        `${mark(s.scenarios)} **3. Scenarios**`,
        '',
        `Progress: **${['personal', 'experience', 'scenarios'].filter((k) => s[k]).length}/3**`,
      ].join('\n')
    )
    .setFooter({ text: 'CoreMC • Staff Recruitment' });
}

function formRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('appsec_personal').setLabel('Personal Details').setEmoji('👤').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('appsec_experience').setLabel('Experience & Fit').setEmoji('💼').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('appsec_scenarios').setLabel('Scenarios').setEmoji('🎯').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function ensureDraft(user, roleKey) {
  const all = apps();
  let rec = all[user.id];
  if (!rec || rec.status === 'accepted' || rec.status === 'rejected' || rec.status === 'waitlisted') {
    // fresh draft (cooldown enforced at apply-button time)
    rec = { role: roleKey, sections: {}, status: 'draft', createdAt: Date.now() };
  }
  all[user.id] = rec;
  saveApps(all);
  return rec;
}

async function refreshDm(client, userId) {
  const all = apps();
  const rec = all[userId];
  if (!rec) return;
  const done = ['personal', 'experience', 'scenarios'].filter((k) => rec.sections[k]).length;
  const build = () => {
    if (done < 3) return { embeds: [formEmbed(userId)], components: formRows() };
    const rowless = formRows().map((r) => { r.components.forEach((c) => c.setDisabled(true)); return r; });
    return {
      embeds: [formEmbed(userId).setColor(0x57f287).setDescription('✅ **All sections complete — your application has been submitted!**\nVerdicts arrive here in your DMs.')],
      components: rowless,
    };
  };

  // refresh the DM form if present
  if (rec.dmMessageId) {
    try {
      const user = await client.users.fetch(userId);
      const dm = await user.createDM();
      const msg = await dm.messages.fetch(rec.dmMessageId);
      await msg.edit(build());
    } catch (e) {
      console.error('[apps] dm refresh failed:', e.message);
    }
  }
  // refresh the in-channel form if present (DM-blocked fallback)
  if (rec.channelMessageId) {
    try {
      const ch = await client.channels.fetch(rec.channelId).catch(() => null);
      if (ch) {
        const msg = await ch.messages.fetch(rec.channelMessageId).catch(() => null);
        if (msg) await msg.edit(build());
      }
    } catch (e) {
      console.error('[apps] channel refresh failed:', e.message);
    }
  }
}

async function onApplyButton(interaction, roleKey) {
  const role = APP_ROLES[roleKey];
  if (!role) return;

  const all = apps();
  const existing = all[interaction.user.id];

  // Cooldown only applies to DECIDED applications (accepted/rejected/waitlisted).
  // A stale draft/submitted record must NOT block starting a new application —
  // that was the bug where "won't send another" (an old draft locked the user out).
  if (existing && existing.decidedAt && Date.now() - existing.decidedAt < REAPPLY_COOLDOWN_MS && ['accepted', 'rejected', 'waitlisted'].includes(existing.status)) {
    const days = Math.ceil((REAPPLY_COOLDOWN_MS - (Date.now() - existing.decidedAt)) / 86400000);
    return interaction.reply({ content: `⏳ Your last application was ${existing.status}. You can re-apply in **${days} day${days === 1 ? '' : 's'}**.`, ephemeral: true });
  }

  const rec = await ensureDraft(interaction.user, roleKey);

  // Try to DM the form. If DMs are closed (server message-request gate), fall back
  // to posting the form inline in the channel so the user is never blocked.
  try {
    const dmMsg = await interaction.user.send({ embeds: [formEmbed(interaction.user.id)], components: formRows() });
    const all2 = apps();
    all2[interaction.user.id].dmMessageId = dmMsg.id;
    saveApps(all2);
    return interaction.reply({ content: `📬 Check your DMs — your **${role.label}** application form is waiting.`, ephemeral: true });
  } catch {
    void rec;
    // DM blocked: post the form right here in the channel instead.
    const all2 = apps();
    all2[interaction.user.id].dmBlocked = true;
    const sent = await interaction.channel.send({ content: `${interaction.user}`, embeds: [formEmbed(interaction.user.id)], components: formRows() }).catch(() => null);
    if (sent) {
      all2[interaction.user.id].channelMessageId = sent.id;
      all2[interaction.user.id].channelId = interaction.channel.id;
    }
    saveApps(all2);
    return interaction.reply({
      content: `📝 Couldn't DM you, so your **${role.label}** application form is posted right here — complete it below. (You can open DMs to keep it private.)`,
      ephemeral: true,
    });
  }
}

async function onSectionButton(interaction, section) {
  const rec = recordOf(interaction.user.id);
  if (!rec || !['personal', 'experience', 'scenarios'].includes(section)) {
    return interaction.reply({ content: 'Start a new application from the <#' + global.cfg.applicationsChannelId + '> channel.', ephemeral: true });
  }

  const modal = new ModalBuilder().setCustomId(`appmodal_${section}`).setTitle(sectionTitle(section));
  for (const f of fieldsFor(section)) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(f.builder)
    );
  }
  return interaction.showModal(modal);
}

function sectionTitle(section) {
  return { personal: 'Personal Details', experience: 'Experience & Fit', scenarios: 'Scenarios' }[section];
}

function fieldsFor(section) {
  const p = (customId, label, style, maxLength, required = true) =>
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label.slice(0, 45))
      .setStyle(style === 'long' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setMaxLength(maxLength)
      .setRequired(required);

  switch (section) {
    case 'personal':
      return [
        { key: 'name', builder: p('name', 'Full name', 'short', 100) },
        { key: 'pronouns', builder: p('pronouns', 'Pronouns', 'short', 50) },
        { key: 'timezone', builder: p('timezone', 'Timezone (e.g. GMT+2, EST)', 'short', 50) },
        { key: 'age', builder: p('age', 'Age', 'short', 3) },
      ];
    case 'experience':
      return [
        { key: 'pastExperience', builder: p('pastExp', 'Servers you have moderated/staffed', 'long', 1000, false) },
        { key: 'whyFit', builder: p('whyFit', 'Why would you be a good fit?', 'long', 1500) },
      ];
    case 'scenarios':
      return [
        { key: 'friendRuleBreak', builder: p('q1', 'A friend breaks a rule. What do you do?', 'long', 800) },
        { key: 'staffReport', builder: p('q2', 'A player reports a staff member abusing power.', 'long', 800) },
        { key: 'raidSpam', builder: p('q3', 'Chat is being raided with spam. Response?', 'long', 800) },
      ];
  }
}

async function onSectionModal(interaction, section) {
  const values = {};
  for (const f of fieldsFor(section)) values[f.key] = interaction.fields.getTextInputValue(f.builder.data.custom_id);

  const all = apps();
  const rec = all[interaction.user.id];
  if (!rec) return interaction.reply({ content: 'No application in progress.', ephemeral: true });

  rec.sections[section] = { values, at: Date.now() };
  saveApps(all);

  await interaction.reply({ content: `✅ **${sectionTitle(section)}** saved.`, ephemeral: true });
  const done = ['personal', 'experience', 'scenarios'].filter((k) => rec.sections[k]).length;
  if (done === 3 && rec.status !== 'submitted') {
    await finalizeApplication(interaction.client, interaction.user.id);
  }
  await refreshDm(interaction.client, interaction.user.id);
}

// ---------------------------------------------------------------- submit
function applicationEmbed(userId) {
  const rec = apps()[userId];
  const role = APP_ROLES[rec.role];
  const g = (section, key) => rec.sections[section]?.values[key] || '—';
  const e = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${role.emoji} Staff Application — ${role.label}`)
    .setDescription(`**Applicant:** <@${userId}>\n**User ID:** \`${userId}\`\n**Timezone:** ${g('personal', 'timezone')} · **Age:** ${g('personal', 'age')}`)
    .addFields(
      {
        name: '👤 Personal',
        value: `**Name:** ${g('personal', 'name')}\n**Pronouns:** ${g('personal', 'pronouns')}`,
        inline: false,
      },
      {
        name: '💼 Experience & Fit',
        value: `**Past staffing:** ${g('experience', 'pastExperience')}\n\n**Why a good fit:** ${g('experience', 'whyFit')}`,
        inline: false,
      },
      {
        name: '🎯 Scenarios',
        value: [
          `**Friend breaks a rule:** ${g('scenarios', 'friendRuleBreak')}`,
          ``,
          `**Staff abuse report:** ${g('scenarios', 'staffReport')}`,
          ``,
          `**Raid/spam response:** ${g('scenarios', 'raidSpam')}`,
        ].join('\n'),
        inline: false,
      }
    )
    .setFooter({ text: `Submitted ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}` });
  return e;
}

function verdictRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('appverdict_accept').setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('appverdict_reject').setLabel('Reject').setEmoji('❌').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('appverdict_waitlist').setLabel('Waitlist').setEmoji('⏳').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function finalizeApplication(client, userId) {
  const all = apps();
  const rec = all[userId];
  rec.status = 'submitted';
  rec.submittedAt = Date.now();
  saveApps(all);

  const review = client.channels.cache.get(global.cfg.reviewAppsChannelId);
  const role = APP_ROLES[rec.role];

  // 1. review-apps card
  if (review) {
    try {
      const msg = await review.send({
        content: `<@&${global.cfg.staffRoleIds?.admin}> new application ⬇️`,
        embeds: [applicationEmbed(userId)],
        components: verdictRows(),
      });
      rec.reviewMessageId = msg.id;
      saveApps(all);
    } catch (e) {
      console.error('[apps] review post failed:', e.message);
    }
  }

  // 3. log
  const logCh = client.channels.cache.get(global.cfg.logChannelId);
  if (logCh) {
    logCh.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle('Application submitted')
          .addFields(
            { name: 'Applicant', value: `<@${userId}>`, inline: true },
            { name: 'Position', value: role.label, inline: true }
          )
          .setTimestamp(),
      ],
    }).catch(() => {});
  }

  // 4. thank-you DM handled by refreshDm caller
}

// ---------------------------------------------------------------- verdicts
const VERDICTS = {
  accept: { label: 'Accepted', color: 0x57f287, emoji: '🎉' },
  reject: { label: 'Rejected', color: 0xed4245, emoji: '🟥' },
  waitlist: { label: 'Waitlisted', color: 0xfee75c, emoji: '⏳' },
};

async function onVerdictButton(interaction) {
  // final decision authority comes from the permission table (default: ADMIN)
  if (!perms.can(interaction.member, 'application.final_decision')) {
    return interaction.reply({ content: `❌ Final decisions require **${perms.rankName(perms.L[perms.PERM('application.final_decision')])}** or higher.`, ephemeral: true });
  }
  const verdictKey = interaction.customId.replace('appverdict_', '');
  const verdict = VERDICTS[verdictKey];
  if (!verdict) return;

  // resolve applicant from the embed in this message
  const all = apps();
  const entry = Object.entries(all).find(([, r]) => r.reviewMessageId === interaction.message.id);
  if (!entry) return interaction.reply({ content: 'Could not match this card to an applicant.', ephemeral: true });
  const [userId, rec] = entry;

  if (rec.status !== 'submitted') {
    return interaction.reply({ content: `This application was already **${rec.status}**.`, ephemeral: true });
  }
  rec.status = verdictKey === 'accept' ? 'accepted' : verdictKey === 'reject' ? 'rejected' : 'waitlisted';
  rec.decidedAt = Date.now();
  rec.decidedBy = interaction.user.id;
  saveApps(all);

  await perms.log({
    title: '📋 Application decided',
    fields: [
      { name: 'Applicant', value: `<@${userId}>`, inline: true },
      { name: 'Position', value: APP_ROLES[rec.role].label, inline: true },
      { name: 'Verdict', value: `${verdict.emoji} ${verdict.label}`, inline: true },
      { name: 'Decided by', value: `${interaction.user}`, inline: true },
    ],
    color: verdictKey === 'accept' ? 'good' : 'info',
  });

  // role grant on accept
  let grantedLine = '';
  if (verdictKey === 'accept') {
    const rid = APP_ROLES[rec.role].roleId();
    if (rid) {
      try {
        const member = await interaction.guild.members.fetch(userId);
        await member.roles.add(rid, `Staff application accepted by ${interaction.user.tag}`);
        grantedLine = `\n**Role granted:** <@&${rid}>`;
      } catch (e) {
        grantedLine = `\n⚠️ Failed to grant role: ${e.message}`;
      }
    }
  }

  // disable buttons + stamp verdict
  try {
    const rows = interaction.message.components.map((r) => {
      const row = ActionRowBuilder.from(r);
      row.components.forEach((c) => c.setDisabled(true));
      return row;
    });
    const emb = EmbedBuilder.from(interaction.message.embeds[0]);
    await interaction.message.edit({
      embeds: [emb.setColor(verdict.color).addFields({ name: 'Verdict', value: `${verdict.emoji} **${verdict.label}** by ${interaction.user}${grantedLine}` })],
      components: rows,
    });
  } catch {}

  // DM the applicant
  try {
    const user = await interaction.client.users.fetch(userId);
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(verdict.color)
          .setTitle(`${verdict.emoji} Application ${verdict.label}`)
          .setDescription(
            verdictKey === 'accept'
              ? `Congratulations! Your **${APP_ROLES[rec.role].label}** application was **accepted**.\nWelcome to the CoreMC team — your role has been added.\nCheck <#${global.cfg.staffGuideChannelId}> for the handbook.`
              : verdictKey === 'reject'
                ? `Thank you for applying for **${APP_ROLES[rec.role].label}**. This time it was not successful.\nYou may re-apply in 7 days — keep being active!`
                : `Your **${APP_ROLES[rec.role].label}** application has been placed on the **waitlist**.\nKeep active — management will reach out if a slot opens.`
          )
          .setFooter({ text: 'CoreMC • Staff Recruitment' })
          .setTimestamp(),
      ],
    });
  } catch {}

  return interaction.reply({ content: `${verdict.emoji} Marked **${verdict.label}** — applicant notified.`, ephemeral: true });
}

module.exports = {
  startPanel,
  onApplyButton,
  onSectionButton,
  onSectionModal,
  onVerdictButton,
  panelEmbed,
  panelRows,
};

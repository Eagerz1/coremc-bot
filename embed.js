// Shared "premium" embed theme for CoreMC.
const { EmbedBuilder } = require('discord.js');

const BRAND = {
  name: 'CoreMC',
  color: 0x00e5ff, // accent — change in config.embedColor
  icon: 'https://cdn.discordapp.com/icons/1517150559453319328/fba15367bf7a7afb4ad40a36bd0045fc.png',
};

function brandEmbed(opts = {}) {
  const e = new EmbedBuilder()
    .setColor(opts.color ?? global.cfg?.embedColor ?? BRAND.color)
    .setAuthor({ name: BRAND.name, iconURL: BRAND.icon })
    .setThumbnail(BRAND.icon);
  if (opts.title) e.setTitle(opts.title);
  if (opts.description) e.setDescription(opts.description);
  if (opts.fields) {
    for (const f of opts.fields) e.addFields({ name: f.name, value: f.value, inline: f.inline ?? false });
  }
  if (opts.footer !== false) {
    e.setFooter({ text: opts.footerText || `${BRAND.name} • ${new Date().getFullYear()}`, iconURL: BRAND.icon });
  }
  if (opts.timestamp) e.setTimestamp();
  return e;
}

const INVITER_ROLE = '1517268737927938068';

function inviteRewardsEmbed() {
  return brandEmbed({
    title: '🎉 Invite Rewards',
    description: ':gift: Invite your friends and climb the reward ladder.',
    fields: [
      { name: '3 Invites', value: `<@&${INVITER_ROLE}> — **Inviter Role**`, inline: true },
      { name: '5 Invites', value: 'Inviter Tag **(in-game)**', inline: true },
      { name: '10 Invites', value: '**Event Key**', inline: true },
      { name: '15 Invites', value: '**3× Monthly Key**', inline: true },
      { name: '20 Invites', value: '**1,000 Credits**', inline: true },
      { name: '25 Invites', value: '1× Event Key **+ 1,000 Credits**', inline: true },
    ],
  });
}

function boosterRewardsEmbed() {
  return brandEmbed({
    title: '🚀 Booster Rewards',
    description: ':rocket: Boost the server and unlock exclusive perks.',
    fields: [
      { name: '1 Boost', value: '**1× Boost Key**', inline: true },
      { name: '2 Boosts', value: '**2× Boost Keys**', inline: true },
      { name: '3 Boosts', value: '**Custom Giveaways**', inline: true },
      { name: '5 Boosts', value: '**700 Free Credits** + 5× Boost Keys', inline: true },
    ],
  });
}

module.exports = { brandEmbed, BRAND, inviteRewardsEmbed, boosterRewardsEmbed };

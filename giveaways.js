// /giveaway wizard + live giveaways.
// Flow: /giveaway -> ephemeral modal (title, winners, duration h, prize)
//       -> "Next" posts an ephemeral preview w/ Publish + Cancel buttons.
// NOTE: the old version embedded the full giveaway JSON into the button customId,
// which exceeded Discord's 100-char customId limit and made Publish fail
// ("something went wrong"). We now use a short pending key instead.
const db = require('./db');

const giveaways = db.load('giveaways', {}); // msgId -> {channelId,title,winners,endAt,prize,roleReq,entries:[],hostId}

const pending = new Map(); // key -> {title,winners,hours,prize}
let pendingSeq = 0;
function nextPendingKey() { return `gw_${Date.now().toString(36)}_${(pendingSeq++).toString(36)}`; }

function activeList() {
  return Object.entries(giveaways).filter(([, g]) => g.endAt > Date.now());
}

async function startWizard(interaction) {
  const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  const modal = new ModalBuilder().setCustomId('gw_modal').setTitle('New Giveaway');
  modal.addComponents(
    row('gw_title', 'Giveaway title', 'e.g. 10x Sky Gems', false),
    row('gw_winners', 'Number of winners', '1', true),
    row('gw_hours', 'Duration (hours)', '24', true),
    row('gw_prize', 'Prize (shown on embed)', 'Sky Gems x10', false)
  );
  return interaction.showModal(modal);
}

function row(id, label, placeholder, required) {
  const { ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(required)
  );
}

async function handleModal(interaction) {
  const title = interaction.fields.getTextInputValue('gw_title') || 'Giveaway';
  const winners = Math.max(1, parseInt(interaction.fields.getTextInputValue('gw_winners') || '1', 10) || 1);
  const hours = Math.max(1, Math.min(720, parseInt(interaction.fields.getTextInputValue('gw_hours') || '24', 10) || 24));
  const prize = interaction.fields.getTextInputValue('gw_prize') || '';

  const key = nextPendingKey();
  pending.set(key, { title, winners, hours, prize });

  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const previewEmbed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle(title)
    .setDescription(
      `React with 🎉 to enter!\n\n` +
        `**Prize:** ${prize || title}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor((Date.now() + hours * 3600_000) / 1000)}:R>`
    )
    .setFooter({ text: 'CoreMC • Giveaways' });

  const rowBtns = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gw_publish_${key}`).setLabel('Next — Publish').setEmoji('📣').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('gw_cancel').setLabel('Cancel').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
  );

  return interaction.reply({ embeds: [previewEmbed], components: [rowBtns], ephemeral: true });
}

async function publish(interaction, key) {
  const p = pending.get(key);
  if (!p) return interaction.reply({ content: '❌ Giveaway preview expired — please start again with /giveaway.', ephemeral: true });
  pending.delete(key);

  const channel = interaction.channel;
  const endAt = Date.now() + p.hours * 3600_000;

  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🎉 ${p.title}`)
    .setDescription(
      `React with 🎉 to enter!\n\n` +
        `**Prize:** ${p.prize || p.title}\n**Winners:** ${p.winners}\n**Ends:** <t:${Math.floor(endAt / 1000)}:R>`
    )
    .setFooter({ text: 'CoreMC • Giveaways' });

  const msg = await channel.send({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gw_enter').setLabel('Join').setEmoji('🎉').setStyle(ButtonStyle.Primary)),
    ],
  });

  giveaways[msg.id] = {
    channelId: channel.id,
    guildId: interaction.guildId,
    title: p.title,
    prize: p.prize || p.title,
    winners: p.winners,
    roleReq: '',
    endAt,
    hostId: interaction.user.id,
    entries: [],
    announced: false,
  };
  db.save('giveaways', giveaways);

  scheduleDraw(msg.id);
  return interaction.update({ content: '✅ Giveaway published below.', embeds: [], components: [] });
}

function scheduleDraw(msgId) {
  const g = giveaways[msgId];
  if (!g || g.announced) return;
  const ms = Math.max(2000, g.endAt - Date.now());
  setTimeout(() => draw(msgId).catch((e) => console.error('[gw] draw failed:', e.message)), ms);
}

async function draw(msgId) {
  const discord = require('discord.js');
  const g = giveaways[msgId];
  if (!g || g.announced) return;
  g.announced = true;
  db.save('giveaways', giveaways);

  const client = global.client;
  const channel = client.channels.cache.get(g.channelId);
  if (!channel) return delete giveaways[msgId];

  let msg = null;
  try {
    msg = await channel.messages.fetch(msgId);
  } catch {}

  const eligible = [...new Set(g.entries)];
  const winners = [];
  while (eligible.length && winners.length < g.winners) {
    winners.push(eligible.splice(Math.floor(Math.random() * eligible.length), 1)[0]);
  }

  const embed = discord.EmbedBuilder.from(msg?.embeds[0] || { title: g.title })
    .setColor(winners.length ? 0x5865f2 : 0xed4245)
    .setDescription(
      winners.length
        ? `**Winner(s):** ${winners.map((id) => `<@${id}>`).join(', ')}\\nContact staff to claim **${g.prize}**!`
        : 'Not enough entries — no winner this time.'
    );

  if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
  await channel.send({
    content: winners.length ? `🎉 Congratulations ${winners.map((id) => `<@${id}>`).join(', ')} — you won **${g.title}**!` : undefined,
    embeds: [],
  }).catch(() => {});

  setTimeout(() => delete giveaways[msgId], 60_000);
  db.save('giveaways', giveaways);
}

async function onButton(interaction) {
  if (interaction.customId === 'gw_cancel') {
    return interaction.update({ content: '🗑️ Giveaway cancelled.', embeds: [], components: [] });
  }
  if (interaction.customId.startsWith('gw_publish_')) {
    return publish(interaction, interaction.customId.replace('gw_publish_', ''));
  }
  if (interaction.customId === 'gw_enter') {
    const g = giveaways[interaction.message.id];
    if (!g) return interaction.reply({ content: 'This giveaway has ended.', ephemeral: true });
    if (Date.now() > g.endAt) return interaction.reply({ content: '⌛ This giveaway has ended.', ephemeral: true });
    if (g.entries.includes(interaction.user.id)) {
      return interaction.reply({ content: 'You are already entered. Good luck!', ephemeral: true });
    }
    g.entries.push(interaction.user.id);
    db.save('giveaways', giveaways);
    return interaction.reply({ content: `✅ You're in! (${g.entries.length} entr${g.entries.length === 1 ? 'y' : 'ies'})`, ephemeral: true });
  }
}

module.exports = { startWizard, handleModal, onButton, activeList, scheduleDraw };

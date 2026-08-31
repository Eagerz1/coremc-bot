// Welcome system: banner card for new members.
const path = require('path');

const BANNER = path.join(__dirname, 'assets', 'coremc-welcome.png');

// member: GuildMember, invitedLine: e.g. "was invited by **user**" or "just joined the server"
function buildWelcomeCard(member, invitedLine) {
  return {
    files: [{ attachment: BANNER, name: 'coremc-welcome.png' }],
    embeds: [
      {
        color: 0x5865f2,
        description: `**Welcome ${member}**\n${member.user.username} ${invitedLine} — you are member #${member.guild.memberCount}`,
        image: { url: 'attachment://coremc-welcome.png' },
        footer: { text: 'CoreMC • Skyblock' },
      },
    ],
  };
}

module.exports = { buildWelcomeCard };

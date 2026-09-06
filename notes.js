// CoreMC Staff Player Notes system
// Uses the bot's existing db.js storage (data/notes.json) for persistence across restarts.
// All identifiers use Discord user IDs (permanent). Note content is sanitized to prevent mentions/pings.

const { EmbedBuilder } = require('discord.js');
const { load: dbLoad, save: dbSave } = require('./db');

// ---------- persistence helpers ----------
function loadNotes() { return dbLoad('notes', []); }
function saveNotes(notes) { dbSave('notes', notes); }

// ---------- sanitize content: escape @everyone @here and user mentions ----------
function sanitize(content) {
  if (typeof content !== 'string') return content;
  // Insert a zero-width space after every '@' so Discord parses no user
  // mention, @everyone/@here, or role ping out of the stored text.
  return content.replace(/@/g, '@\u200b');
}

// ---------- core actions ----------

/** Add a note for a user. Returns the new note object. */
async function addNote({ userId, username, noteId, content, staffId, staffUsername }) {
  const notes = loadNotes();
  const sanitized = sanitize(content);
  const entry = {
    id: noteId,
    userId,
    username, // username at creation time (preserved even if user changes name)
    content: sanitized,
    staffId,
    staffUsername,
    at: Date.now(),
  };
  notes.push(entry);
  // keep only the 500 most recent notes to avoid massive files
  if (notes.length > 500) notes.shift(); // remove oldest
  saveNotes(notes);
  return entry;
}

/** Get all notes for a Discord user ID, newest first. */
function notesOf(userId) {
  return loadNotes()
    .filter((n) => n.userId === userId)
    .sort((a, b) => b.at - a.at); // newest first
}

/** Remove a specific note by noteId for a user. Returns the removed note or null. */
async function removeNote({ userId, noteId, staffId, staffUsername }) {
  const notes = loadNotes();
  const idx = notes.findIndex((n) => n.userId === userId && n.id === noteId);
  if (idx === -1) return null;
  const removed = notes.splice(idx, 1)[0];
  saveNotes(notes);
  return removed;
}

// ---------- embed builders ----------

function noteEmbed(entry, title) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title || '📝 Player Note')
    .addFields(
      { name: 'Note ID', value: `\`${entry.id}\``, inline: true },
      { name: 'User', value: `<@${entry.userId}> (${entry.username})`, inline: true },
      { name: 'Staff', value: `<@${entry.staffId}>`, inline: true },
      { name: 'Date', value: `<t:${Math.floor(entry.at / 1000)}:F>`, inline: true },
      { name: 'Content', value: entry.content, inline: false }
    )
    .setTimestamp(entry.at);
}

function listNotesEmbed(userId, username, notes) {
  if (!notes.length) {
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📝 Notes for ${username || 'User'}`)
      .setDescription('No notes found for this user.');
  }
  const fields = notes.map((n) => ({
    name: `Note \`${n.id}\``,
    value: `**Staff**: <@${n.staffId}>\n**Date**: <t:${Math.floor(n.at / 1000)}:F>\n**Content**: ${n.content}`,
    inline: false,
  }));
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📝 Notes for ${username || 'User'}`)
    .addFields(...fields)
    .setTimestamp();
}

module.exports = {
  addNote,
  notesOf,
  removeNote,
  noteEmbed,
  listNotesEmbed,
  sanitize,
};
# Partnership Ticket System

## Trigger
Use when managing server partnership proposals — Manager+ only.

## Behavior
Handles the full partnership proposal flow: ticket creation, DM requirements, user agreement, proof verification, and manager approval/denial.

## Channel Creation
- Creates `#partner` ticket channel with Manager+ permissions
- Auto-creates `#player-notes` channel if missing
- Creates `#partnerships` channel for approved ads

## Commands
- `/partner` — Opens partner ticket (Manager+ only)
- `/note add <user> <note>` — Add a persistent player note
- `/notes <user>` — List all notes for a user (newest first)
- `/note remove <user> <noteID>` — Remove a specific note

## Partner Ticket Flow
1. Manager+ clicks 🤝 Partner in ticket panel
2. Bot DMs user with ad requirements (member count, minimums)
3. User clicks **Agree** or **Disagree** in ticket
4. If Agree: User posts ad screenshot in ticket
5. Bot verifies member count against `minMemberCount` config
6. Bot posts ad to `#partnerships` channel with `@everyone` ping
7. Bot pings `Partnership Manager` role with "is this good proof yes or no"
8. If Yes: Bot closes ticket
9. If No: Partnership manager handles the rest

## Permissions
- `notes.view` — View player notes
- `notes.add` — Add player notes (Helper+)
- `notes.remove` — Remove player notes (SR_MOD+)

## Config Values
- `adChannelId` — Channel where ad requirements are DM'd
- `minMemberCount` — Minimum member requirements for partnership
- `partnershipsChannelId` — Channel for approved partnership ads
- `partnershipManagerRoleId` — Role that approves/denies proofs

## Verification
- `npm test` — selftest OK
- `node -c index.js` — syntax check passes
- Deploy via SFTP — all files verified
- No stray node processes

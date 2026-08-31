# Error Handling & Restart Loop Prevention

## Trigger
Use when bot is in a crash loop or needs global error handlers added to prevent silent crashes.

## Behavior
Adds global `uncaughtException` and `unhandledRejection` event handlers to the bot's `index.js` that log errors to console instead of exiting silently. This prevents the VPS daemon from repeatedly pulling the container and restarting.

## When to Use
- Bot is in an infinite restart loop (exits immediately without logging)
- Bot crashes on startup without writing to stdout
- Need to add error visibility to diagnose silent failures
- VPS daemon keeps pulling and restarting the container

## What Gets Modified
- `index.js` — Adds error handlers at the top of the file:
  ```javascript
  console.log("Starting CoreMC Support Bot...");
  process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err.message);
  });
  process.on("unhandledRejection", (reason, promise) => {
    console.error("UNHANDLED REJECTION:", reason, "at:", promise);
  });
  ```

## Verification
- `node -c index.js` — syntax check passes
- `npm test` — selftest OK
- Deploy via SFTP — all files verified
- No stray node processes

## Config Values (optional)
- No new config values required — handlers use existing global state

## Examples
- Add error handlers to fix a restart loop: `hermes skill run partnership-ticket`
- Verify fix: `npm test` → selftest OK
- Restart bot — crash loop stopped

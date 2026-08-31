# CRLF Line-Ending Corruption Fix

- Cause: Windows carriage returns (\r\n) corrupt `await` keywords in `index.js`
- Fix: `sed -i 's/\r$//' index.js` or use `unix2dos`
- Verify: `node -c index.js` → syntax OK
- After fix: `npm test` → selftest OK

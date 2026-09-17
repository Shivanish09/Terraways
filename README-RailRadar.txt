Terraways server update — RailRadar train integration

Replace the existing server.js in your Terraways project with the included server.js.

Train provider:
- RailRadar API
- Base URL: https://api.railradar.in
- Authentication: Authorization: Bearer <API key>
- Train search: /v1/trains/between/{from}/{to}?date=YYYY-MM-DD
- Station search: /v1/lookup/search/stations?q=...&limit=10

Environment variable:
- Preferred: RAILRADAR_API_KEY=your_key
- For compatibility, the code also accepts the existing INDIANRAIL_API_KEY variable, so you do not have to rename it immediately.

Keep API keys only in .env. Do not publish .env or commit it to Git.

After replacing server.js:
1. Stop the running server with Ctrl+C.
2. Run npm start.
3. Test Train -> Bhopal -> Rewa.

This zip intentionally does NOT include .env or any secret keys.

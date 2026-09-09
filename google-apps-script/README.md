# FastSplit backend

Paste `Code.gs` into a standalone Apps Script project. Run `setupFastSplit` once and authorize it. This creates the private Google Sheets database and hourly cleanup trigger automatically. See the root [README](../README.md) for deployment, API configuration, OCR properties, ownership limits and testing instructions.

`appsscript.json` provides the V8 runtime, timezone and explicit required scopes if you enable the manifest in Project Settings. Never commit Script properties or OAuth credentials.

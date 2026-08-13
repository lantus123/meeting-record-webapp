# Architecture

```text
Google Sites
  └─ embeds Apps Script Web App
       ├─ HTML Service: form + A4 print view
       ├─ google.script.run: authenticated RPC boundary
       ├─ localStorage: device-side autosave and JSON fallback
       └─ Apps Script server
            ├─ Script Properties: Sheet ID, retention, token pepper
            ├─ LockService: serialize Sheet mutations
            ├─ Session temporary user key: best-effort automatic draft list
            ├─ hashed continuation token: reliable cross-device access
            ├─ private Google Sheet: short-lived records
            └─ daily trigger: expired-record cleanup

GitHub
  └─ source code, validation workflow, documentation
```

## Why the page is served by Apps Script

Keeping the front end and server functions in one Apps Script deployment avoids a public cross-origin API and lets the browser call server methods through `google.script.run`. GitHub Pages is not required for the production page; GitHub remains the code repository.

## Record authorization

A server operation is allowed when either condition is true:

1. The current temporary user-key hash matches `ownerKeyHash`.
2. The presented continuation token hashes to `accessTokenHash`.

Raw temporary keys and raw continuation tokens are never written to the Sheet.

## Failure behavior

- Before setup or during a network failure, the form continues in local-only mode.
- Local records are automatically written after edits.
- JSON export/import provides a manual recovery route.
- A cloud deletion failure does not silently remove the local item, preventing a supposedly deleted cloud record from reappearing later.

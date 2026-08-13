const APP_TITLE = '科、部研討會記錄單';

/**
 * Apps Script Web App entry point.
 * ALLOWALL is required for embedding the deployed app in Google Sites.
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  const requested = e && e.parameter ? e.parameter.record : '';
  template.requestedRecordId = sanitizeRecordId_(requested);

  return template.evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Returns runtime settings and all active records associated with the current
 * temporary user key. A record opened through a continuation link is included
 * when its access token is valid, even if it is not in the automatic list.
 */
function bootstrapApp(requestedRecordId, accessToken) {
  ensureConfigured_();
  maybeCleanupExpiredRecords_();

  const config = getRuntimeConfig_();
  const ownerHash = getOwnerHash_();
  const records = listRecordsForOwner_(ownerHash);
  const normalizedId = sanitizeRecordId_(requestedRecordId);

  if (normalizedId) {
    const requested = getAuthorizedRecord_(normalizedId, accessToken, ownerHash);
    if (requested && !records.some(function (record) { return record.id === requested.id; })) {
      records.unshift(requested);
    }
  }

  return {
    config: {
      retentionDays: config.retentionDays,
      maxSummaryChars: MAX_SUMMARY_CHARS,
      webAppUrl: ScriptApp.getService().getUrl() || '',
      userKeyAvailable: Boolean(ownerHash)
    },
    records: records,
    requestedRecordId: normalizedId
  };
}

function listRecords() {
  ensureConfigured_();
  maybeCleanupExpiredRecords_();
  return listRecordsForOwner_(getOwnerHash_());
}

function getRecord(recordId, accessToken) {
  ensureConfigured_();
  maybeCleanupExpiredRecords_();
  return getAuthorizedRecord_(recordId, accessToken, getOwnerHash_());
}

function saveRecord(record, accessToken) {
  ensureConfigured_();
  return upsertRecord_(record, accessToken);
}

function issueAccessToken(recordId, accessToken) {
  ensureConfigured_();
  return rotateAccessToken_(recordId, accessToken, getOwnerHash_());
}

function deleteRecord(recordId, accessToken) {
  ensureConfigured_();
  return deleteRecord_(recordId, accessToken, getOwnerHash_());
}

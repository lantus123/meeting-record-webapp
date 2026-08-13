const RECORD_SHEET_NAME = 'Records';
const SCHEMA_VERSION = 1;
const MAX_SUMMARY_CHARS = 35000;
const MAX_RECORDS_PER_USER = 100;
const MAX_JSON_CELL_CHARS = 48000;

const RECORD_HEADERS = Object.freeze([
  'recordId',
  'ownerKeyHash',
  'accessTokenHash',
  'department',
  'meetingDate',
  'topic',
  'dataJson',
  'createdAt',
  'updatedAt',
  'expiresAt',
  'schemaVersion'
]);

const COL = Object.freeze({
  ID: 0,
  OWNER_HASH: 1,
  TOKEN_HASH: 2,
  DEPARTMENT: 3,
  MEETING_DATE: 4,
  TOPIC: 5,
  DATA_JSON: 6,
  CREATED_AT: 7,
  UPDATED_AT: 8,
  EXPIRES_AT: 9,
  SCHEMA_VERSION: 10
});

function getRuntimeConfig_() {
  const properties = PropertiesService.getScriptProperties();
  return {
    spreadsheetId: String(properties.getProperty('SPREADSHEET_ID') || '').trim(),
    tokenPepper: String(properties.getProperty('TOKEN_PEPPER') || '').trim(),
    retentionDays: clampInteger_(properties.getProperty('RETENTION_DAYS'), 1, 90, 14)
  };
}

function ensureConfigured_() {
  const config = getRuntimeConfig_();
  if (!config.spreadsheetId || !config.tokenPepper) {
    throw new Error('尚未完成系統初始化。請專案擁有者在 Apps Script 編輯器執行 setupProject()。');
  }
}

function getRecordsSheet_() {
  const config = getRuntimeConfig_();
  const spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(RECORD_SHEET_NAME);
  if (!sheet) {
    throw new Error('找不到 Records 工作表。請重新執行 setupProject()。');
  }
  verifyHeaderRow_(sheet);
  return sheet;
}

function verifyHeaderRow_(sheet) {
  if (sheet.getLastRow() < 1) {
    throw new Error('Records 工作表缺少欄位標題。請重新執行 setupProject()。');
  }
  const actual = sheet.getRange(1, 1, 1, RECORD_HEADERS.length).getDisplayValues()[0];
  if (actual.join('|') !== RECORD_HEADERS.join('|')) {
    throw new Error('Records 工作表欄位與目前程式版本不一致。請先備份資料，再依 README 處理。');
  }
}

/**
 * A privacy-preserving per-user key supplied by Apps Script. It may rotate,
 * therefore continuation links with an access token remain the reliable
 * cross-device fallback.
 */
function getOwnerHash_() {
  let temporaryKey = '';
  try {
    temporaryKey = String(Session.getTemporaryActiveUserKey() || '');
  } catch (error) {
    console.warn('Temporary user key unavailable', error);
  }
  return temporaryKey ? hashSecret_('owner:' + temporaryKey) : '';
}

function hashSecret_(secret) {
  const pepper = getRuntimeConfig_().tokenPepper;
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(secret || '') + '|' + pepper,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (value) {
    const normalized = value < 0 ? value + 256 : value;
    return normalized.toString(16).padStart(2, '0');
  }).join('');
}

function constantTimeEqual_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function randomToken_() {
  const entropy = [
    Utilities.getUuid(),
    Utilities.getUuid(),
    new Date().getTime(),
    Math.random()
  ].join('|');
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    entropy,
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function createRecordId_() {
  return 'record-' + Utilities.getUuid();
}

function sanitizeRecordId_(value) {
  const id = String(value || '').trim();
  return /^record-[A-Za-z0-9-]{10,80}$/.test(id) ? id : '';
}

function sanitizeRecord_(input) {
  const source = input && typeof input === 'object' ? input : {};
  const meetingType = sanitizeMeetingType_(source.meetingType);
  const meetingSubtype = sanitizeMeetingSubtype_(meetingType, source.meetingSubtype);

  return {
    id: sanitizeRecordId_(source.id) || createRecordId_(),
    department: cleanText_(source.department, 80, true),
    meetingDate: sanitizeDate_(source.meetingDate),
    meetingType: meetingType,
    meetingSubtype: meetingSubtype,
    otherMeetingType: meetingType === '14' ? cleanText_(source.otherMeetingType, 120, true) : '',
    topic: cleanText_(source.topic, 250, true),
    reporter: cleanText_(source.reporter, 120, true),
    chairperson: cleanText_(source.chairperson, 120, true),
    startTime: sanitizeTime_(source.startTime),
    endTime: sanitizeTime_(source.endTime),
    location: cleanText_(source.location, 160, true),
    participantCount: sanitizeParticipantCount_(source.participantCount),
    summary: cleanText_(source.summary, MAX_SUMMARY_CHARS, false),
    recorder: cleanText_(source.recorder, 120, true),
    reviewer: cleanText_(source.reviewer, 120, true),
    createdAt: '',
    updatedAt: '',
    expiresAt: '',
    schemaVersion: SCHEMA_VERSION
  };
}

function sanitizeMeetingType_(value) {
  const type = String(value || '');
  return /^(?:[1-9]|1[0-6])$/.test(type) ? type : '';
}

function sanitizeMeetingSubtype_(meetingType, value) {
  const subtype = String(value || '');
  if (meetingType === '5' && ['5-1', '5-2', '5-3'].includes(subtype)) return subtype;
  if (meetingType === '9' && ['9-1', '9-2', '9-3'].includes(subtype)) return subtype;
  return '';
}

function sanitizeDate_(value) {
  const date = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function sanitizeTime_(value) {
  const time = String(value || '');
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '';
}

function sanitizeParticipantCount_(value) {
  const raw = String(value === null || value === undefined ? '' : value).trim();
  if (!raw) return '';
  if (!/^\d{1,5}$/.test(raw)) return '';
  return String(Math.min(Number(raw), 99999));
}

function cleanText_(value, maxLength, trim) {
  let text = String(value === null || value === undefined ? '' : value).replace(/\u0000/g, '');
  if (trim) text = text.trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function clampInteger_(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function findRecordRow_(sheet, recordId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const match = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(recordId)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function readRow_(sheet, rowNumber) {
  return sheet.getRange(rowNumber, 1, 1, RECORD_HEADERS.length).getValues()[0];
}

function rowToRecord_(row) {
  let parsed = {};
  try {
    parsed = JSON.parse(String(row[COL.DATA_JSON] || '{}'));
  } catch (error) {
    console.error('Invalid record JSON', error);
  }
  return Object.assign({}, parsed, {
    id: String(row[COL.ID] || ''),
    department: String(row[COL.DEPARTMENT] || parsed.department || ''),
    meetingDate: String(row[COL.MEETING_DATE] || parsed.meetingDate || ''),
    topic: String(row[COL.TOPIC] || parsed.topic || ''),
    createdAt: isoString_(row[COL.CREATED_AT]),
    updatedAt: isoString_(row[COL.UPDATED_AT]),
    expiresAt: isoString_(row[COL.EXPIRES_AT]),
    schemaVersion: Number(row[COL.SCHEMA_VERSION] || SCHEMA_VERSION)
  });
}

function isoString_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function isExpiredRow_(row, now) {
  const expiry = new Date(row[COL.EXPIRES_AT]);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() <= now.getTime();
}

function isAuthorizedRow_(row, ownerHash, accessToken) {
  if (ownerHash && row[COL.OWNER_HASH] && constantTimeEqual_(ownerHash, row[COL.OWNER_HASH])) {
    return true;
  }
  if (!accessToken) return false;
  const tokenHash = hashSecret_('token:' + String(accessToken));
  return Boolean(row[COL.TOKEN_HASH]) && constantTimeEqual_(tokenHash, row[COL.TOKEN_HASH]);
}

function recordToRow_(record, ownerHash, accessTokenHash) {
  const json = JSON.stringify(record);
  if (json.length > MAX_JSON_CELL_CHARS) {
    throw new Error('內容過長，無法儲存至 Google Sheet。請精簡討論摘要後再試。');
  }
  return [
    record.id,
    ownerHash || '',
    accessTokenHash || '',
    record.department,
    record.meetingDate,
    record.topic,
    json,
    record.createdAt,
    record.updatedAt,
    record.expiresAt,
    SCHEMA_VERSION
  ];
}

function upsertRecord_(input, accessToken) {
  const config = getRuntimeConfig_();
  const sheet = getRecordsSheet_();
  const ownerHash = getOwnerHash_();
  const record = sanitizeRecord_(input);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + config.retentionDays * 86400000);
    let rowNumber = findRecordRow_(sheet, record.id);
    let row = rowNumber ? readRow_(sheet, rowNumber) : null;

    if (row && isExpiredRow_(row, now)) {
      sheet.deleteRow(rowNumber);
      rowNumber = 0;
      row = null;
    }

    if (row) {
      if (!isAuthorizedRow_(row, ownerHash, accessToken)) {
        throw new Error('無法存取這筆草稿。請使用同一 Google 帳號，或從原本的續填連結開啟。');
      }
      const existing = rowToRecord_(row);
      record.createdAt = existing.createdAt || now.toISOString();
      record.updatedAt = now.toISOString();
      record.expiresAt = expiresAt.toISOString();
      const storedOwnerHash = String(row[COL.OWNER_HASH] || ownerHash || '');
      const storedTokenHash = String(row[COL.TOKEN_HASH] || '');
      sheet.getRange(rowNumber, 1, 1, RECORD_HEADERS.length)
        .setValues([recordToRow_(record, storedOwnerHash, storedTokenHash)]);
      return { record: record, accessToken: '', created: false };
    }

    const newAccessToken = randomToken_();
    record.createdAt = now.toISOString();
    record.updatedAt = now.toISOString();
    record.expiresAt = expiresAt.toISOString();
    sheet.appendRow(recordToRow_(
      record,
      ownerHash,
      hashSecret_('token:' + newAccessToken)
    ));
    return { record: record, accessToken: newAccessToken, created: true };
  } finally {
    lock.releaseLock();
  }
}

function listRecordsForOwner_(ownerHash) {
  if (!ownerHash) return [];
  const sheet = getRecordsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const now = new Date();
  const rows = sheet.getRange(2, 1, lastRow - 1, RECORD_HEADERS.length).getValues();

  return rows
    .filter(function (row) {
      return row[COL.OWNER_HASH]
        && constantTimeEqual_(String(row[COL.OWNER_HASH]), ownerHash)
        && !isExpiredRow_(row, now);
    })
    .map(rowToRecord_)
    .sort(function (a, b) {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, MAX_RECORDS_PER_USER);
}

function getAuthorizedRecord_(recordId, accessToken, ownerHash) {
  const normalizedId = sanitizeRecordId_(recordId);
  if (!normalizedId) return null;
  const sheet = getRecordsSheet_();
  const rowNumber = findRecordRow_(sheet, normalizedId);
  if (!rowNumber) return null;
  const row = readRow_(sheet, rowNumber);
  if (isExpiredRow_(row, new Date())) return null;
  if (!isAuthorizedRow_(row, ownerHash, accessToken)) {
    throw new Error('這個續填連結無效、已被更新，或你沒有這筆草稿的存取權。');
  }
  return rowToRecord_(row);
}

function rotateAccessToken_(recordId, accessToken, ownerHash) {
  const config = getRuntimeConfig_();
  const normalizedId = sanitizeRecordId_(recordId);
  if (!normalizedId) throw new Error('草稿編號格式不正確。');
  const sheet = getRecordsSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const rowNumber = findRecordRow_(sheet, normalizedId);
    if (!rowNumber) throw new Error('找不到這筆草稿，可能已經過期。');
    const row = readRow_(sheet, rowNumber);
    if (isExpiredRow_(row, new Date())) {
      sheet.deleteRow(rowNumber);
      throw new Error('這筆草稿已經過期。');
    }
    if (!isAuthorizedRow_(row, ownerHash, accessToken)) {
      throw new Error('無法建立續填連結。請使用同一 Google 帳號或有效的舊連結。');
    }

    const newToken = randomToken_();
    const record = rowToRecord_(row);
    const now = new Date();
    record.updatedAt = now.toISOString();
    record.expiresAt = new Date(now.getTime() + config.retentionDays * 86400000).toISOString();
    const newRow = recordToRow_(
      record,
      String(row[COL.OWNER_HASH] || ownerHash || ''),
      hashSecret_('token:' + newToken)
    );
    sheet.getRange(rowNumber, 1, 1, RECORD_HEADERS.length).setValues([newRow]);
    return { record: record, accessToken: newToken };
  } finally {
    lock.releaseLock();
  }
}

function deleteRecord_(recordId, accessToken, ownerHash) {
  const normalizedId = sanitizeRecordId_(recordId);
  if (!normalizedId) return { deleted: false };
  const sheet = getRecordsSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const rowNumber = findRecordRow_(sheet, normalizedId);
    if (!rowNumber) return { deleted: false };
    const row = readRow_(sheet, rowNumber);
    if (!isAuthorizedRow_(row, ownerHash, accessToken)) {
      throw new Error('無法刪除這筆草稿。');
    }
    sheet.deleteRow(rowNumber);
    return { deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function maybeCleanupExpiredRecords_() {
  const cache = CacheService.getScriptCache();
  if (cache.get('recent-expiry-cleanup')) return;
  try {
    deleteExpiredRows_();
    cache.put('recent-expiry-cleanup', new Date().toISOString(), 3600);
  } catch (error) {
    console.error('Lazy cleanup failed', error);
  }
}

function deleteExpiredRows_() {
  const sheet = getRecordsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const now = new Date();
  const expiryValues = sheet.getRange(2, COL.EXPIRES_AT + 1, lastRow - 1, 1).getValues();
  let deleted = 0;
  for (let index = expiryValues.length - 1; index >= 0; index -= 1) {
    const expiry = new Date(expiryValues[index][0]);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= now.getTime()) {
      sheet.deleteRow(index + 2);
      deleted += 1;
    }
  }
  return deleted;
}

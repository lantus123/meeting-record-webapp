/**
 * Run once from the Apps Script editor as the project owner.
 * It creates a private Google Sheet, stores configuration in Script Properties,
 * and installs a daily cleanup trigger.
 */
function setupProject() {
  const properties = PropertiesService.getScriptProperties();
  let spreadsheet = null;
  const existingId = String(properties.getProperty('SPREADSHEET_ID') || '').trim();

  if (existingId) {
    try {
      spreadsheet = SpreadsheetApp.openById(existingId);
    } catch (error) {
      console.warn('Stored spreadsheet could not be opened; creating a new one.', error);
    }
  }

  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create('科部研討會記錄資料（短期草稿）');
  }
  spreadsheet.setSpreadsheetTimeZone('Asia/Taipei');

  let sheet = spreadsheet.getSheetByName(RECORD_SHEET_NAME);
  if (!sheet) {
    const firstSheet = spreadsheet.getSheets()[0];
    if (firstSheet && firstSheet.getLastRow() === 0) {
      firstSheet.setName(RECORD_SHEET_NAME);
      sheet = firstSheet;
    } else {
      sheet = spreadsheet.insertSheet(RECORD_SHEET_NAME);
    }
  }

  initializeRecordSheet_(sheet);

  const propertyUpdates = {
    SPREADSHEET_ID: spreadsheet.getId(),
    RETENTION_DAYS: properties.getProperty('RETENTION_DAYS') || '14',
    TOKEN_PEPPER: properties.getProperty('TOKEN_PEPPER') || randomToken_()
  };
  properties.setProperties(propertyUpdates, false);
  installCleanupTrigger_();

  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    retentionDays: Number(propertyUpdates.RETENTION_DAYS),
    message: '初始化完成。下一步請部署為 Web App。'
  };
}

function initializeRecordSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.getRange(1, 1, 1, RECORD_HEADERS.length).setValues([RECORD_HEADERS]);
  } else {
    const current = sheet.getRange(1, 1, 1, RECORD_HEADERS.length).getDisplayValues()[0];
    if (current.join('|') !== RECORD_HEADERS.join('|')) {
      throw new Error('現有 Records 工作表的欄位不相容。為避免覆蓋資料，初始化已停止。');
    }
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, RECORD_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#eaf0ff');
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 110);
  sheet.setColumnWidth(6, 260);
  sheet.setColumnWidth(7, 420);
  sheet.setColumnWidths(8, 3, 170);

  try {
    sheet.hideColumns(2, 2);
  } catch (error) {
    console.warn('Could not hide security columns', error);
  }
}

function setRetentionDays(days) {
  const normalized = clampInteger_(days, 1, 90, 14);
  PropertiesService.getScriptProperties().setProperty('RETENTION_DAYS', String(normalized));
  return { retentionDays: normalized };
}

function installCleanupTrigger() {
  ensureConfigured_();
  installCleanupTrigger_();
  return { ok: true };
}

function installCleanupTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(function (trigger) {
      return trigger.getHandlerFunction() === 'cleanupExpiredRecords';
    })
    .forEach(function (trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger('cleanupExpiredRecords')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
}

function cleanupExpiredRecords() {
  ensureConfigured_();
  return { deleted: deleteExpiredRows_(), finishedAt: new Date().toISOString() };
}

function getSetupStatus() {
  const config = getRuntimeConfig_();
  let spreadsheetUrl = '';
  if (config.spreadsheetId) {
    try {
      spreadsheetUrl = SpreadsheetApp.openById(config.spreadsheetId).getUrl();
    } catch (error) {
      spreadsheetUrl = '';
    }
  }
  return {
    configured: Boolean(config.spreadsheetId && config.tokenPepper),
    spreadsheetId: config.spreadsheetId,
    spreadsheetUrl: spreadsheetUrl,
    retentionDays: config.retentionDays,
    cleanupTriggerInstalled: ScriptApp.getProjectTriggers().some(function (trigger) {
      return trigger.getHandlerFunction() === 'cleanupExpiredRecords';
    })
  };
}

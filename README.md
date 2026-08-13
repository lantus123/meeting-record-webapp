# 科、部研討會記錄單｜線上短期草稿與 A4 列印

將紙本「科、部研討會記錄單」轉成可在手機填寫、短期保存、回到電腦續填並列印的 Google Apps Script Web App。

本專案**不使用 Firebase，也不把表單資料寫入 GitHub**：

- GitHub：保存程式碼與版本紀錄
- Google Apps Script：提供網頁及伺服器函式
- 私人 Google Sheet：保存短期草稿
- `localStorage`：離線或同步失敗時的本機備援
- Google Sites：嵌入正式 Web App

## 功能

- 手機、平板與電腦響應式表單
- 瀏覽器本機自動儲存
- Google Sheet 雲端同步
- 預設最後更新後保留 14 天
- 每日排程清除過期資料
- 複製「續填連結」到另一台裝置
- JSON 匯出、匯入備援
- A4 直向兩頁列印與另存 PDF
- 保留 16 種研討會類型及聯合討論會／教學子分類

> **重要：**取得完整續填連結的人可編輯該筆草稿。每次重新產生連結，舊連結會失效。請勿把連結貼到公開位置。

## 專案結構

```text
apps-script/
  Code.gs            Web App 入口與公開伺服器函式
  Store.gs           Sheet 儲存、權限、雜湊與資料驗證
  Setup.gs           一次性初始化與每日清除排程
  Index.html         表單頁面
  Styles.html        響應式與 A4 列印樣式
  Client.html        本機草稿、同步、續填連結與列印邏輯
  appsscript.json    Apps Script manifest
scripts/
  validate.mjs       無外部套件的靜態檢查
.github/workflows/
  validate.yml       Pull request 與 push 自動檢查
```

## 最快部署方式：Apps Script 編輯器

### 1. 建立 Apps Script 專案

1. 開啟 [Google Apps Script](https://script.google.com/)。
2. 建立「新專案」。
3. 將 `apps-script/` 內的檔案逐一建立於專案中：
   - `.gs` 檔建立為「指令碼」
   - `.html` 檔建立為「HTML」
   - 在「專案設定」勾選顯示 `appsscript.json`，再貼上 manifest
4. 確認檔名完全一致，尤其是 `Index`、`Styles`、`Client`。

### 2. 初始化 Google Sheet

1. 在 Apps Script 上方函式選單選擇 `setupProject`。
2. 按「執行」。
3. 完成 Google 授權。
4. 執行結果會回傳新建 Sheet 的網址，並安裝每天凌晨約 3 點執行的清除排程。

`setupProject()` 會建立 Script Properties：

- `SPREADSHEET_ID`
- `RETENTION_DAYS`，預設 `14`
- `TOKEN_PEPPER`，自動產生，不可公開

可在編輯器執行：

```javascript
getSetupStatus()
```

檢查 Sheet 與清除 trigger 是否正常。

要改成保留 7 天或 30 天，可執行：

```javascript
setRetentionDays(7)
// 或
setRetentionDays(30)
```

允許範圍是 1–90 天。

### 3. 部署為 Web App

1. 點右上角「部署」→「新增部署」。
2. 類型選「網頁應用程式」。
3. **執行身分：我**。
4. 存取權限依使用環境選擇：
   - 院內 Google Workspace：建議限定組織網域
   - 個人測試：可選具有 Google 帳號的使用者
5. 完成部署並複製 `/exec` 網址。

因為資料 Sheet 由部署者擁有，建議以部署者身分執行；使用者不需要直接取得 Sheet 權限。

### 4. 測試跨裝置

1. 手機開啟 Web App。
2. 填入一筆測試資料並按「立即儲存」。
3. 打開草稿面板，按「複製跨裝置續填連結」。
4. 將連結傳給自己，在電腦開啟。
5. 修改內容，按「列印／另存 PDF」。
6. 確認 Google Sheet 出現紀錄，且 `expiresAt` 是最後更新日加 14 天。

## 嵌入 Google Sites

1. 編輯 Google Sites。
2. 選「插入」→「嵌入」→「網址」。
3. 貼上 Apps Script Web App 的 `/exec` 網址。
4. 調整嵌入區塊高度後發布。

`Code.gs` 已使用 `HtmlService.XFrameOptionsMode.ALLOWALL`，允許嵌入 Google Sites。

Google Sites 的 iframe 內可能不適合完成所有授權或另存檔操作，因此頁首保留「新分頁開啟」。第一次授權、複製續填連結與列印時，建議在新分頁使用。

## 使用 GitHub 與 clasp 管理程式碼

GitHub 是程式碼的 single source of truth；正式執行環境仍是 Apps Script。

安裝並登入 clasp：

```bash
npm install -g @google/clasp
clasp login
```

在 Apps Script「專案設定」複製 Script ID，然後：

```bash
cp .clasp.json.example .clasp.json
# 將 .clasp.json 中的 scriptId 換成真實值
clasp push
```

`.clasp.json`、OAuth 憑證與 Script ID 已列入 `.gitignore`，不要提交到公開 repository。

## 本機檢查

不需要安裝 npm 套件：

```bash
npm test
```

檢查內容包含：

- `.gs` 與前端 JavaScript 語法
- Apps Script HTML include
- Client 使用的 DOM id 是否存在
- 16 種研討會選項與必要列印文字
- Firebase 殘留與常見秘密字串

## 資料與權限設計

每筆 Sheet 紀錄包含：

```text
recordId
ownerKeyHash
accessTokenHash
department
meetingDate
topic
dataJson
createdAt
updatedAt
expiresAt
schemaVersion
```

### 自動草稿清單

程式會使用 `Session.getTemporaryActiveUserKey()` 取得不含 email 的暫時識別值，再加上私密 `TOKEN_PEPPER` 做 SHA-256 雜湊。若 Google 執行環境能穩定提供此識別值，同一使用者會看到自己的近期草稿。

### 續填連結

跨裝置的可靠路徑是：

```text
Web App URL?record=<recordId>#token=<隨機權杖>
```

- Sheet 只保存權杖雜湊，不保存明文 token
- token 放在網址 fragment，正常情況下不會送入 HTTP request
- 新連結會輪替權杖，使舊連結失效
- 不要截圖、轉寄或公開張貼完整連結

### 過期清除

- 每次成功同步都更新 `expiresAt`
- 每日 time-driven trigger 執行 `cleanupExpiredRecords`
- 每次載入也最多每小時做一次延遲清理
- 排程不是精準到期秒數，資料可能在下一次 trigger 才刪除

## 臨床資料安全

這份表單有自由文字「討論內容摘要」，使用者可能輸入病人資訊。正式上線前必須依院方政策評估：

- Google Workspace 與 Google Drive 是否為核准服務
- Web App 是否限制於院內網域
- 是否禁止輸入姓名、病歷號、生日等可識別資訊
- Sheet 擁有者、管理者與備份權限
- 稽核、保存、刪除與事件通報要求

**登入、雜湊及 14 天自動刪除，不等同於已符合醫院資安或個資法要求。** 在未取得院方核准前，請只用無病人識別資訊的測試資料。

## 版本更新

修改程式後：

1. `npm test`
2. push 至 GitHub branch 並開 PR
3. merge 後 `clasp push`
4. Apps Script「管理部署」建立新版本或更新既有部署
5. 手機與電腦各測試一次同步與列印

## License

MIT

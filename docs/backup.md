# 正式站每週備份（#345）

每週二 00:00 自動把正式環境（`ztozevcqkfrohgjmngcj`）的結構和資料備份到本機，並在 OneDrive 留一份加密副本。只讀正式站，不寫入任何東西。

- 程式：`scripts/backup-production.mjs`（備份本體）、`scripts/backup-production.ps1`（密碼、排程、執行）
- 備份內容含約 1,200 位會友的個資。**本機明文只放在專案 repo 和 OneDrive 外面**，腳本會檢查；建議開啟 BitLocker。

## 備份了什麼

| 位置 | 內容 |
|---|---|
| `repo/schema.sql` | `pg_dump --schema-only --schema=public`：資料表、RLS 政策、函式、觸發器、權限 |
| `repo/data/public.<表>.csv` | 每張 public 表一個 CSV，依主鍵排序（沒主鍵就用整列文字排序），所有表在同一個唯讀快照裡匯出 |
| `repo/meta/` | `cron_jobs`、`storage_buckets`、`storage_objects`（清單）、`policies`（所有 schema，含 storage 的政策）、`sequences`、`extensions`、`migrations`、`row_counts`、`vault_secret_names`、`edge_function_secret_names.json` |
| `repo/restore-data.sql` | 自動產生的資料還原腳本 |
| `full/prod-public-YYYY-MM.dump` | 每月第一次執行存一份 `pg_dump -Fc`（public 的結構＋資料），保留 3 份 |
| OneDrive `bible-speed-reading-backups/*.7z` | 整個備份倉庫的 `git bundle`（含全部歷史），7-Zip AES-256 加密、檔名也加密，保留最新 4 份 |
| `logs/` | 每次執行一份 log，保留 30 份 |

**只存差異的方式**：`repo/` 是一個本機 git 倉庫，一週一個 commit。CSV 排序固定，沒變的資料每次輸出都一樣，所以 git 只存有變的行（每次 commit 後會 `git gc` 打包）。被刪掉的資料列在 `git diff` 裡看得到；任何一週都能 checkout 出完整快照。這個倉庫**永遠不設 remote**，腳本發現有 remote 會直接失敗。

**沒有備份到的**（都已確認）：

- `auth.users`：目前 0 筆（登入用 NLC Logto）。
- Storage 裡的檔案本身：只存清單。目前 `issue-report-shots` 沒有檔案，而且截圖 180 天後本來就會被清掉。
- Vault 密鑰和 Edge Function 環境變數的**值**：只存名稱。值請記在密碼管理器；Vault 的加密內容換到別的專案也解不開。
- Edge Function 程式碼：已經在 git 裡。

## 一次性設定

0. **Supabase CLI 保持登入**（`npx supabase login`；平常跑 `db push` 就已經登入了）。備份**不存 DB 密碼**：每一步連線前，程式在專案主資料夾跑 `npx supabase db dump --dry-run --linked --project-ref ztozevcqkfrohgjmngcj`，拿 CLI 發的臨時帳號（`cli_login_postgres`，跟 `db push` 同一套機制），連上後 `SET ROLE postgres` 並設成唯讀。CLI 登入過期或改版導致格式看不懂時，備份會失敗並跳通知。
1. **PostgreSQL 17 指令列工具**（`pg_dump`、`psql`；正式站是 17.x，工具版本不能比它舊，而且要 17.6 以上才有 `--restrict-key`）。只裝 Command Line Tools：
   ```powershell
   winget install --id PostgreSQL.PostgreSQL.17 --override "--mode unattended --unattendedmodeui minimal --enable-components commandlinetools --disable-components server,pgAdmin,stackbuilder"
   ```
   裝在 `C:\Program Files\PostgreSQL\17\bin`。裝在別的位置的話，改 `backup.config.json` 的 `pgBinDir`。
2. **7-Zip**：`C:\Program Files\7-Zip\7z.exe`。
3. **雲端壓縮密碼**（在你自己的 PowerShell 視窗執行）：
   ```powershell
   .\scripts\backup-production.ps1 -SetSecrets
   ```
   - 自動產生一組 32 字元的隨機密碼，**只在你的視窗顯示一次**。存進密碼管理器（或抄下來放在這台電腦以外的地方）後，在同一個視窗輸入最後 4 個字確認。
   - 用 Windows DPAPI 加密存在 `<備份目錄>\secrets\archive-password.dpapi`，只有這台電腦的這個 Windows 帳號解得開。
   - 這台電腦壞掉時，要用它才能打開 OneDrive 上的備份。重跑 `-SetSecrets` 會換新密碼，之前的雲端副本仍然要用舊密碼。
4. **安裝排程**：
   ```powershell
   .\scripts\backup-production.ps1 -Install
   ```
   把腳本複製到 `<備份目錄>\bin\scripts\`（排程不受專案 repo 切換分支影響），在 `backup.config.json` 記下專案主資料夾（不是 task worktree，`npx supabase` 在那裡跑），註冊工作排程器「BibleSpeedReading-ProductionBackup」：每週二 00:00，錯過了（電腦沒開、沒登入）會在下次登入後補跑。**改了 `backup-production.mjs` 之後要重跑 `-Install`。**
5. 手動跑第一次：`& "$HOME\Documents\bible-speed-reading-backups\bin\scripts\backup-production.ps1"`。

連線走 CLI 給的 Supabase Session pooler（目前是 `aws-1-ap-northeast-1.pooler.supabase.com:5432`，IPv4）；程式會檢查帳號屬於正式站、主機是 `*.pooler.supabase.com`。

## 每週檢查

- 失敗時右下角會跳通知；log 在 `<備份目錄>\logs\`。
- 看最近幾週有什麼變化：`git -C "$HOME\Documents\bible-speed-reading-backups\repo" log --stat -5`。

## 還原

**只還原到本機的測試資料庫，絕不還原到 staging 或正式站。** 本機要先開 Docker Desktop。

1. 挑一週：`git -C <備份目錄>\repo log --oneline`，再 `git -C <備份目錄>\repo checkout <commit>`。（用完 `git checkout main` 回來）
   從雲端副本還原的話：先用 7-Zip 和壓縮密碼解開 `.7z`，得到 `repo.bundle`，再 `git clone repo.bundle restored-repo`。
2. 開一個空的本機 Supabase（有 `anon`、`authenticated`、`auth` schema 等，schema.sql 才載得進去）：
   ```powershell
   mkdir $env:TEMP\restore-drill; cd $env:TEMP\restore-drill
   npx supabase init
   npx supabase start
   ```
3. 在備份倉庫根目錄載入結構和資料（本機 DB 在 `postgresql://postgres:postgres@127.0.0.1:54322/postgres`）：
   ```powershell
   cd <備份目錄>\repo
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f schema.sql
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f restore-data.sql
   ```
4. 對照 `meta/row_counts.csv` 檢查每張表的筆數；cron 排程依 `meta/cron_jobs.csv` 用 `cron.schedule(...)` 重建；Vault 密鑰和 Edge Function 環境變數依名稱清單從密碼管理器補回。
5. 只要單一時間點的完整檔：`pg_restore -d <連線字串> full\prod-public-YYYY-MM.dump`。

建議每季做一次上面的還原演練，確認備份真的能用。演練完 `npx supabase stop --no-backup` 關掉。

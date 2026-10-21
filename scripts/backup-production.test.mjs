import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATALOG_SQL,
  META_QUERIES,
  PROD_REF,
  assertCloudDir,
  buildExportScript,
  buildRestoreScript,
  cloudArchiveName,
  dataFileName,
  filesToRotate,
  monthlyDumpName,
  orderByClause,
  parseCliCredentials,
  parseCatalog,
  parsePgMajor,
  psqlPath,
  resolvePaths
} from "./backup-production.mjs";
import { PROD_REF as LIB_PROD_REF } from "./lib/supabase-cli-query.mjs";

// #345：正式站每週備份到本機 git 倉庫＋OneDrive 加密副本。
const tables = [
  { name: "profiles", columns: ["id", "name"], pk: ["id"] },
  { name: "reading_team_members", columns: ["team_id", "user_id", "role"], pk: ["team_id", "user_id"] },
  { name: "no_pk_table", columns: ["payload"], pk: [] }
];
const dirs = { dataDir: "C:\\backups\\repo\\data", metaDir: "C:\\backups\\repo\\meta" };

describe("project ref", () => {
  it("is the production project, same as the shared CLI helper", () => {
    expect(PROD_REF).toBe(LIB_PROD_REF);
  });
});

describe("parseCliCredentials", () => {
  const good = [
    "Initialising login role...",
    'export PGHOST="aws-1-ap-northeast-1.pooler.supabase.com"',
    'export PGPORT="5432"',
    'export PGUSER="cli_login_postgres.bbbbbbbbbbbbbbbbbbbb"',
    'export PGPASSWORD="abcdefABCDEF0123456789abcdefABCD"',
    'export PGDATABASE="postgres"',
    'pg_dump --schema-only ...'
  ].join("\r\n");

  it("reads the temporary login from supabase db dump --dry-run", () => {
    expect(parseCliCredentials(good)).toEqual({
      PGHOST: "aws-1-ap-northeast-1.pooler.supabase.com",
      PGPORT: "5432",
      PGUSER: "cli_login_postgres.bbbbbbbbbbbbbbbbbbbb",
      PGPASSWORD: "abcdefABCDEF0123456789abcdefABCD",
      PGDATABASE: "postgres"
    });
  });

  it("refuses a login for any project other than production", () => {
    expect(() => parseCliCredentials(good.replace(/bbbbbbbbbbbbbbbbbbbb/, "aaaaaaaaaaaaaaaaaaaa"))).toThrow(/正式站/);
  });

  it("refuses a host that is not the Supabase pooler", () => {
    expect(() => parseCliCredentials(good.replace("aws-1-ap-northeast-1.pooler.supabase.com", "evil.example.com"))).toThrow(/pooler/);
  });

  it("fails loudly when the CLI output format changes", () => {
    expect(() => parseCliCredentials(good.replace(/export PGPASSWORD=.*/, 'export PGPASSWORD=abc$x'))).toThrow(/格式/);
    expect(() => parseCliCredentials("Initialising login role...")).toThrow(/沒給出/);
  });

  it("never puts the password in the error message", () => {
    const bad = good.replace('export PGUSER="cli_login_postgres.bbbbbbbbbbbbbbbbbbbb"', 'export PGUSER="someone.else"');
    expect(() => parseCliCredentials(bad)).toThrow();
    try { parseCliCredentials(bad); } catch (e) { expect(e.message).not.toContain("abcdefABCDEF"); }
  });
});

describe("resolvePaths", () => {
  const projectRoots = ["C:\\Users\\admin\\Desktop\\Bible-study"];
  const oneDriveDir = "C:\\Users\\admin\\OneDrive";

  it("accepts a folder outside the repo and OneDrive", () => {
    const paths = resolvePaths({ root: "C:\\Users\\admin\\Documents\\bible-speed-reading-backups", projectRoots, oneDriveDir });
    expect(paths.repoDir).toMatch(/bible-speed-reading-backups[\\/]repo$/);
    expect(paths.fullDir).toMatch(/[\\/]full$/);
  });

  it("refuses a folder inside the project repo, so member data is never committed", () => {
    expect(() => resolvePaths({ root: "C:\\Users\\admin\\Desktop\\Bible-study\\backups", projectRoots, oneDriveDir }))
      .toThrow(/專案 repo/);
    expect(() => resolvePaths({ root: "C:\\Users\\admin\\Desktop\\Bible-study", projectRoots, oneDriveDir }))
      .toThrow(/專案 repo/);
  });

  it("refuses a folder inside OneDrive, so plaintext never syncs to the cloud", () => {
    expect(() => resolvePaths({ root: "C:\\Users\\admin\\OneDrive\\backups", projectRoots, oneDriveDir }))
      .toThrow(/OneDrive/);
  });

  it("does not confuse a sibling folder with the same prefix for the repo", () => {
    expect(() => resolvePaths({ root: "C:\\Users\\admin\\Desktop\\Bible-study-backups", projectRoots, oneDriveDir }))
      .not.toThrow();
  });

  it("refuses relative paths", () => {
    expect(() => resolvePaths({ root: "backups", projectRoots, oneDriveDir })).toThrow(/絕對路徑/);
  });
});

describe("assertCloudDir", () => {
  const root = "C:\\Users\\admin\\Documents\\bible-speed-reading-backups";
  const projectRoots = ["C:\\Users\\admin\\Desktop\\Bible-study"];

  it("accepts the OneDrive folder", () => {
    expect(() => assertCloudDir("C:\\Users\\admin\\OneDrive\\bible-speed-reading-backups", { root, projectRoots })).not.toThrow();
  });

  it("refuses the backup folder itself or the repo", () => {
    expect(() => assertCloudDir(`${root}\\cloud`, { root, projectRoots })).toThrow();
    expect(() => assertCloudDir("C:\\Users\\admin\\Desktop\\Bible-study\\cloud", { root, projectRoots })).toThrow();
  });
});

describe("table catalog", () => {
  it("only lists public tables and skips generated columns and partitions", () => {
    expect(CATALOG_SQL).toMatch(/nspname = 'public'/);
    expect(CATALOG_SQL).toMatch(/attgenerated = ''/);
    expect(CATALOG_SQL).toMatch(/NOT c\.relispartition/);
  });

  it("parses psql's JSON output", () => {
    const parsed = parseCatalog(`${JSON.stringify([{ name: "profiles", columns: ["id"], pk: ["id"] }, { name: "x", columns: ["a"], pk: null }])}\n`);
    expect(parsed).toEqual([{ name: "profiles", columns: ["id"], pk: ["id"] }, { name: "x", columns: ["a"], pk: [] }]);
  });

  it("fails on an empty list instead of silently backing up nothing", () => {
    expect(() => parseCatalog("[]")).toThrow();
  });

  it("rejects table names that could escape the file name or SQL", () => {
    expect(() => parseCatalog(JSON.stringify([{ name: "a\"; DROP TABLE x; --", columns: ["id"], pk: [] }]))).toThrow();
    expect(() => parseCatalog(JSON.stringify([{ name: "../x", columns: ["id"], pk: [] }]))).toThrow();
  });
});

describe("stable ordering (so git only stores changed lines)", () => {
  it("orders by the primary key, including composite keys", () => {
    expect(orderByClause(tables[0])).toBe('"id"');
    expect(orderByClause(tables[1])).toBe('"team_id", "user_id"');
  });

  it("orders tables without a primary key by the whole row as text", () => {
    expect(orderByClause(tables[2])).toBe("t::text");
  });
});

describe("export script", () => {
  const script = buildExportScript(tables, dirs);
  const statements = script.split("\n").filter((l) => l && !l.startsWith("\\copy") && !l.startsWith("\\set"));

  it("exports every table in one read-only snapshot", () => {
    expect(script).toMatch(/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
    expect(script.trim().endsWith("COMMIT;")).toBe(true);
    expect(script).toMatch(/\\set ON_ERROR_STOP on/);
    expect(script).toContain("SET ROLE postgres;\nSET default_transaction_read_only = on;");
  });

  it("never writes to the database", () => {
    for (const line of statements) expect(line).toMatch(/^(SET |BEGIN |COMMIT;)/);
    expect(script).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT)\b/i);
  });

  it("writes one sorted CSV per table with forward-slash paths", () => {
    expect(script).toContain(`\\copy (SELECT "id", "name" FROM public."profiles" t ORDER BY "id") TO 'C:/backups/repo/data/public.profiles.csv' WITH (FORMAT csv, HEADER true)`);
    expect(script).toContain("ORDER BY t::text) TO 'C:/backups/repo/data/public.no_pk_table.csv'");
  });

  it("pins session settings so the same data always prints the same text", () => {
    expect(script).toMatch(/SET TimeZone = 'UTC';/);
    expect(script).toMatch(/SET DateStyle = 'ISO, YMD';/);
  });

  it("includes the metadata pg_dump -n public leaves out", () => {
    const files = META_QUERIES.map(([f]) => f);
    expect(files).toEqual(expect.arrayContaining(["cron_jobs.csv", "policies.csv", "storage_buckets.csv", "sequences.csv", "vault_secret_names.csv"]));
    for (const f of [...files, "row_counts.csv"]) expect(script).toContain(`C:/backups/repo/meta/${f}`);
  });

  it("never exports vault secret values", () => {
    const vault = META_QUERIES.find(([f]) => f === "vault_secret_names.csv")[1];
    expect(vault).not.toMatch(/secret\b|decrypted/);
  });

  it("keeps each \\copy on a single line", () => {
    for (const line of script.split("\n").filter((l) => l.startsWith("\\copy"))) {
      expect(line).toMatch(/WITH \(FORMAT csv, HEADER true\)$/);
    }
  });
});

describe("restore script", () => {
  const script = buildRestoreScript(tables);

  it("loads every table with the same column list, triggers off, in one transaction", () => {
    expect(script).toMatch(/SET session_replication_role = replica/);
    expect(script).toContain(`\\copy public."reading_team_members" ("team_id", "user_id", "role") FROM 'data/public.reading_team_members.csv'`);
    expect(script).toMatch(/BEGIN;[\s\S]*COMMIT;\n$/);
  });

  it("restores sequence positions from the backup", () => {
    expect(script).toMatch(/meta\/sequences\.csv/);
    expect(script).toMatch(/setval/);
  });
});

describe("helpers", () => {
  it("rejects quotes in psql paths", () => {
    expect(() => psqlPath("C:\\it's\\x")).toThrow();
    expect(psqlPath("C:\\a\\b")).toBe("C:/a/b");
  });

  it("maps table names to files", () => {
    expect(dataFileName(tables[0])).toBe("public.profiles.csv");
  });

  it("reads the pg_dump major version", () => {
    expect(parsePgMajor("pg_dump (PostgreSQL) 17.11")).toBe(17);
    expect(() => parsePgMajor("nope")).toThrow();
  });

  it("names monthly dumps and cloud archives so they sort by time", () => {
    const d = new Date("2026-09-29T16:00:05.123Z");
    expect(monthlyDumpName(d)).toBe("prod-public-2026-09.dump");
    expect(cloudArchiveName(d)).toBe("bible-speed-reading-backup-20260929-160005Z.7z");
  });

  it("rotates only matching files and keeps the newest N", () => {
    const files = [
      "bible-speed-reading-backup-20260901-000000Z.7z",
      "bible-speed-reading-backup-20260915-000000Z.7z",
      "notes.txt",
      "bible-speed-reading-backup-20260908-000000Z.7z",
      "bible-speed-reading-backup-20260922-000000Z.7z",
      "bible-speed-reading-backup-20260929-000000Z.7z"
    ];
    expect(filesToRotate(files, /^bible-speed-reading-backup-.+\.7z$/, 4)).toEqual(["bible-speed-reading-backup-20260901-000000Z.7z"]);
    expect(filesToRotate(files.slice(0, 2), /^bible-speed-reading-backup-.+\.7z$/, 4)).toEqual([]);
  });
});

describe("Windows wrapper", () => {
  const ps1 = readFileSync(new URL("./backup-production.ps1", import.meta.url), "utf8");

  it("is saved with a BOM so Windows PowerShell 5.1 reads the Chinese text", () => {
    expect(ps1.charCodeAt(0)).toBe(0xfeff);
  });

  it("schedules every Tuesday 00:00 and catches up after a missed start", () => {
    expect(ps1).toMatch(/-Weekly -DaysOfWeek Tuesday -At '00:00'/);
    expect(ps1).toMatch(/-StartWhenAvailable/);
  });

  it("keeps the archive password in a DPAPI file and clears it from the environment afterwards", () => {
    expect(ps1).toMatch(/ConvertFrom-SecureString/);
    expect(ps1).toMatch(/Remove-Item Env:BACKUP_ARCHIVE_PASSWORD/);
  });

  it("trims the trailing newline Set-Content adds before decrypting", () => {
    expect(ps1).toMatch(/\(Get-Content -Path \$Path -Raw\)\.Trim\(\) \| ConvertTo-SecureString/);
  });

  it("never stores a database password", () => {
    expect(ps1).not.toMatch(/PGPASSWORD|db-password/);
  });

  it("generates the archive password with a CSPRNG and asks the user to confirm they saved it", () => {
    expect(ps1).toMatch(/RandomNumberGenerator/);
    expect(ps1).not.toMatch(/Get-Random/);
    expect(ps1).toMatch(/最後 4 個字/);
  });

  it("points the schedule at the main project folder, not a task worktree", () => {
    expect(ps1).toMatch(/--git-common-dir/);
  });
});

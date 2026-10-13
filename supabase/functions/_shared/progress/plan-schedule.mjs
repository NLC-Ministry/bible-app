// 教會計畫（global_plans 一列）→「教會原始日程」：管理端比對落後／超前用的尺（#564）。
//
// 會友 App 的 mapGlobalPlanRecord（js/db.js）和這裡用同一份解析規則（活動定義、起訖、書卷、預設代號），
// 一般計畫的平均分配也和 generatePlanObject（js/utils.js）共用 expandPlanBooksToChapters／distributeChaptersAcrossDays。
// 伺服器（admin-api、nlc-data）沒有 window，書卷表用 bible-chapters.mjs。
import { BIBLE_BOOK_CHAPTERS } from "./bible-chapters.mjs";
import {
  CHURCH_CAMPAIGN,
  CHURCH_CAMPAIGN_ID,
  buildChurchCampaignDays,
  cloneChurchCampaign,
  getChurchCampaignStageDefinition
} from "./church-campaign.mjs";

const DAY_MS = 1000 * 60 * 60 * 24;

const hasStoredDefinition = (rules) => Boolean(rules && Array.isArray(rules.stages) && Array.isArray(rules.segments));

// 計畫書卷 → 章節清單（照書卷順序）。「詩篇 1-110」「詩篇 111-150」是舊的半卷寫法。
export function expandPlanBooksToChapters(books, bibleBooks = BIBLE_BOOK_CHAPTERS) {
  const chapters = [];
  const list = Array.isArray(bibleBooks) ? bibleBooks : [];
  (Array.isArray(books) ? books : []).forEach(bookName => {
    if (bookName === "詩篇 1-110") {
      for (let i = 1; i <= 110; i++) chapters.push({ book: "詩篇", chapter: i });
    } else if (bookName === "詩篇 111-150") {
      for (let i = 111; i <= 150; i++) chapters.push({ book: "詩篇", chapter: i });
    } else {
      const book = list.find(b => b.name === bookName);
      if (book) {
        for (let i = 1; i <= book.chapters; i++) chapters.push({ book: book.name, chapter: i });
      }
    }
  });
  return chapters;
}

// 章節平均分到 readingDays 天，餘數從前面的天開始多分一章。
export function distributeChaptersAcrossDays(chapters, readingDays) {
  if (typeof readingDays !== 'number' || isNaN(readingDays) || readingDays <= 0) {
    return [];
  }
  const dailyChapters = Array.from({ length: readingDays }, () => []);
  const chsPerDay = Math.floor(chapters.length / readingDays);
  let remainder = chapters.length % readingDays;
  let chIdx = 0;

  for (let d = 0; d < readingDays; d++) {
    const todayCount = chsPerDay + (remainder > 0 ? 1 : 0);
    remainder--;
    for (let c = 0; c < todayCount; c++) {
      if (chIdx < chapters.length) {
        dailyChapters[d].push(chapters[chIdx]);
        chIdx++;
      }
    }
  }

  return dailyChapters;
}

function parseLocalDate(dateStr) {
  const parts = String(dateStr || "").slice(0, 10).split("-").map(Number);
  if (parts.length < 3 || parts.some(part => !Number.isFinite(part))) return null;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return Number.isNaN(date.getTime()) ? null : date;
}

// 一般（非教會活動）計畫的原始日程：書卷平均鋪在起訖之間、每週七天、第一遍。
// 同 generatePlanObject 不帶個人設定（沒有休息日、只排第一遍）時鋪出的 days。
export function buildEvenScheduleDays({ startDate, endDate, books, bibleBooks = BIBLE_BOOK_CHAPTERS } = {}) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (!start || !end) return [];
  const totalDays = Math.ceil((end - start) / DAY_MS) + 1;
  if (!(totalDays > 0)) return [];
  const chapters = expandPlanBooksToChapters(books, bibleBooks).map(ch => ({ ...ch, round: 1 }));
  const daily = distributeChaptersAcrossDays(chapters, totalDays);
  return daily.map((dayChapters, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      dayNum: index + 1,
      isoDate: date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0"),
      chapters: dayChapters.map(ch => ({ book: ch.book, chapter: ch.chapter, round: 1 }))
    };
  });
}

// global_plans 一列 → 它是哪種計畫、掛哪份活動定義。規則同 mapGlobalPlanRecord：
//   · 總表（church_campaign）：存的規則，沒有就用 masterDefinition（App 傳 window.CHURCH_CAMPAIGN）。
//   · 正式階段（church_campaign_stage）：存的規則，沒有就用內建定義（id 尾 12 碼＝階段序）。
//   · 延後大區梯次（church_campaign_stage_cohort）：**只沿用獎勵**，不掛活動定義、排程走一般路徑；
//     階段序只能靠 rules 的 stageNo／cohortSourceStageNo／cohortStageNo。
export function resolveGlobalPlanCampaign(row, { masterDefinition = CHURCH_CAMPAIGN } = {}) {
  const plan = row || {};
  const rules = plan.rules;
  const isCampaignMaster = plan.plan_kind === "church_campaign" || plan.id === CHURCH_CAMPAIGN_ID;
  const isCampaignStage = plan.plan_kind === "church_campaign_stage";
  const isCohortStage = plan.plan_kind === "church_campaign_stage_cohort";
  let campaignDefinition = null;
  let cohortStageNo = null;
  let cohortSourceStage = null;

  if (isCampaignMaster) {
    campaignDefinition = cloneChurchCampaign(hasStoredDefinition(rules) ? rules : masterDefinition);
  } else if (isCampaignStage) {
    // 正式階段的 id 尾 12 碼就是階段序（…c026-00000000000N）。
    const storedStageNo = Number(rules && rules.stageNo) || Number(String(plan.id || "").slice(-12));
    const stored = hasStoredDefinition(rules) ? rules : getChurchCampaignStageDefinition(storedStageNo);
    if (stored) campaignDefinition = cloneChurchCampaign(stored);
  } else if (isCohortStage) {
    // cohort 是隨機 UUID，階段序只能靠 rules 裡的 stageNo / cohortSourceStageNo。
    const rulesStageNo = Number(rules && (rules.stageNo ?? rules.cohortSourceStageNo ?? rules.cohortStageNo));
    cohortStageNo = Number.isFinite(rulesStageNo) && rulesStageNo > 0 ? rulesStageNo : null;
    cohortSourceStage = cohortStageNo ? getChurchCampaignStageDefinition(cohortStageNo) : null;
  }
  return { isCampaignMaster, isCampaignStage, isCohortStage, campaignDefinition, cohortStageNo, cohortSourceStage };
}

// global_plans 一列在 App 上的起訖、書卷、預設代號（mapGlobalPlanRecord 的同名欄位）。
export function globalPlanScheduleFields(row, resolved = resolveGlobalPlanCampaign(row)) {
  const plan = row || {};
  const { campaignDefinition, isCohortStage, cohortSourceStage } = resolved;
  const campaignBooks = campaignDefinition
    ? Array.from(new Set(campaignDefinition.segments.flatMap(segment => segment.readings.map(reading => reading.book))))
    : [];
  // cohort 沒有 campaignDefinition：經卷用 DB 這一列的 target_books，缺的話退回來源階段的書卷。
  const cohortBooks = (cohortSourceStage && Array.isArray(cohortSourceStage.books) && cohortSourceStage.books.length)
    ? cohortSourceStage.books.slice()
    : [];
  return {
    startDate: campaignDefinition ? campaignDefinition.startDate : plan.start_date,
    endDate: campaignDefinition ? campaignDefinition.endDate : plan.end_date,
    books: Array.isArray(plan.target_books) && plan.target_books.length > 0
      ? plan.target_books
      : (isCohortStage ? cohortBooks : campaignBooks),
    presetKey: isCohortStage
      ? ((plan.rules && plan.rules.presetKey) || plan.id)
      : (campaignDefinition && campaignDefinition.presetKey ? campaignDefinition.presetKey : plan.id)
  };
}

// 伺服器用：global_plans 一列 → { 計畫欄位, baselineDays }。
// 教會活動走 buildChurchCampaignDays（同 getCanonicalStageScheduleDays，不套個人休息日）；
// 其他計畫走平均分配。
export function buildGlobalPlanBaseline(row, { bibleBooks = BIBLE_BOOK_CHAPTERS } = {}) {
  const resolved = resolveGlobalPlanCampaign(row);
  const fields = globalPlanScheduleFields(row, resolved);
  const plan = {
    id: row && row.id,
    name: row && row.name,
    planKind: row && row.plan_kind,
    ...fields,
    campaignDefinition: resolved.campaignDefinition
  };
  let baselineDays = resolved.campaignDefinition
    ? buildChurchCampaignDays(resolved.campaignDefinition, bibleBooks, [])
    : [];
  if (!baselineDays.length) {
    baselineDays = buildEvenScheduleDays({ startDate: fields.startDate, endDate: fields.endDate, books: fields.books, bibleBooks });
  }
  return { plan, baselineDays };
}

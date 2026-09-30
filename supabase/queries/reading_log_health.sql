-- 打卡健康檢查（唯讀，#350）
-- 用途：上線打卡相關改動後每天跑一次，看打卡量、進度缺口、打卡被拒比例有沒有異常。
-- 用法：在 Supabase SQL Editor 一次貼一段（每段都是獨立的單一 SELECT），
--       不使用暫存表、不用 BEGIN/COMMIT，也不會修改任何資料。
-- 日期一律以 Asia/Taipei 計算。

-- ============================================================
-- a. 最近 14 天每日打卡量
--    rows = 打卡筆數、users = 不重複打卡人數。
--    正常應該平穩；某天突然掉到接近 0 = 打卡可能壞了。
-- ============================================================
SELECT
  (rl.read_at AT TIME ZONE 'Asia/Taipei')::date AS taipei_date,
  count(*)                                       AS rows,
  count(DISTINCT rl.user_id)                     AS users
FROM public.reading_logs rl
WHERE rl.read_at >= ((date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') - interval '13 days') AT TIME ZONE 'Asia/Taipei')
GROUP BY 1
ORDER BY 1 DESC;

-- ============================================================
-- b. 進行中速讀計畫的「跳章缺口」
--    缺口 = 目前這一遍裡，最後一個已打卡章節之前，還有沒打卡的章節。
--    章節順序 = target_books 的順序，再依章號。
--    每個計畫一列：enrolled 報名人數、users_with_gap 有缺口人數、gap_chapters 缺口章數總和。
--    users_with_gap 突然變多 = 可能有打卡漏寫或被誤拒。
--    下面 VALUES 是 66 卷章數表，書名與 js/data/bible_data.js 完全一致。
-- ============================================================
WITH book_chapters(book_id, book, chapters) AS (
  VALUES
    (1, '創世記', 50),
    (2, '出埃及記', 40),
    (3, '利未記', 27),
    (4, '民數記', 36),
    (5, '申命記', 34),
    (6, '約書亞記', 24),
    (7, '士師記', 21),
    (8, '路得記', 4),
    (9, '撒母耳記上', 31),
    (10, '撒母耳記下', 24),
    (11, '列王紀上', 22),
    (12, '列王紀下', 25),
    (13, '歷代志上', 29),
    (14, '歷代志下', 36),
    (15, '以斯拉記', 10),
    (16, '尼希米記', 13),
    (17, '以斯帖記', 10),
    (18, '約伯記', 42),
    (19, '詩篇', 150),
    (20, '箴言', 31),
    (21, '傳道書', 12),
    (22, '雅歌', 8),
    (23, '以賽亞書', 66),
    (24, '耶利米書', 52),
    (25, '耶利米哀歌', 5),
    (26, '以西結書', 48),
    (27, '但以理書', 12),
    (28, '何西阿書', 14),
    (29, '約珥書', 3),
    (30, '阿摩司書', 9),
    (31, '俄巴底亞書', 1),
    (32, '約拿書', 4),
    (33, '彌迦書', 7),
    (34, '那鴻書', 3),
    (35, '哈巴谷書', 3),
    (36, '西番雅書', 3),
    (37, '哈該書', 2),
    (38, '撒迦利亞書', 14),
    (39, '瑪拉基書', 4),
    (40, '馬太福音', 28),
    (41, '馬可福音', 16),
    (42, '路加福音', 24),
    (43, '約翰福音', 21),
    (44, '使徒行傳', 28),
    (45, '羅馬書', 16),
    (46, '哥林多前書', 16),
    (47, '哥林多後書', 13),
    (48, '加拉太書', 6),
    (49, '以弗所書', 6),
    (50, '腓立比書', 4),
    (51, '歌羅西書', 4),
    (52, '帖撒羅尼迦前書', 5),
    (53, '帖撒羅尼迦後書', 3),
    (54, '提摩太前書', 6),
    (55, '提摩太後書', 4),
    (56, '提多書', 3),
    (57, '腓利門書', 1),
    (58, '希伯來書', 13),
    (59, '雅各書', 5),
    (60, '彼得前書', 5),
    (61, '彼得後書', 3),
    (62, '約翰一書', 5),
    (63, '約翰二書', 1),
    (64, '約翰三書', 1),
    (65, '猶大書', 1),
    (66, '啟示錄', 22)
),
active_plans AS (
  SELECT g.id AS global_plan_id, g.name AS plan_name, g.target_books
  FROM public.global_plans g
  WHERE g.plan_kind IN ('church_campaign', 'church_campaign_stage', 'church_campaign_stage_cohort')
    AND g.is_hidden = FALSE
    AND (now() AT TIME ZONE 'Asia/Taipei')::date BETWEEN g.start_date AND g.end_date
),
plan_chapters AS (
  -- 每個計畫展開成有序章節清單（seq 從 1 起）
  SELECT
    ap.global_plan_id,
    ap.plan_name,
    t.book,
    c.chapter,
    row_number() OVER (PARTITION BY ap.global_plan_id ORDER BY t.ord, c.chapter) AS seq
  FROM active_plans ap
  CROSS JOIN LATERAL unnest(ap.target_books) WITH ORDINALITY AS t(book, ord)
  JOIN book_chapters bc ON bc.book = t.book
  CROSS JOIN LATERAL generate_series(1, bc.chapters) AS c(chapter)
),
enrolled AS (
  SELECT rp.id AS reading_plan_id, rp.global_plan_id, rp.current_round
  FROM public.reading_plans rp
  JOIN active_plans ap ON ap.global_plan_id = rp.global_plan_id
),
marked AS (
  -- 每位報名者 × 每個章節：這一遍有沒有打卡；用視窗函式取「最後已打卡的 seq」
  SELECT
    e.global_plan_id,
    e.reading_plan_id,
    pc.seq,
    (rl.id IS NOT NULL) AS is_read,
    max(pc.seq) FILTER (WHERE rl.id IS NOT NULL) OVER (PARTITION BY e.reading_plan_id) AS last_read_seq
  FROM enrolled e
  JOIN plan_chapters pc ON pc.global_plan_id = e.global_plan_id
  LEFT JOIN public.reading_logs rl
    ON rl.plan_id = e.reading_plan_id
   AND rl.book = pc.book
   AND rl.chapter = pc.chapter
   AND rl.round = e.current_round
),
per_user AS (
  SELECT
    global_plan_id,
    reading_plan_id,
    count(*) FILTER (WHERE NOT is_read AND seq < last_read_seq) AS gap_chapters
  FROM marked
  GROUP BY global_plan_id, reading_plan_id
)
SELECT
  ap.plan_name,
  count(pu.reading_plan_id)                          AS enrolled,
  count(*) FILTER (WHERE pu.gap_chapters > 0)        AS users_with_gap,
  COALESCE(sum(pu.gap_chapters), 0)                  AS total_gap_chapters
FROM active_plans ap
LEFT JOIN per_user pu ON pu.global_plan_id = ap.global_plan_id
GROUP BY ap.global_plan_id, ap.plan_name
ORDER BY ap.plan_name;

-- ============================================================
-- c. 最近 14 天打卡結果（記錄／取消 的成功與被拒）
--    ※ 需先套用 #355（新增 public.check_in_events 表）才能執行；未套用會報 relation does not exist。
--    每天一列：total 總筆數、ok 成功、rejected 被拒、rejection_rate_pct 被拒比例(%)、
--    top_reasons 被拒原因前三名（原因:次數）。被拒比例明顯上升 = 新規則擋到正常打卡。
-- ============================================================
WITH ev AS (
  SELECT
    (e.created_at AT TIME ZONE 'Asia/Taipei')::date AS taipei_date,
    e.ok,
    e.reason
  FROM public.check_in_events e
  WHERE e.created_at >= ((date_trunc('day', now() AT TIME ZONE 'Asia/Taipei') - interval '13 days') AT TIME ZONE 'Asia/Taipei')
),
daily AS (
  SELECT
    taipei_date,
    count(*)                        AS total,
    count(*) FILTER (WHERE ok)      AS ok,
    count(*) FILTER (WHERE NOT ok)  AS rejected
  FROM ev
  GROUP BY taipei_date
),
reason_counts AS (
  SELECT
    taipei_date,
    COALESCE(reason, '(無原因)') AS reason,
    count(*) AS n,
    row_number() OVER (PARTITION BY taipei_date ORDER BY count(*) DESC, COALESCE(reason, '(無原因)')) AS rn
  FROM ev
  WHERE NOT ok
  GROUP BY taipei_date, COALESCE(reason, '(無原因)')
),
top_reasons AS (
  SELECT taipei_date, string_agg(reason || ':' || n, ', ' ORDER BY rn) AS top_reasons
  FROM reason_counts
  WHERE rn <= 3
  GROUP BY taipei_date
)
SELECT
  d.taipei_date,
  d.total,
  d.ok,
  d.rejected,
  round(100.0 * d.rejected / NULLIF(d.total, 0), 2) AS rejection_rate_pct,
  tr.top_reasons
FROM daily d
LEFT JOIN top_reasons tr USING (taipei_date)
ORDER BY d.taipei_date DESC;

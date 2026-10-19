# 經文注釋匯入流程 2.0（Tyndale Open Study Notes，#471、#476、#542）

閱讀器的逐節注釋來自 Tyndale Open Study Notes（TOSN，CC BY-SA 4.0）翻成繁體中文。工具都在
`scripts/commentary-import/`，每一卷照下面的步驟走。匯入後**以資料庫為準**（審核者會改譯文），
`content/commentary/tosn/<書>.json` 只是初稿；公開版本用匯出工具從資料庫產生。

## 一卷書的步驟

| 步驟 | 指令 | 產出 |
|---|---|---|
| 1. 取出 | `node scripts/commentary-import/extract.mjs <StudyNotes.xml> <書名>` | `content/commentary/tosn/<書>.json`：英文原文、預處理稿、交叉引用、片語、原文字、指紋 |
| 2. 翻譯輸入檔 | `node scripts/commentary-import/prepare.mjs <書名> [--write-glossary]` | `.cache/commentary/input/<書>.json`（不進版控） |
| 3. 翻譯 | 照輸入檔的 `instructions` 把每則譯進步驟 1 的 JSON（`zh`、跨章總覽的 `title`） | |
| 4. 對齊 | `node scripts/commentary-import/align.mjs <書名>` | 出處標籤對齊譯文寫法、片語填上和合本字句 |
| 5. 匯入 | `node scripts/commentary-import/build-sql.mjs content/commentary/tosn/<書>.json > 匯入.sql`，再 `npx supabase db query --linked --project-ref <ref> -f 匯入.sql` | 待審、未發布；先 staging 再正式站 |
| 6. 審核 | 後台「經文注釋」指派審核者 → 我的審核 → 最終發布 | |
| 7. 匯出 | `node scripts/commentary-import/export.mjs <書名> --project-ref <ref>` | `content/commentary/reviewed/<書>.json`（審核通過＋已發布） |

StudyNotes.xml 在 https://tyndaleopenresources.com/ 的 `tyndale_open-studynotes.zip`；壓縮檔不要放進 repo。

## 程式預處理（不交給 AI）

- **交叉引用**：`<a href="?bref=Exod.27.21">Exod 27:21</a>` 直接換成和合本縮寫（`js/data/bible_data.js` 的
  `abbrev`）：「出27:21」；錨點沒寫書名就不加（「7:8」）；只有節號照寫（「1:1、21」的 21）；整章寫「賽53章」
  （詩篇「詩2篇」）；「ch 1」「Chapter 18」寫「第1章」；跨卷「撒上1:1—王下25:30」。`?item=…_StudyNote_Filament`
  是「see study note on …」→「見5:17-19的注釋」。主題文章（`_ThemeNote_`）照原文。
- **固定句型**：cp./cf. →「參」、e.g. →「例如」、i.e. →「也就是」；「•」分開的每段變成獨立段落。
- **片語**：`sn-excerpt`（含被拆開的 `sn-excerpt-divine-name`）＝被解釋的經文片語；英文後面接冒號的是段首標題。
- **原文字**：`<span class="hebrew|greek|aramaic">` 的拼音，在這則經文範圍的 Strong's 編號裡找最像的
  （Open Scriptures 詞典的拼音，正規化後相似度 ≥ 0.7），對到的附上和合本用詞；對不到的留給譯者。
- **指紋**：每則 `<body>` 的 sha256。TOSN 改版重跑 extract 時，指紋變了的那幾則清空 `zh`（舊譯文留在
  `zh_previous`），build-sql 會停下來等重翻；舊檔沒有指紋的當作沒變。

## 翻譯參考資料（只當參考，不放進內文、不在 App 顯示）

快取在 `.cache/commentary/`（不進版控），第一次執行自動下載：

- 和合本＋Strong's：信望愛 `qb.php?strong=1&version=unv`（FDL），按章抓、每章間隔 0.4 秒。
- 當代譯本繁體版：ebible.org `cmncbt_usfm.zip`（Biblica，CC BY-SA 4.0；衍生作品要移除 Biblica 商標）。
- Strong's 詞典：Open Scriptures strongs（CC BY-SA）。

翻譯輸入檔每則附：預處理稿、片語、這幾節的和合本／當代譯本／Strong's 用詞對照（超過 20 節只附起始節）、
原文字對照、用語表條目。**受版權保護的中文注釋**（啟導本、天道、新譯本研讀版、信望愛注釋等）不可以載入或整本
比對，只可以整理用詞對照（屬事實）進用語表。

## 用語表

`content/commentary/glossary.json`：英文寫法→中文（以和合本用語為準），可附原文拼音與 Strong's 編號。
`prepare.mjs --write-glossary` 會把拼音對到、用語表還沒有的原文字補進去並標 `auto: true`；和合本分詞常帶前後字
（例如「我的典章」），校正完拿掉 `auto`。

## 資料欄位（`passage_commentary`，migration `20261019094508_commentary_import_structure.sql`）

| 欄位 | 內容 |
|---|---|
| `chapter_end`、`chapter_end_verse` | 跨章範圍的結束章／節。`verse_start`／`verse_end` 仍是掛在起始章的位置（舊版前端照舊） |
| `cross_refs` | `[{ book, chapter, verse, chapter_end, verse_end, label, note?, end_book? }]`；整章出處 `verse` 是 null |
| `excerpts` | `[{ en, zh, chapter, verse, heading }]`；只存配到和合本字句的 |
| `source_version`、`source_hash` | 例如 `TOSN 1.25` 與原文指紋 |

閱讀器（`js/data/passage-commentary.mjs`）：`label` 在譯文裡找得到就做成按鈕，點了跳到那一節；片語在說明裡加粗、
在引用經文裡標出；跨章注釋在整段每一章的第一個涵蓋節都有 icon。審核者改譯文時要保留出處寫法（審核卡片會列出來）。

## 已匯入書卷補結構

利未記（#471）是舊流程匯入的。補新結構、不動譯文與審核狀態：

1. `extract.mjs`（保留譯文，補預處理稿、出處、片語、指紋）→ `align.mjs`。
2. `build-sql.mjs content/commentary/tosn/leviticus.json --structure > 補結構.sql`，先 staging 再正式站執行
   （需要先套用上面的 migration）。只用 `source_ref` 對應更新，資料庫沒有的列不會新增。

利未記目前：出處 1,100／1,111 在譯文裡找得到；片語 241／459 配到和合本字句（舊譯文常把行內片語直接譯掉、
沒有加「」，配不到的就不加粗）。

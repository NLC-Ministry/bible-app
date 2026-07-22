// Admin editor for versioned church campaign rules.
function openCampaignRuleEditor(plan) {
  const definition = window.cloneChurchCampaign(plan.campaignDefinition || window.CHURCH_CAMPAIGN);
  document.getElementById("campaign-rule-editor")?.remove();

  const formatReadings = readings => (readings || []).map(reading =>
    reading.to ? `${reading.book} ${reading.from || 1}-${reading.to}` : reading.book
  ).join("\uff1b");
  const parseReadings = value => String(value || "").split(/[\uff1b;\n]/).map(value => value.trim()).filter(Boolean).map(value => {
    const match = value.match(/^(.+?)\s+(\d+)(?:\s*-\s*(\d+))?$/);
    return match
      ? { book: match[1].trim(), from: Number(match[2]), to: Number(match[3] || match[2]) }
      : { book: value, from: 1, to: null };
  });
  const addDays = (isoDate, days) => {
    const date = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    date.setDate(date.getDate() + days);
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  };

  const renderStageRow = (stage, originalIndex = "") => `
    <div class="campaign-stage-row" data-original-index="${originalIndex}" data-round-no="${Number(stage.roundNo) || Number(stage.stageNo) || 1}" data-phase="${escapeHTML(stage.phase || "full")}">
      <input data-field="stageNo" type="number" min="1" required class="form-control" aria-label="階段編號" value="${Number(stage.stageNo) || 1}">
      <input data-field="name" required class="form-control" aria-label="輪次或階段名稱" placeholder="例如：第九輪" value="${escapeHTML(stage.name || "")}">
      <input data-field="startDate" type="date" required class="form-control" aria-label="閱讀開始日期" value="${escapeHTML(stage.startDate || "")}">
      <input data-field="endDate" type="date" required class="form-control" aria-label="閱讀結束日期" value="${escapeHTML(stage.endDate || "")}">
      <input data-field="examDate" type="date" class="form-control" aria-label="測驗或頒獎日期（選填）" value="${escapeHTML(stage.examDate || "")}">
      <input data-field="awardName" required class="form-control" aria-label="完成獎項" placeholder="例如：磐石獎" value="${escapeHTML(stage.awardName || "")}">
      <button type="button" class="campaign-stage-remove" data-remove-stage aria-label="刪除此輪次" title="刪除此輪次">
        <span class="nlc-icon nlc-icon--sm" data-icon="trash" aria-hidden="true"></span>
      </button>
    </div>`;

  const renderSegmentRow = (segment, originalIndex = "") => `
    <div class="campaign-segment-row" data-original-index="${originalIndex}" data-round-no="${Number(segment.roundNo) || Number(segment.stageNo) || 1}">
      <input data-field="stageNo" type="number" min="1" required class="form-control" aria-label="所屬階段編號" value="${Number(segment.stageNo) || 1}">
      <input data-field="label" required class="form-control" aria-label="月份或排程區段" placeholder="例如：2029年9月" value="${escapeHTML(segment.label || "")}">
      <input data-field="startDate" type="date" required class="form-control" aria-label="排程開始日期" value="${escapeHTML(segment.startDate || "")}">
      <input data-field="endDate" type="date" required class="form-control" aria-label="排程結束日期" value="${escapeHTML(segment.endDate || "")}">
      <input data-field="readings" required class="form-control" aria-label="經卷與章節" placeholder="創世記 1-50；出埃及記 1-40" value="${escapeHTML(formatReadings(segment.readings))}">
    </div>`;

  const overlay = document.createElement("div");
  overlay.id = "campaign-rule-editor";
  overlay.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;padding:1rem;";
  overlay.innerHTML = `
    <form id="campaign-rule-form" class="glass-card" style="width:min(1180px,100%);max-height:92vh;overflow:auto;padding:1.25rem;background:var(--bg-card);border:1px solid var(--border-card);">
      <div style="display:flex;justify-content:space-between;gap:1rem;margin-bottom:1rem;">
        <div><h3 style="margin:0;color:var(--text-primary);">\u7de8\u8f2f\u6559\u6703\u8b80\u7d93\u8a08\u756b\u898f\u5247</h3>
        <p style="margin:.3rem 0 0;font-size:.78rem;color:var(--text-muted);">\u76ee\u524d\u7248\u672c v${Number(plan.ruleVersion || 1)}\uff1b\u767c\u5e03\u6703\u4fdd\u7559\u820a\u7248\u672c\u8207\u65e2\u6709\u6253\u5361\u3002</p></div>
        <button type="button" data-close class="secondary-btn">\u95dc\u9589</button>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:.6rem;margin-bottom:1rem;">
        <label style="grid-column:1/-1;font-size:.76rem;color:var(--text-secondary);">\u8a08\u756b\u540d\u7a31<input id="campaign-name" class="form-control" value="${escapeHTML(definition.name)}"></label>
        <label style="grid-column:1/-1;font-size:.76rem;color:var(--text-secondary);">\u8a08\u756b\u8aaa\u660e<textarea id="campaign-description" class="form-control" rows="2">${escapeHTML(definition.description || "")}</textarea></label>
        <label style="font-size:.76rem;color:var(--text-secondary);">\u958b\u59cb\u65e5\u671f<input id="campaign-start" type="date" class="form-control" value="${definition.startDate}"></label>
        <label style="font-size:.76rem;color:var(--text-secondary);">\u7d50\u675f\u65e5\u671f<input id="campaign-end" type="date" class="form-control" value="${definition.endDate}"></label>
        <label style="font-size:.76rem;color:var(--text-secondary);">\u8b8a\u66f4\u7bc4\u570d<select id="campaign-change-mode" class="form-control"><option value="future_only">\u53ea\u8abf\u6574\u4eca\u5929\u4ee5\u5f8c</option><option value="all">\u91cd\u65b0\u5957\u7528\u5168\u90e8\u65e5\u671f</option></select></label>
      </div>
      <fieldset style="border:1px solid var(--border-card);border-radius:12px;padding:.8rem;margin:0 0 1rem;">
        <legend style="font-size:.86rem;color:var(--text-primary);">\u53c3\u8cfd\u8207\u5206\u968a</legend>
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.6rem;">
          <label>\u5c0f\u5bb6\u6700\u5c11<input id="small-home-min" type="number" min="2" max="4" class="form-control" value="${definition.rules.teamRules.smallHome.min}"></label>
          <label>\u5c0f\u5bb6\u6700\u591a<input id="small-home-max" type="number" min="2" max="4" class="form-control" value="${definition.rules.teamRules.smallHome.max}"></label>
          <label>\u5c0f\u7d44\u8cc7\u683c\u4eba\u6578<input id="small-group-min" type="number" min="6" class="form-control" value="${definition.rules.teamRules.smallGroup.min}"></label>
          <label style="padding-top:1.4rem;"><input id="campaign-mid-join" type="checkbox" ${definition.rules.allowMidJoin ? "checked" : ""}> \u5141\u8a31\u4e2d\u9014\u52a0\u5165</label>
        </div>
        <p style="font-size:.72rem;color:var(--text-muted);margin:.5rem 0 0;">\u5c0f\u7d44\u4f9d\u6703\u54e1\u57fa\u672c\u8cc7\u6599\u81ea\u52d5\u5206\u968a\uff0c\u9054\u8a2d\u5b9a\u4eba\u6578\u5373\u7b26\u5408\u8cc7\u683c\uff0c\u4e0d\u8a2d\u4e0a\u9650\u3002</p>
      </fieldset>
      <div class="campaign-rule-section-heading">
        <div>
          <h4>\u8f2a\u6b21\u3001\u6e2c\u9a57\u8207\u7d2f\u9032\u734e\u9805</h4>
          <p>閱讀日期決定計畫開放期間；測驗／頒獎日期可留空。</p>
        </div>
        <button type="button" id="campaign-add-stage" class="secondary-btn campaign-add-stage-btn">
          <span class="nlc-icon nlc-icon--sm" data-icon="plus" aria-hidden="true"></span><span>新增輪次</span>
        </button>
      </div>
      <div class="campaign-editor-table" aria-label="輪次設定表">
        <div class="campaign-stage-columns" aria-hidden="true">
          <span>階段</span><span>輪次／階段名稱</span><span>閱讀開始日期</span><span>閱讀結束日期</span><span>測驗／頒獎日期（選填）</span><span>完成獎項</span><span>操作</span>
        </div>
        <div id="campaign-stage-rows">
          ${definition.stages.map((stage, index) => renderStageRow(stage, index)).join("")}
        </div>
      </div>
      <div class="campaign-rule-section-heading campaign-rule-section-heading--schedule">
        <div><h4>\u7d93\u5377\u8207\u7ae0\u7bc0\u6392\u7a0b</h4><p>\u683c\u5f0f\uff1a\u5275\u4e16\u8a18 1-50\uff1b\u51fa\u57c3\u53ca\u8a18 1-40\u3002\u53ea\u5beb\u7d93\u5377\u540d\u7a31\u4ee3\u8868\u6574\u5377\u3002</p></div>
      </div>
      <div class="campaign-editor-table" aria-label="章節排程表">
        <div class="campaign-segment-columns" aria-hidden="true">
          <span>階段</span><span>月份／區段</span><span>排程開始日期</span><span>排程結束日期</span><span>經卷與章節</span>
        </div>
        <div id="campaign-segment-rows">
          ${definition.segments.map((segment, index) => renderSegmentRow(segment, index)).join("")}
        </div>
      </div>
      <div id="campaign-editor-result" role="alert" style="display:none;margin-top:.8rem;padding:.7rem;border-radius:10px;font-size:.78rem;"></div>
      <div style="position:sticky;bottom:-1.25rem;display:flex;justify-content:flex-end;gap:.6rem;margin:1rem -1.25rem -1.25rem;padding:.8rem 1.25rem;background:var(--bg-card);border-top:1px solid var(--border-card);">
        <button type="button" data-close class="secondary-btn">\u53d6\u6d88</button><button type="submit" class="primary-btn">\u9a57\u8b49\u4e26\u767c\u5e03\u65b0\u7248\u672c</button>
      </div>
    </form>`;
  document.body.appendChild(overlay);
  if (typeof hydrateIcons === "function") hydrateIcons(overlay);
  overlay.querySelector("#campaign-change-mode").value = definition.rules.applyChangesFrom || "future_only";
  overlay.querySelectorAll("[data-close]").forEach(button => button.onclick = () => overlay.remove());
  overlay.onclick = event => { if (event.target === overlay) overlay.remove(); };

  const stageRows = overlay.querySelector("#campaign-stage-rows");
  const segmentRows = overlay.querySelector("#campaign-segment-rows");
  overlay.querySelector("#campaign-add-stage").onclick = () => {
    const rows = Array.from(stageRows.querySelectorAll(".campaign-stage-row"));
    const stageNumbers = rows.map(row => Number(row.querySelector('[data-field="stageNo"]').value) || 0);
    const roundNumbers = rows.map(row => Number(row.dataset.roundNo) || 0);
    const lastEndDate = rows.map(row => row.querySelector('[data-field="endDate"]').value).filter(Boolean).sort().at(-1) || definition.endDate;
    const startDate = addDays(lastEndDate, 1);
    const endDate = addDays(startDate, 30);
    const stageNo = Math.max(0, ...stageNumbers) + 1;
    const roundNo = Math.max(0, ...roundNumbers) + 1;
    stageRows.insertAdjacentHTML("beforeend", renderStageRow({ stageNo, roundNo, phase: "full", name: `第${roundNo}輪`, startDate, endDate, examDate: null, awardName: "" }));
    segmentRows.insertAdjacentHTML("beforeend", renderSegmentRow({ stageNo, roundNo, label: "新排程", startDate, endDate, readings: [] }));
    if (typeof hydrateIcons === "function") hydrateIcons(stageRows.lastElementChild);
    stageRows.lastElementChild.querySelector('[data-field="name"]').focus();
    stageRows.lastElementChild.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  stageRows.addEventListener("click", event => {
    const removeButton = event.target.closest("[data-remove-stage]");
    if (!removeButton) return;
    const row = removeButton.closest(".campaign-stage-row");
    if (stageRows.querySelectorAll(".campaign-stage-row").length <= 1) {
      showToast("教會計畫至少需要保留一個輪次。");
      return;
    }
    const stageNo = Number(row.querySelector('[data-field="stageNo"]').value);
    const stageName = row.querySelector('[data-field="name"]').value.trim() || `第 ${stageNo} 階段`;
    if (!confirm(`確定刪除「${stageName}」？此輪次的經卷排程也會移除；若已有參加者，該輪進度與打卡紀錄會在發布後一併刪除。發布前不會寫入後台。`)) return;
    Array.from(segmentRows.querySelectorAll(".campaign-segment-row")).forEach(segmentRow => {
      if (Number(segmentRow.querySelector('[data-field="stageNo"]').value) === stageNo) segmentRow.remove();
    });
    row.remove();
  });

  overlay.querySelector("#campaign-rule-form").onsubmit = async event => {
    event.preventDefault();
    const next = window.cloneChurchCampaign(definition);
    next.name = overlay.querySelector("#campaign-name").value.trim();
    next.description = overlay.querySelector("#campaign-description").value.trim();
    next.startDate = overlay.querySelector("#campaign-start").value;
    next.endDate = overlay.querySelector("#campaign-end").value;
    next.rules.applyChangesFrom = overlay.querySelector("#campaign-change-mode").value;
    next.rules.allowMidJoin = overlay.querySelector("#campaign-mid-join").checked;
    next.rules.teamRules.smallHome.min = Number(overlay.querySelector("#small-home-min").value);
    next.rules.teamRules.smallHome.max = Number(overlay.querySelector("#small-home-max").value);
    next.rules.teamRules.smallGroup.min = Number(overlay.querySelector("#small-group-min").value);
    next.rules.teamRules.smallGroup.max = null;
    next.rules.teamRules.smallGroup.source = "profile.small_group";

    next.stages = Array.from(stageRows.querySelectorAll(".campaign-stage-row")).map(row => {
      const value = field => row.querySelector(`[data-field="${field}"]`).value;
      return { stageNo: Number(value("stageNo")), roundNo: Number(row.dataset.roundNo) || Number(value("stageNo")), phase: row.dataset.phase || "full", name: value("name").trim(), startDate: value("startDate"), endDate: value("endDate"), examDate: value("examDate") || null, awardName: value("awardName").trim() };
    });
    const editedSegments = Array.from(segmentRows.querySelectorAll(".campaign-segment-row")).map(row => {
      const value = field => row.querySelector(`[data-field="${field}"]`).value;
      return {
        originalIndex: row.dataset.originalIndex === "" ? null : Number(row.dataset.originalIndex),
        segment: { stageNo: Number(value("stageNo")), roundNo: Number(row.dataset.roundNo) || Number(value("stageNo")), label: value("label").trim(), startDate: value("startDate"), endDate: value("endDate"), readings: parseReadings(value("readings")) }
      };
    });
    next.segments = editedSegments.map(entry => entry.segment);

    if (next.rules.applyChangesFrom === "future_only") {
      const today = new Date();
      const todayIso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
      const stagesByNumber = new Map(next.stages.map(stage => [Number(stage.stageNo), stage]));
      definition.stages.forEach(stage => {
        if (stage.endDate < todayIso) stagesByNumber.set(Number(stage.stageNo), stage);
      });
      next.stages = Array.from(stagesByNumber.values()).sort((a, b) => Number(a.stageNo) - Number(b.stageNo));

      const segmentsByOriginalIndex = new Map(editedSegments.filter(entry => entry.originalIndex != null).map(entry => [entry.originalIndex, entry.segment]));
      definition.segments.forEach((segment, index) => {
        if (segment.endDate < todayIso) segmentsByOriginalIndex.set(index, segment);
      });
      const addedSegments = editedSegments.filter(entry => entry.originalIndex == null).map(entry => entry.segment);
      next.segments = [...segmentsByOriginalIndex.values(), ...addedSegments].sort((a, b) => a.startDate.localeCompare(b.startDate));
    }

    const validation = window.validateChurchCampaign(next, BIBLE_BOOKS);
    const result = overlay.querySelector("#campaign-editor-result");
    result.style.display = "block";
    if (!validation.valid) {
      result.style.background = "var(--color-danger-soft)";
      result.style.color = "var(--color-danger)";
      result.textContent = validation.errors.join(" ");
      return;
    }
    result.style.background = "var(--color-success-soft)";
    result.style.color = "var(--color-success-foreground)";
    result.textContent = `\u9a57\u8b49\u901a\u904e\uff1a\u5171 ${validation.chapterCount} \u7ae0\u3002${validation.warnings.join(" ")}`;
    if (!confirm(`\u78ba\u8a8d\u767c\u5e03\u65b0\u7248\u672c\uff1f\u76ee\u524d\u6392\u7a0b\u5171 ${validation.chapterCount} \u7ae0\u3002`)) return;

    loader.show("\u6b63\u5728\u767c\u5e03\u6559\u6703\u8a08\u756b\u65b0\u7248\u672c\u2026");
    const published = await db.publishCampaignRules(plan, next);
    loader.hide();
    if (!published.success) return;
    overlay.remove();
    if (published.storage === "supabase" && published.persistenceVerified) {
      showToast(`教會計畫 v${published.version} 已發布，並完成 Supabase 儲存驗證。`);
    } else if (published.storage === "supabase") {
      showToast(`教會計畫 v${published.version} 已寫入，但回讀驗證未完成，請重新整理確認。`);
    } else {
      showToast(`教會計畫 v${published.version} 已發布。`);
    }
    if (typeof renderPlanView === "function") await renderPlanView();
  };
}
window.openCampaignRuleEditor = openCampaignRuleEditor;

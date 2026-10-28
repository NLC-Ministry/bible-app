// 計畫分頁裡「系統管理員」才看得到的計畫增刪改卡片（#admin-plan-card）與大區延後梯次面板。
// #370 從 plan.js 拆出來成為獨立 lazy chunk：只有管理員會載入（app.js 的
// ensurePlanFeatureModulesLoaded），一般會友開計畫分頁不會下載這段程式碼。
import {
  registerPlanAdminRenderer,
  renderPresetPlansList,
  renderJoinedPlansList,
  renderPlanScheduleTracker
} from "./plan.js";
import { isCampaignStageKind } from "../data/campaign-stage-kinds.mjs";

function initAdminPlanManagement() {
  const addBtn = document.getElementById("admin-add-plan-btn");
  const cancelBtn = document.getElementById("admin-cancel-plan-btn");
  const saveBtn = document.getElementById("admin-save-plan-btn");
  const formContainer = document.getElementById("admin-plan-form-container");

  if (!addBtn || !cancelBtn || !saveBtn || !formContainer) return;

  // Render Bible books selection grids
  const oldGrid = document.getElementById("admin-old-books-grid");
  const newGrid = document.getElementById("admin-new-books-grid");

  if (oldGrid && newGrid) {
    oldGrid.innerHTML = "";
    newGrid.innerHTML = "";
    BIBLE_BOOKS.forEach(book => {
      const label = document.createElement("label");
      label.className = "admin-book-option";
      label.innerHTML = `
        <input type="checkbox" class="admin-book-checkbox" value="${book.name}">
        <span class="admin-book-option__name">${book.name}</span>
      `;
      if (book.section === "old") {
        oldGrid.appendChild(label);
      } else {
        newGrid.appendChild(label);
      }
    });
  }

  // Bind quick select buttons
  const btnSelectAll = document.getElementById("admin-select-all-books");
  if (btnSelectAll) {
    btnSelectAll.onclick = () => {
      document.querySelectorAll(".admin-book-checkbox").forEach(cb => cb.checked = true);
    };
  }
  const btnClear = document.getElementById("admin-clear-books");
  if (btnClear) {
    btnClear.onclick = () => {
      document.querySelectorAll(".admin-book-checkbox").forEach(cb => cb.checked = false);
    };
  }
  const btnSelectOld = document.getElementById("admin-select-old-books");
  if (btnSelectOld) {
    btnSelectOld.onclick = () => {
      BIBLE_BOOKS.forEach(book => {
        const cb = document.querySelector(`.admin-book-checkbox[value="${book.name}"]`);
        if (cb) cb.checked = book.section === "old";
      });
    };
  }
  const btnSelectNew = document.getElementById("admin-select-new-books");
  if (btnSelectNew) {
    btnSelectNew.onclick = () => {
      BIBLE_BOOKS.forEach(book => {
        const cb = document.querySelector(`.admin-book-checkbox[value="${book.name}"]`);
        if (cb) cb.checked = book.section === "new";
      });
    };
  }

  // Bind schedule time type radios change
  const typeRadios = document.getElementsByName("admin-plan-time-type");
  const dateInputs = document.getElementById("admin-plan-date-inputs");
  const durationContainer = document.getElementById("admin-plan-duration-container");

  const toggleTimeTypeFields = (type) => {
    if (type === "flexible") {
      if (dateInputs) dateInputs.style.display = "none";
      if (durationContainer) durationContainer.style.display = "block";
    } else {
      if (dateInputs) dateInputs.style.display = "grid";
      if (durationContainer) durationContainer.style.display = "none";
    }
  };

  typeRadios.forEach(radio => {
    radio.onchange = (e) => toggleTimeTypeFields(e.target.value);
  });

  // Toggle Form
  addBtn.onclick = () => {
    document.getElementById("admin-plan-form-title").textContent = "新增讀經計畫";
    document.getElementById("admin-edit-plan-id").value = "";
    document.getElementById("admin-plan-name").value = "";
    document.getElementById("admin-plan-start-date").value = "";
    document.getElementById("admin-plan-end-date").value = "";
    const durationInput = document.getElementById("admin-plan-duration-days");
    if (durationInput) durationInput.value = "";

    // Set fixed as default
    const fixedRadio = document.querySelector('input[name="admin-plan-time-type"][value="fixed"]');
    if (fixedRadio) fixedRadio.checked = true;
    toggleTimeTypeFields("fixed");

    document.querySelectorAll(".admin-book-checkbox").forEach(cb => cb.checked = false);
    formContainer.classList.remove("hidden");
  };

  cancelBtn.onclick = () => {
    formContainer.classList.add("hidden");
  };

  // Save Plan
  saveBtn.onclick = async () => {
    const id = document.getElementById("admin-edit-plan-id").value;
    const name = document.getElementById("admin-plan-name").value.trim();

    // Determine time type selection
    const checkedRadio = document.querySelector('input[name="admin-plan-time-type"]:checked');
    const isFixed = checkedRadio ? checkedRadio.value === "fixed" : true;

    let startDate = "";
    let endDate = "";

    if (isFixed) {
      startDate = document.getElementById("admin-plan-start-date").value;
      endDate = document.getElementById("admin-plan-end-date").value;

      if (!startDate || !endDate) {
        alert("請選擇計畫開始與結束日期！");
        return;
      }
      if (new Date(startDate) > new Date(endDate)) {
        alert("開始日期不可晚於結束日期！");
        return;
      }
    } else {
      const durationVal = document.getElementById("admin-plan-duration-days").value;
      const durationDays = parseInt(durationVal);
      if (!durationVal || isNaN(durationDays) || durationDays <= 0) {
        alert("請輸入有效的計畫總天數！");
        return;
      }

      // Generate start/end dates for the template starting today to satisfy database constraints
      const getLocalDateString = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };

      const today = new Date();
      startDate = getLocalDateString(today);
      const end = new Date(today);
      end.setDate(today.getDate() + durationDays - 1);
      endDate = getLocalDateString(end);
    }

    const checkedBooks = [];
    document.querySelectorAll(".admin-book-checkbox:checked").forEach(cb => {
      checkedBooks.push(cb.value);
    });

    if (!name) {
      alert("請輸入計畫名稱！");
      return;
    }
    if (checkedBooks.length === 0) {
      alert("請至少選取一個聖經書卷！");
      return;
    }

    loader.show("正在儲存計畫...");
    const success = await db.saveGlobalPlan({
      id: id || null,
      name,
      startDate,
      endDate,
      books: checkedBooks,
      isFixed: isFixed
    });
    loader.hide();

    if (success) {
      if (typeof showToast === "function") {
        showToast("計畫儲存成功！已自動同步更新所有使用者的挑戰時間。");
      } else {
        alert("計畫儲存成功！");
      }

      // 💡 關鍵修復：儲存成功後，重新載入用戶的活動計畫資料，使主頁挑戰卡片的進度與時間即時重新計算
      if (typeof db !== "undefined" && db.loadUserData) {
        await db.loadUserData();
      }
      if (typeof updateDashboardView === "function") {
        updateDashboardView();
      }
      if (typeof renderPlanScheduleTracker === "function") {
        renderPlanScheduleTracker(true);
      }

      formContainer.classList.add("hidden");
      renderAdminPlanManagement();
      if (typeof renderPresetPlansList === 'function') {
        renderPresetPlansList();
      }
    }
  };
}

// 來源選單：全教會正式階段（含 4 張月度期末賽），依開始日排序。每次重繪都重填，保留目前選的那張。
function fillRegionCohortSourceOptions() {
  const sourceSel = document.getElementById("cohort-source");
  if (!sourceSel) return;
  const selected = sourceSel.value;
  const sources = (state.globalPlans || [])
    .filter(plan => plan && plan.planKind === "church_campaign_stage")
    .slice()
    .sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")));
  sourceSel.innerHTML = sources.length
    ? sources.map(plan => `<option value="${escapeHTML(plan.id)}">${escapeHTML(plan.name || plan.id)}</option>`).join("")
    : `<option value="">（尚無全教會階段計畫）</option>`;
  if (selected && sources.some(plan => String(plan.id) === selected)) sourceSel.value = selected;
}

// 延後大區梯次：後台小面板（#633：只新增；修改從計畫列表的「編輯」／「開放給使用者」）
function wireRegionCohortPanel() {
  const box = document.getElementById("admin-region-cohort");
  if (!box) return;
  fillRegionCohortSourceOptions();
  if (box.dataset.wired === "1") return;
  box.dataset.wired = "1";

  const regionSel = document.getElementById("cohort-region");
  if (regionSel) {
    const regions = (state.orgStructure && state.orgStructure.regions) || [];
    regionSel.innerHTML = regions.length
      ? regions.map(r => `<option value="${escapeHTML(r)}">${escapeHTML(r)}</option>`).join("")
      : `<option value="">（尚無大區資料）</option>`;
  }

  const btn = document.getElementById("cohort-create-btn");
  btn?.addEventListener("click", async () => {
    const greatRegion = (document.getElementById("cohort-region")?.value || "").trim();
    const sourcePlanId = document.getElementById("cohort-source")?.value || "";
    const startDate = document.getElementById("cohort-start")?.value || "";
    const endDate = document.getElementById("cohort-end")?.value || "";
    const isHidden = document.getElementById("cohort-hidden")?.checked !== false;
    if (!greatRegion) { showToast("請選擇大區"); return; }
    if (!sourcePlanId) { showToast("請選擇來源計畫"); return; }
    if (!startDate || !endDate) { showToast("請填起訖日期"); return; }
    if (endDate <= startDate) { showToast("結束日要晚於開始日"); return; }
    btn.disabled = true;
    const res = await db.createRegionStageCohort({ greatRegion, sourcePlanId, startDate, endDate, isHidden });
    btn.disabled = false;
    if (!res.success) { showToast(res.message || "建立失敗"); return; }
    showToast(`已建立「${res.data?.name || "梯次"}」`);
    if (typeof db.loadGlobalPlans === "function") await db.loadGlobalPlans();
    renderAdminPlanManagement();
    if (typeof renderPresetPlansList === "function") renderPresetPlansList();
  });
}

async function renderAdminPlanManagement() {
  const tableBody = document.getElementById("admin-plans-table-body");
  if (!tableBody) return;

  wireRegionCohortPanel();

  if (firstPaint(tableBody)) tableBody.innerHTML = typeof ComponentSkeletonLoader !== "undefined"
    ? `<tr><td colspan="3">${ComponentSkeletonLoader.getHtml("table-rows", { count: 3, cols: 3 })}</td></tr>`
    : "";

  try {
    const plans = state.globalPlans || [];
    tableBody.innerHTML = "";

    if (plans.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">目前無任何計畫，請點擊上方「新增計畫」建立</td></tr>`;
      return;
    }

    plans.forEach(plan => {
      const tr = document.createElement("tr");

      const bookListText = plan.books.join(", ");
      const bookCount = plan.books.length;
      const hidden = isPlanHidden(plan);
      const isFixed = plan.isFixed !== false && plan.is_fixed !== false;
      const isCampaign = plan.planKind === "church_campaign" || plan.id === window.CHURCH_CAMPAIGN_ID;
      // 正式階段限定：cohort 階段在「大區延後梯次」專屬面板管理，這裡維持一般計畫列
      // 的編輯 / 刪除操作，不套用階段列（隱藏刪除、鎖編輯規則）的處理。
      const isCampaignStage = window.isCanonicalCampaignStagePlan(plan);
      const campaignStageNo = Number(plan.stageNo || plan.campaignDefinition && plan.campaignDefinition.stageNo || 0);
      // #632 延後梯次預設先隱藏、由管理員逐一開放：跟正式階段一樣給開放按鈕，但任何來源階段都可以。
      const isRegionCohort = isCampaignStageKind(plan) && !isCampaignStage;
      const canToggleVisibility = isRegionCohort || (isCampaignStage && campaignStageNo >= 2 && campaignStageNo <= 10);

      let timeColHtml = "";
      if (isFixed) {
        timeColHtml = `
          <span style="font-size: 0.875rem; font-weight: 500; display: block; white-space: nowrap;"><span class="nlc-icon" data-icon="calendarThirty" aria-hidden="true"></span> ${plan.startDate}</span>
          <span style="font-size: 0.875rem; font-weight: 500; display: block; white-space: nowrap; margin-left: 0.6rem; color: var(--text-muted);">~ ${plan.endDate}</span>
          ${!isCampaign && plan.graceDays > 0 ? `<span style="font-size: 0.875rem; display: block; white-space: nowrap; margin-left: 0.6rem; color: var(--text-muted);">截止後寬限 ${plan.graceDays} 天</span>` : ""}
        `;
      } else {
        const duration = Math.ceil((new Date(plan.endDate) - new Date(plan.startDate)) / (1000 * 60 * 60 * 24)) + 1;
        timeColHtml = `
          <span style="font-size: 0.875rem; font-weight: 500; display: block; white-space: nowrap;"><span class="nlc-icon" data-icon="calendarThirty" aria-hidden="true"></span> 彈性時間</span>
          <span style="font-size: 0.875rem; font-weight: 500; display: block; white-space: nowrap; margin-left: 0.6rem; color: var(--text-muted);">共 ${duration} 天</span>
        `;
      }

      tr.innerHTML = `
        <td>
          <strong style="display: block; margin-bottom: 0.15rem; font-size: 0.875rem; word-break: break-all;">${escapeHTML(plan.name)}${hidden ? ' <span class="text-warning" style="font-size:0.875rem; font-weight: 500;">已隱藏</span>' : ''}</strong>
          <span title="${escapeHTML(bookListText)}" style="font-size: 0.875rem; color: var(--text-muted); cursor: help; text-decoration: underline dashed; text-underline-offset: 2px;">
            共 ${bookCount} 卷書卷
          </span>
        </td>
        <td>
          ${timeColHtml}
        </td>
        <td style="text-align: center; vertical-align: middle;">
          <div style="display: flex; flex-direction: column; gap: 0.25rem; align-items: center; justify-content: center;">
            ${isCampaignStage || isRegionCohort ? `<span class="admin-plan-visibility-state" style="font-size:0.875rem;font-weight:600;color:${hidden ? 'var(--color-warning)' : 'var(--color-success)'};">${hidden ? '尚未開放' : '已開放'}</span>` : ""}
            ${canToggleVisibility ? `<button class="secondary-btn admin-toggle-hidden-plan-btn" style="font-size:0.875rem;padding:0.25rem 0.45rem;height:auto;">${hidden ? '開放給使用者' : '暫停開放'}</button>` : ""}
            ${isFixed && !isCampaign ? `<button class="secondary-btn admin-plan-grace-days-btn" style="font-size:0.875rem;padding:0.25rem 0.45rem;height:auto;">寬限天數</button>` : ""}
            <button class="primary-btn admin-campaign-rules-btn"style="font-size:0.875rem;padding:0.25rem 0.45rem;height:auto;">編輯規則</button>
            <button class="primary-btn admin-edit-plan-btn" style="font-size: 0.875rem; padding: 0.2rem 0.4rem; min-width: 42px; text-align: center; height: auto; cursor: pointer;">編輯</button>
            <button class="danger-btn admin-delete-plan-btn" style="font-size: 0.875rem; padding: 0.2rem 0.4rem; min-width: 42px; text-align: center; height: auto; cursor: pointer;">刪除</button>
          </div>
        </td>
      `;

      const campaignRulesBtn = tr.querySelector(".admin-campaign-rules-btn");
      if (isCampaign) {
        campaignRulesBtn.onclick = () => window.openCampaignRuleEditor(plan);
        tr.querySelector(".admin-edit-plan-btn").style.display = "none";
        tr.querySelector(".admin-delete-plan-btn").style.display = "none";
      } else if (isCampaignStage) {
        campaignRulesBtn.remove();
        tr.querySelector(".admin-edit-plan-btn").style.display = "none";
        tr.querySelector(".admin-delete-plan-btn").style.display = "none";
      } else {
        campaignRulesBtn.remove();
      }

      // Bind edit event
      tr.querySelector(".admin-edit-plan-btn").onclick = () => {
        document.getElementById("admin-plan-form-title").textContent = "編輯讀經計畫";
        document.getElementById("admin-edit-plan-id").value = plan.id;
        document.getElementById("admin-plan-name").value = plan.name;

        // Set radio button and fields visibility
        const fixedRadio = document.querySelector('input[name="admin-plan-time-type"][value="fixed"]');
        const flexRadio = document.querySelector('input[name="admin-plan-time-type"][value="flexible"]');
        const dateInputs = document.getElementById("admin-plan-date-inputs");
        const durationContainer = document.getElementById("admin-plan-duration-container");

        if (isFixed) {
          if (fixedRadio) fixedRadio.checked = true;
          document.getElementById("admin-plan-start-date").value = plan.startDate;
          document.getElementById("admin-plan-end-date").value = plan.endDate;
          document.getElementById("admin-plan-duration-days").value = "";
          if (dateInputs) dateInputs.style.display = "grid";
          if (durationContainer) durationContainer.style.display = "none";
        } else {
          if (flexRadio) flexRadio.checked = true;
          const duration = Math.ceil((new Date(plan.endDate) - new Date(plan.startDate)) / (1000 * 60 * 60 * 24)) + 1;
          document.getElementById("admin-plan-duration-days").value = duration;
          document.getElementById("admin-plan-start-date").value = "";
          document.getElementById("admin-plan-end-date").value = "";
          if (dateInputs) dateInputs.style.display = "none";
          if (durationContainer) durationContainer.style.display = "block";
        }

        // Check corresponding books
        document.querySelectorAll(".admin-book-checkbox").forEach(cb => {
          cb.checked = plan.books.includes(cb.value);
        });

        document.getElementById("admin-plan-form-container").classList.remove("hidden");
        document.getElementById("admin-plan-form-container").scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };

      const toggleHiddenBtn = tr.querySelector(".admin-toggle-hidden-plan-btn");
      if (toggleHiddenBtn) {
        toggleHiddenBtn.onclick = async () => {
          if (!hidden && typeof window.showConfirmDialog === "function") {
            const confirmed = await window.showConfirmDialog({
              title: "暫停開放這個階段？",
              message: "一般使用者將不再看到或加入這個階段；既有資料不會在此操作中刪除。",
              confirmText: "暫停開放",
              cancelText: "取消",
              isDestructive: true
            });
            if (!confirmed) return;
          }

          loader.show(hidden ? "正在開放階段…" : "正在暫停開放…");
          const success = await db.setGlobalPlanHidden(plan, !hidden);
          loader.hide();
          if (!success) {
            showToast("開放狀態未能儲存，請稍後再試。");
            return;
          }

          showToast(hidden ? "此階段已開放給使用者。" : "此階段已暫停開放。");
          renderAdminPlanManagement();
          if (typeof renderPresetPlansList === "function") renderPresetPlansList();
          if (typeof renderJoinedPlansList === "function") renderJoinedPlansList();
        };
      }

      // #412 截止後寬限天數：寬限期內仍可補打卡／取消，過了就由伺服器鎖定。
      const graceDaysBtn = tr.querySelector(".admin-plan-grace-days-btn");
      if (graceDaysBtn) {
        graceDaysBtn.onclick = async () => {
          const value = await window.showPromptDialog({
            title: `「${plan.name}」截止後寬限天數`,
            message: `截止日（${plan.endDate}）之後再開放幾天補打卡（0–30）。0 ＝ 截止日隔天起不能打卡。`,
            defaultValue: String(plan.graceDays || 0),
            placeholder: "0",
            confirmText: "儲存"
          });
          if (value === null) return;
          const days = Number(String(value).trim());
          if (!Number.isInteger(days) || days < 0 || days > 30) {
            showToast("請輸入 0 到 30 的整數。");
            return;
          }
          loader.show("正在儲存寬限天數…");
          const result = await db.saveGlobalPlanGraceDays(plan.id, days);
          loader.hide();
          if (!result.success) {
            showToast("寬限天數未能儲存：" + ((result.error && result.error.message) || "請稍後再試"));
            return;
          }
          showToast(days > 0 ? `已設定截止後寬限 ${days} 天。` : "已取消寬限期，截止日隔天起不能打卡。");
          renderAdminPlanManagement();
        };
      }

      // Bind delete event
      tr.querySelector(".admin-delete-plan-btn").onclick = async () => {
        const confirmed = await window.showConfirmDialog({
          title: "確定要刪除此計畫嗎？",
          message: `您確定要刪除「${plan.name}」嗎？這將使其他會友無法再從列表「加入」此計畫，但已加入的會友仍可照常閱讀打卡。`,
          confirmText: "確認刪除",
          cancelText: "取消",
          isDestructive: true
        });
        if (!confirmed) return;

        loader.show("刪除計畫中...");
        const success = await db.deleteGlobalPlan(plan.id);
        loader.hide();
        if (success) {
          showToast("計畫已成功刪除！");
          renderAdminPlanManagement();
          if (typeof renderPresetPlansList === 'function') {
            renderPresetPlansList();
          }
        }
      };

      tableBody.appendChild(tr);
    });

  } catch (err) {
    console.error("Failed to render admin plans:", err);
    tableBody.innerHTML = `<tr><td colspan="4" class="text-danger" style="text-align: center;">載入計畫失敗: ${err.message || err}</td></tr>`;
  }
}

export function init() {
  initAdminPlanManagement();
  registerPlanAdminRenderer(renderAdminPlanManagement);
  // plan.js 的 renderPlanView 可能在這個 chunk 載入前就跑過了，補畫一次。
  renderAdminPlanManagement();
}

export { renderAdminPlanManagement };

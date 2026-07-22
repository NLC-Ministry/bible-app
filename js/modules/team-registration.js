// Independent 3-person / 6-person competition team registration.
// Organisation small-group and pastoral-zone scopes are deliberately not used here.
(function () {
  const getPlanId = plan => {
    if (!plan) return "";
    const linked = (state.globalPlans || []).find(item =>
      item.id === plan.globalPlanId || item.presetKey === plan.presetKey || item.name === plan.name
    );
    return String(plan.globalPlanId || linked && (linked.globalPlanId || linked.id) || "");
  };
  const isSupportedPlan = plan => !!plan && plan.planKind === "church_campaign_stage" && /^[0-9a-f-]{36}$/i.test(getPlanId(plan));

  function removeOverlay(overlay) {
    overlay?.remove();
    if (!document.querySelector(".reading-team-overlay")) {
      document.body.classList.remove("reading-team-modal-open");
    }
  }

  function createOverlay(id, labelledBy) {
    removeOverlay(document.getElementById(id));
    const overlay = document.createElement("div");
    overlay.id = id;
    overlay.className = "modal-overlay reading-team-overlay";
    overlay.innerHTML = `<section class="reading-team-dialog glass-card" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}"></section>`;
    document.body.classList.add("reading-team-modal-open");
    document.body.appendChild(overlay);
    return overlay;
  }

  function closeOnBackdrop(overlay, close) {
    overlay.addEventListener("click", event => {
      if (event.target === overlay) close();
    });
  }

  function hydrate(root) {
    if (typeof hydrateIcons === "function") hydrateIcons(root);
  }

  window.chooseReadingPlanParticipation = function chooseReadingPlanParticipation(plan) {
    if (!isSupportedPlan(plan)) return Promise.resolve({ mode: "personal", division: null });
    return new Promise(resolve => {
      const overlay = createOverlay("reading-team-choice-dialog", "reading-team-choice-title");
      const panel = overlay.firstElementChild;
      panel.classList.add("reading-team-dialog--choice");
      panel.setAttribute("aria-describedby", "reading-team-choice-description");
      panel.innerHTML = `
        <header class="reading-team-dialog__header">
          <div><p class="reading-team-eyebrow">${escapeHTML(plan.name || "教會讀經計畫")}</p><h3 id="reading-team-choice-title">選擇參加方式</h3></div>
          <button type="button" class="reading-team-close" data-team-close aria-label="關閉"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button>
        </header>
        <p class="reading-team-dialog__intro" id="reading-team-choice-description">每個人仍保有自己的讀經進度；選擇團隊後，可以和固定隊員查看共同完成狀況。</p>
        <div class="reading-team-choice-grid">
          <button type="button" class="reading-team-choice" data-team-mode="personal">
            <span class="reading-team-choice__icon"><span class="nlc-icon nlc-icon--md" data-icon="user" aria-hidden="true"></span></span>
            <span class="reading-team-choice__body"><strong>個人參加</strong><span class="reading-team-choice__description">只顯示自己的讀經進度</span></span><span class="reading-team-choice__arrow"><span class="nlc-icon nlc-icon--sm" data-icon="chevronRight" aria-hidden="true"></span></span>
          </button>
          <button type="button" class="reading-team-choice" data-team-mode="team" data-division="3">
            <span class="reading-team-choice__icon"><span class="nlc-icon nlc-icon--md" data-icon="people" aria-hidden="true"></span></span>
            <span class="reading-team-choice__body"><strong>3 人組</strong><span class="reading-team-choice__description">固定三人，滿員後完成組隊</span></span><span class="reading-team-choice__arrow"><span class="nlc-icon nlc-icon--sm" data-icon="chevronRight" aria-hidden="true"></span></span>
          </button>
          <button type="button" class="reading-team-choice" data-team-mode="team" data-division="6">
            <span class="reading-team-choice__icon"><span class="nlc-icon nlc-icon--md" data-icon="people" aria-hidden="true"></span></span>
            <span class="reading-team-choice__body"><strong>6 人組</strong><span class="reading-team-choice__description">固定六人，滿員後完成組隊</span></span><span class="reading-team-choice__arrow"><span class="nlc-icon nlc-icon--sm" data-icon="chevronRight" aria-hidden="true"></span></span>
          </button>
        </div>`;
      const finish = value => { removeOverlay(overlay); resolve(value); };
      panel.querySelector("[data-team-close]").onclick = () => finish(null);
      panel.querySelectorAll("[data-team-mode]").forEach(button => {
        button.onclick = () => finish({
          mode: button.dataset.teamMode,
          division: button.dataset.division ? Number(button.dataset.division) : null
        });
      });
      closeOnBackdrop(overlay, () => finish(null));
      hydrate(overlay);
      panel.querySelector("[data-team-mode]")?.focus();
    });
  };

  function formatLastRead(value) {
    if (!value) return "尚未開始";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "尚未開始";
    return new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric" }).format(date);
  }

  function renderMember(member, totalChapters) {
    const read = Number(member.chaptersRead || 0);
    const progress = totalChapters > 0 ? Math.min(100, Math.round(read / totalChapters * 100)) : 0;
    return `<article class="reading-team-member${member.isMe ? " reading-team-member--me" : ""}">
      <div class="reading-team-member__avatar">${escapeHTML(String(member.name || "隊員").slice(0, 1))}</div>
      <div class="reading-team-member__body">
        <div class="reading-team-member__title"><strong>${escapeHTML(member.name || "未命名隊員")}</strong>${member.role === "captain" ? '<span class="stat-badge stat-badge--brand">隊長</span>' : ""}${member.isMe ? '<span class="reading-team-me">你</span>' : ""}</div>
        <div class="reading-team-member__meta"><span>${member.hasJoinedPlan ? `第 ${Number(member.currentRound || 1)} 遍・${read} 章` : "尚未加入本計畫"}</span><span>最後閱讀：${escapeHTML(formatLastRead(member.lastReadAt))}</span></div>
        <div class="reading-team-progress" role="progressbar" aria-label="${escapeHTML(member.name || "隊員")}進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>
      </div>
      <strong class="reading-team-member__percent">${progress}%</strong>
    </article>`;
  }

  window.openReadingTeamDialog = async function openReadingTeamDialog(plan, options = {}) {
    if (!isSupportedPlan(plan)) {
      showToast("此計畫不使用競賽團隊報名。");
      return null;
    }
    const overlay = createOverlay("reading-team-dialog", "reading-team-dialog-title");
    const panel = overlay.firstElementChild;
    let preferredDivision = [3, 6].includes(Number(options.preferredDivision)) ? Number(options.preferredDivision) : 3;
    let closed = false;

    const close = () => { closed = true; removeOverlay(overlay); };
    closeOnBackdrop(overlay, close);

    const renderLoading = () => {
      panel.innerHTML = `<div class="reading-team-loading"><span class="nlc-icon nlc-icon--md" data-icon="people" aria-hidden="true"></span><span>正在載入我的團隊…</span></div>`;
      hydrate(panel);
    };

    const renderEmpty = () => {
      panel.innerHTML = `
        <header class="reading-team-dialog__header">
          <div><p class="reading-team-eyebrow">${escapeHTML(plan.name || "教會讀經計畫")}</p><h3 id="reading-team-dialog-title">團隊報名</h3></div>
          <button type="button" class="reading-team-close" data-team-close aria-label="關閉"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button>
        </header>
        <p class="reading-team-dialog__intro">競賽團隊與教會牧區、小組資料分開管理。一般會員只能查看自己加入的隊伍；尚未註冊的隊員需先完成會員資料同步，系統不會只用姓名建立成員。</p>
        <div class="reading-team-division-switch" role="radiogroup" aria-label="選擇團隊組別">
          <button type="button" role="radio" data-division="3" aria-checked="${preferredDivision === 3}">3 人組</button>
          <button type="button" role="radio" data-division="6" aria-checked="${preferredDivision === 6}">6 人組</button>
        </div>
        <div class="reading-team-form-grid">
          <form id="reading-team-create-form" class="reading-team-form-card">
            <span class="reading-team-form-card__icon"><span class="nlc-icon nlc-icon--md" data-icon="plus" aria-hidden="true"></span></span>
            <h4>建立新隊伍</h4>
            <p>你會成為隊長，系統會產生邀請碼。</p>
            <label for="reading-team-name">隊伍名稱</label>
            <input id="reading-team-name" class="form-control" maxlength="40" required placeholder="例如：恩典同行隊">
            <button type="submit" class="primary-btn">建立 <span data-division-label>${preferredDivision}</span> 人隊</button>
          </form>
          <form id="reading-team-join-form" class="reading-team-form-card">
            <span class="reading-team-form-card__icon"><span class="nlc-icon nlc-icon--md" data-icon="lock" aria-hidden="true"></span></span>
            <h4>使用邀請碼加入</h4>
            <p>邀請碼只會讓你加入這個計畫中的指定隊伍。</p>
            <label for="reading-team-code">邀請碼</label>
            <input id="reading-team-code" class="form-control reading-team-code-input" maxlength="16" required autocomplete="off" placeholder="輸入邀請碼">
            <button type="submit" class="secondary-btn">加入隊伍</button>
          </form>
        </div>
        <p class="reading-team-form-error" data-team-error role="alert" hidden></p>`;
      const error = panel.querySelector("[data-team-error]");
      const showError = message => { error.textContent = message; error.hidden = false; };
      panel.querySelector("[data-team-close]").onclick = close;
      panel.querySelectorAll("[data-division]").forEach(button => {
        button.onclick = () => {
          preferredDivision = Number(button.dataset.division);
          panel.querySelectorAll("[data-division]").forEach(item => item.setAttribute("aria-checked", String(item === button)));
          panel.querySelector("[data-division-label]").textContent = preferredDivision;
        };
      });
      panel.querySelector("#reading-team-create-form").onsubmit = async event => {
        event.preventDefault();
        error.hidden = true;
        const button = event.currentTarget.querySelector('button[type="submit"]');
        button.disabled = true;
        const result = await db.createReadingTeam(plan, preferredDivision, panel.querySelector("#reading-team-name").value.trim());
        button.disabled = false;
        if (!result.success) return showError(result.message || "建立隊伍失敗，請稍後再試。");
        await refresh();
      };
      panel.querySelector("#reading-team-join-form").onsubmit = async event => {
        event.preventDefault();
        error.hidden = true;
        const button = event.currentTarget.querySelector('button[type="submit"]');
        button.disabled = true;
        const result = await db.joinReadingTeam(plan, panel.querySelector("#reading-team-code").value);
        button.disabled = false;
        if (!result.success) return showError(result.message || "加入隊伍失敗，請確認邀請碼。");
        await refresh();
      };
      hydrate(panel);
    };

    const renderTeam = context => {
      const team = context.team;
      const members = Array.isArray(context.members) ? context.members : [];
      const totalChapters = Number(plan.currentRoundTotalChapters || plan.totalChapters || 0);
      const averageProgress = members.length
        ? Math.round(members.reduce((sum, member) => sum + Math.min(100, totalChapters > 0 ? Number(member.chaptersRead || 0) / totalChapters * 100 : 0), 0) / members.length)
        : 0;
      const isCaptain = String(team.captainId) === String(state.currentUser && (state.currentUser.id || state.currentProfileId));
      const isReady = team.status === "ready" || Number(team.memberCount) === Number(team.capacity);
      panel.innerHTML = `
        <header class="reading-team-dialog__header">
          <div><p class="reading-team-eyebrow">${escapeHTML(plan.name || "教會讀經計畫")}</p><h3 id="reading-team-dialog-title">${escapeHTML(team.name)}</h3></div>
          <button type="button" class="reading-team-close" data-team-close aria-label="關閉"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button>
        </header>
        <div class="reading-team-summary">
          <div><span class="stat-badge stat-badge--brand">${Number(team.division)} 人組</span><strong>${Number(team.memberCount)} / ${Number(team.capacity)} 人</strong><span>${isReady ? "隊伍已完成" : "等待隊員加入"}</span></div>
          <div class="reading-team-summary__progress"><span>團隊平均進度</span><strong>${averageProgress}%</strong></div>
        </div>
        ${!isReady ? `<div class="reading-team-invite"><div><span>隊伍邀請碼</span><strong>${escapeHTML(team.inviteCode)}</strong></div><button type="button" class="secondary-btn" data-copy-team-code><span class="nlc-icon nlc-icon--sm" data-icon="share" aria-hidden="true"></span>複製邀請碼</button></div>` : `<div class="reading-team-ready"><span class="nlc-icon nlc-icon--sm" data-icon="checkCircle" aria-hidden="true"></span><span>名單已滿員並鎖定，團隊統計會固定以 ${Number(team.capacity)} 人計算。</span></div>`}
        <section class="reading-team-members" aria-labelledby="reading-team-members-title">
          <div class="reading-team-section-title"><h4 id="reading-team-members-title">隊員狀況</h4><span>只有同隊成員可查看</span></div>
          <div class="reading-team-member-list">${members.map(member => renderMember(member, totalChapters)).join("")}</div>
        </section>
        <footer class="reading-team-dialog__footer">
          ${!isReady ? (isCaptain
            ? '<button type="button" class="reading-team-danger-link" data-disband-team>解散隊伍</button>'
            : '<button type="button" class="reading-team-danger-link" data-leave-team>退出隊伍</button>') : ""}
          <button type="button" class="primary-btn" data-team-close-footer>完成</button>
        </footer>
        <p class="reading-team-form-error" data-team-error role="alert" hidden></p>`;
      panel.querySelector("[data-team-close]").onclick = close;
      panel.querySelector("[data-team-close-footer]").onclick = close;
      panel.querySelector("[data-copy-team-code]")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(team.inviteCode);
          showToast("邀請碼已複製。");
        } catch (_) {
          showToast(`邀請碼：${team.inviteCode}`);
        }
      });
      panel.querySelector("[data-leave-team]")?.addEventListener("click", async () => {
        if (!confirm("確定退出這支隊伍嗎？退出後可使用其他邀請碼重新組隊。")) return;
        const result = await db.leaveReadingTeam(team.id);
        if (!result.success) {
          const error = panel.querySelector("[data-team-error]");
          error.textContent = result.message || "退出隊伍失敗。";
          error.hidden = false;
          return;
        }
        await refresh();
      });
      panel.querySelector("[data-disband-team]")?.addEventListener("click", async () => {
        if (!confirm("確定解散這支隊伍嗎？所有隊員都會回到尚未組隊狀態。")) return;
        const result = await db.disbandReadingTeam(team.id);
        if (!result.success) {
          const error = panel.querySelector("[data-team-error]");
          error.textContent = result.message || "解散隊伍失敗。";
          error.hidden = false;
          return;
        }
        await refresh();
      });
      hydrate(panel);
    };

    const refresh = async () => {
      renderLoading();
      const result = await db.getMyReadingTeam(plan);
      if (closed) return;
      if (!result.success) {
        panel.innerHTML = `<header class="reading-team-dialog__header"><h3 id="reading-team-dialog-title">團隊報名</h3><button type="button" class="reading-team-close" data-team-close aria-label="關閉"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button></header><div class="reading-team-empty-error"><p>${escapeHTML(result.message || "目前無法載入團隊資料。")}</p><button type="button" class="secondary-btn" data-team-retry>重新載入</button></div>`;
        panel.querySelector("[data-team-close]").onclick = close;
        panel.querySelector("[data-team-retry]").onclick = refresh;
        hydrate(panel);
        return;
      }
      if (result.context && result.context.team) renderTeam(result.context);
      else renderEmpty();
    };

    await refresh();
    return overlay;
  };

  window.openReadingTeamAdminStatsDialog = async function openReadingTeamAdminStatsDialog(plan) {
    if (!isSupportedPlan(plan)) return null;
    const overlay = createOverlay("reading-team-admin-dialog", "reading-team-admin-title");
    const panel = overlay.firstElementChild;
    const close = () => removeOverlay(overlay);
    closeOnBackdrop(overlay, close);
    panel.innerHTML = `<div class="reading-team-loading"><span class="nlc-icon nlc-icon--md" data-icon="people" aria-hidden="true"></span><span>正在整理競賽團隊統計…</span></div>`;
    hydrate(panel);
    const result = await db.getReadingTeamStatistics(plan);
    if (!document.body.contains(overlay)) return null;
    if (!result.success) {
      panel.innerHTML = `<header class="reading-team-dialog__header"><h3 id="reading-team-admin-title">競賽團隊統計</h3><button type="button" class="reading-team-close" data-team-close aria-label="關閉"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button></header><div class="reading-team-empty-error"><p>${escapeHTML(result.message || "目前無法載入團隊統計。")}</p></div>`;
      panel.querySelector("[data-team-close]").onclick = close;
      hydrate(panel);
      return overlay;
    }
    const context = result.context || {};
    const summary = context.summary || {};
    const teams = Array.isArray(context.teams) ? context.teams : [];
    const totalChapters = Number(plan.currentRoundTotalChapters || plan.totalChapters || 0);
    panel.innerHTML = `
      <header class="reading-team-dialog__header">
        <div><p class="reading-team-eyebrow">${escapeHTML(plan.name || "教會讀經計畫")}</p><h3 id="reading-team-admin-title">競賽團隊統計</h3></div>
        <button type="button" class="reading-team-close" data-team-close aria-label="關閉"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button>
      </header>
      <p class="reading-team-dialog__intro">此頁只統計 3 人組與 6 人組競賽隊伍，不納入牧區或小組統計。</p>
      <div class="reading-team-admin-summary">
        <div><span>隊伍</span><strong>${Number(summary.teamCount || 0)}</strong></div>
        <div><span>已成隊</span><strong>${Number(summary.readyTeamCount || 0)}</strong></div>
        <div><span>參賽者</span><strong>${Number(summary.memberCount || 0)}</strong></div>
        <div><span>3 人／6 人</span><strong>${Number(summary.division3Teams || 0)}／${Number(summary.division6Teams || 0)}</strong></div>
      </div>
      <div class="reading-team-admin-list">${teams.length ? teams.map(team => {
        const memberCount = Number(team.memberCount || 0);
        const capacity = Number(team.division || 0);
        const progress = totalChapters > 0 && memberCount > 0
          ? Math.min(100, Math.round(Number(team.chaptersRead || 0) / (totalChapters * memberCount) * 100))
          : 0;
        const members = Array.isArray(team.members) ? team.members : [];
        return `<article class="reading-team-admin-card">
          <div class="reading-team-admin-card__title"><div><strong>${escapeHTML(team.name || "未命名隊伍")}</strong><span>${capacity} 人組・${memberCount}/${capacity} 人</span></div><b>${progress}%</b></div>
          <div class="reading-team-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>
          <div class="reading-team-admin-members">${members.map(member => `<span>${escapeHTML(member.name || "隊員")}・${Number(member.chaptersRead || 0)} 章</span>`).join("")}</div>
        </article>`;
      }).join("") : '<div class="reading-team-admin-empty">目前尚無競賽團隊。</div>'}</div>
      <footer class="reading-team-dialog__footer"><button type="button" class="primary-btn" data-team-close-footer>完成</button></footer>`;
    panel.querySelector("[data-team-close]").onclick = close;
    panel.querySelector("[data-team-close-footer]").onclick = close;
    hydrate(panel);
    return overlay;
  };

  window.isReadingTeamPlan = isSupportedPlan;
})();

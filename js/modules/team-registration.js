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
    // Critical positioning is inline so a stale optional stylesheet can never place the dialog inside page flow.
    overlay.style.cssText = "position:fixed;inset:0;display:flex;z-index:var(--z-modal,700);";
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

  window.offerReadingTeamParticipation = function offerReadingTeamParticipation(plan) {
    if (!isSupportedPlan(plan)) return Promise.resolve(null);
    return new Promise(resolve => {
      const overlay = createOverlay("reading-team-choice-dialog", "reading-team-choice-title");
      const panel = overlay.firstElementChild;
      panel.classList.add("reading-team-dialog--choice");
      panel.setAttribute("aria-describedby", "reading-team-choice-description");
      panel.innerHTML = `
        <header class="reading-team-dialog__header">
          <div><p class="reading-team-eyebrow">${escapeHTML(plan.name || "教會讀經計畫")}</p><h3 id="reading-team-choice-title">和夥伴一起讀嗎？</h3></div>
          <button type="button" class="reading-team-close" data-team-close aria-label="關閉"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button>
        </header>
        <p class="reading-team-dialog__intro" id="reading-team-choice-description">計畫已加入。你的章節進度只需勾選一次；加入團隊後，系統會直接以這份個人進度計算共同完成狀況。</p>
        <div class="reading-team-choice-grid">
          <button type="button" class="reading-team-choice" data-team-skip>
            <span class="reading-team-choice__icon"><span class="nlc-icon nlc-icon--md" data-icon="user" aria-hidden="true"></span></span>
            <span class="reading-team-choice__body"><strong>先自己開始</strong><span class="reading-team-choice__description">之後可從計畫選單加入團隊</span></span><span class="reading-team-choice__arrow"><span class="nlc-icon nlc-icon--sm" data-icon="chevronRight" aria-hidden="true"></span></span>
          </button>
          <button type="button" class="reading-team-choice" data-team-division="3">
            <span class="reading-team-choice__icon"><span class="nlc-icon nlc-icon--md" data-icon="people" aria-hidden="true"></span></span>
            <span class="reading-team-choice__body"><strong>參加 3 人團隊</strong><span class="reading-team-choice__description">固定三人，滿員後完成組隊</span></span><span class="reading-team-choice__arrow"><span class="nlc-icon nlc-icon--sm" data-icon="chevronRight" aria-hidden="true"></span></span>
          </button>
          <button type="button" class="reading-team-choice" data-team-division="6">
            <span class="reading-team-choice__icon"><span class="nlc-icon nlc-icon--md" data-icon="people" aria-hidden="true"></span></span>
            <span class="reading-team-choice__body"><strong>參加 6 人團隊</strong><span class="reading-team-choice__description">固定六人，滿員後完成組隊</span></span><span class="reading-team-choice__arrow"><span class="nlc-icon nlc-icon--sm" data-icon="chevronRight" aria-hidden="true"></span></span>
          </button>
        </div>`;
      const finish = value => { removeOverlay(overlay); resolve(value); };
      panel.querySelector("[data-team-close]").onclick = () => finish(null);
      panel.querySelector("[data-team-skip]").onclick = () => finish(null);
      panel.querySelectorAll("[data-team-division]").forEach(button => {
        button.onclick = () => finish(Number(button.dataset.teamDivision));
      });
      closeOnBackdrop(overlay, () => finish(null));
      hydrate(overlay);
      panel.querySelector("[data-team-skip]")?.focus();
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
          <div><p class="reading-team-eyebrow">${escapeHTML(plan.name || "教會讀經計畫")}</p><h3 id="reading-team-dialog-title">我的團隊</h3></div>
          <button type="button" class="reading-team-close" data-team-close aria-label="關閉"><span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span></button>
        </header>
        <p class="reading-team-dialog__intro">你尚未加入團隊。可以建立 3 人或 6 人團隊並取得邀請碼，也可以輸入隊長分享的邀請碼加入。</p>
        <div class="reading-team-registration-tabs" role="tablist" aria-label="團隊報名方式">
          <button type="button" role="tab" data-registration-mode="create" aria-selected="true" aria-controls="reading-team-create-form">建立團隊</button>
          <button type="button" role="tab" data-registration-mode="join" aria-selected="false" aria-controls="reading-team-join-form">輸入邀請碼</button>
        </div>
        <form id="reading-team-create-form" class="reading-team-form-card reading-team-registration-panel" data-registration-panel="create" role="tabpanel">
          <div class="reading-team-registration-panel__heading">
            <span class="reading-team-form-card__icon"><span class="nlc-icon nlc-icon--md" data-icon="plus" aria-hidden="true"></span></span>
            <div><h4>建立新團隊</h4><p>選擇人數並命名，你會成為隊長。</p></div>
          </div>
          <span class="reading-team-field-label">團隊人數</span>
          <div class="reading-team-division-switch" role="radiogroup" aria-label="選擇團隊組別">
            <button type="button" role="radio" data-division="3" aria-checked="${preferredDivision === 3}">3 人團隊</button>
            <button type="button" role="radio" data-division="6" aria-checked="${preferredDivision === 6}">6 人團隊</button>
          </div>
          <label for="reading-team-name">團隊名稱</label>
          <input id="reading-team-name" class="form-control" maxlength="40" required placeholder="例如：恩典同行隊">
          <button type="submit" class="primary-btn reading-team-submit">建立 <span data-division-label>${preferredDivision}</span> 人團隊並產生邀請碼</button>
          <span class="reading-team-form-hint">建立成功後，邀請碼會立即顯示並可複製分享。</span>
        </form>
        <form id="reading-team-join-form" class="reading-team-form-card reading-team-registration-panel" data-registration-panel="join" role="tabpanel" hidden>
          <div class="reading-team-registration-panel__heading">
            <span class="reading-team-form-card__icon"><span class="nlc-icon nlc-icon--md" data-icon="lock" aria-hidden="true"></span></span>
            <div><h4>使用邀請碼加入</h4><p>輸入隊長提供的邀請碼，即可加入指定團隊。</p></div>
          </div>
          <label for="reading-team-code">團隊邀請碼</label>
          <input id="reading-team-code" class="form-control reading-team-code-input" maxlength="16" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="輸入邀請碼">
          <button type="submit" class="primary-btn reading-team-submit">使用邀請碼加入團隊</button>
          <span class="reading-team-form-hint">邀請碼不分大小寫；每個階段只能加入一支團隊。</span>
        </form>
        <p class="reading-team-registration-privacy">加入後，你可以查看自己的團隊與夥伴進度；其他隊伍的資料不會顯示。</p>
        <p class="reading-team-form-error" data-team-error role="alert" hidden></p>`;
      const error = panel.querySelector("[data-team-error]");
      const showError = message => { error.textContent = message; error.hidden = false; };
      panel.querySelector("[data-team-close]").onclick = close;
      panel.querySelectorAll("[data-registration-mode]").forEach(button => {
        button.onclick = () => {
          const mode = button.dataset.registrationMode;
          panel.querySelectorAll("[data-registration-mode]").forEach(item => item.setAttribute("aria-selected", String(item === button)));
          panel.querySelectorAll("[data-registration-panel]").forEach(item => { item.hidden = item.dataset.registrationPanel !== mode; });
          panel.querySelector(mode === "join" ? "#reading-team-code" : "#reading-team-name")?.focus();
        };
      });
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

  window.renderMyReadingTeamInline = function renderMyReadingTeamInline(container, plan, context, mode = "members") {
    if (!container || !context || !context.team) return;
    const team = context.team;
    const members = Array.isArray(context.members) ? context.members : [];
    const totalChapters = Number(plan && (plan.currentRoundTotalChapters || plan.totalChapters) || 0);
    const totalRead = members.reduce((sum, member) => sum + Number(member.chaptersRead || 0), 0);
    const averageProgress = members.length && totalChapters > 0
      ? Math.min(100, Math.round(totalRead / (members.length * totalChapters) * 100))
      : 0;
    const isReady = team.status === "ready" || Number(team.memberCount) === Number(team.capacity);
    const summary = mode === "stats" ? `
      <div class="reading-team-summary">
        <div><span>團隊完成狀況</span><strong>${averageProgress}%</strong><span>${totalRead} / ${totalChapters * members.length} 章</span></div>
        <div class="reading-team-summary__progress"><span>組隊狀態</span><strong>${Number(team.memberCount)} / ${Number(team.capacity)}</strong><span>${isReady ? "已成隊" : "等待隊員"}</span></div>
      </div>` : "";
    container.innerHTML = `
      <div class="reading-team-inline__header">
        <div><h3>${escapeHTML(team.name || "我的團隊")}</h3><p>${Number(team.division)} 人團隊・一起查看彼此的讀經進度</p></div>
        <span class="stat-badge stat-badge--brand">${mode === "stats" ? "團隊統計" : "組員狀況"}</span>
      </div>
      ${summary}
      <section class="reading-team-members" aria-label="競賽團隊成員">
        <div class="reading-team-member-list">${members.map(member => renderMember(member, totalChapters)).join("")}</div>
      </section>`;
    hydrate(container);
  };


  window.isReadingTeamPlan = isSupportedPlan;
})();

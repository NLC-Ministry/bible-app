// Application entry point & initialization bootstrap

document.addEventListener("DOMContentLoaded", async () => {
  // 💡 體驗優化：在最開始立即顯示 Loading 載入畫面，防止使用者在資料加載前看到 Demo 畫面或舊資料
  if (typeof loader !== "undefined" && loader.show) {
    loader.show("系統安全載入中，請稍候...");
  }

  // 1. Initialize Theme
  try {
    initTheme();
  } catch (err) {
    console.error("Failed to initialize theme:", err);
  }
  
  // 2. Initialize Routing
  try {
    appRouter.init();
  } catch (err) {
    console.error("Failed to initialize routing:", err);
  }

  // 3. Initialize Settings & State Loading
  try {
    loadLocalSettings();
  } catch (err) {
    console.error("Failed to load local settings:", err);
  }
  
  // 4. Initialize Database Connection & Auth (triggers loadUserData)
  try {
    await db.init();
  } catch (err) {
    console.error("Failed to initialize database connection & auth:", err);
  }

  // 5. Initialize Bible Reader Controls & Selectors
  try {
    initReaderControls();
  } catch (err) {
    console.error("Failed to initialize Bible reader controls:", err);
  }

  // 6. Initialize Plan Creation Form & Checkboxes
  try {
    initPlanControls();
  } catch (err) {
    console.error("Failed to initialize plan controls:", err);
  }

  // 6.2 Initialize Devotional Notes Controls
  try {
    initDevotionalControls();
  } catch (err) {
    console.error("Failed to initialize devotional controls:", err);
  }

  // 6.3 Initialize Profile & Auth Controls
  try {
    initProfileControls();
  } catch (err) {
    console.error("Failed to initialize profile/auth controls:", err);
  }

  // 6.5 & 7. Load Data in Parallel, Verify Session & Render initial Dashboard
  try {
    // 💡 體驗優化：平行載入組織結構與用戶資料，顯著縮短冷啟動等待時間
    await Promise.all([
      db.loadOrgStructure(),
      db.loadUserData()
    ]);

    // 💡 最終會話校驗：確保非同步 token 恢復完成（防制多重連線邊際狀況）
    if (state.isSupabaseMode && state.supabase) {
      const { data: { session } } = await state.supabase.auth.getSession();
      if (session) {
        db.updateAuthUI(session);
        await db.loadUserData();
      }
    }

    // 渲染初始儀表板
    updateDashboardView();
  } catch (err) {
    console.error("Failed to load initial data & render dashboard:", err);
  } finally {
    // 💡 體驗最優化：保證所有資料載入與畫面渲染「完全就緒」後才隱藏 Loading，不讓使用者看見空白或 Demo 畫面
    if (typeof loader !== "undefined" && loader.hide) {
      loader.hide();
    }
  }

  // 8. 💡 徹底解決 PWA 快取陷阱：移除 Service Worker 並清空所有瀏覽器快取儲存區
  // 由於本系統（讀經打卡、排行榜、個人統計）高度依賴 Supabase 線上資料庫，離線模式並不具備實用價值，反而會因為 Service Worker 快取造成舊檔案/損壞檔案鎖死。
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      if (registrations.length > 0) {
        console.log("[Cache Buster] 偵測到舊版 Service Worker，正在移除並清空快取...");
        for (let registration of registrations) {
          registration.unregister();
        }
        if (window.caches) {
          caches.keys().then(keys => {
            Promise.all(keys.map(key => caches.delete(key))).then(() => {
              console.log("[Cache Buster] 快取已清空，正在執行強制重新整理...");
              window.location.reload(true); // 強制從伺服器拉取最新檔案
            });
          });
        } else {
          window.location.reload(true);
        }
      }
    });
  }
});

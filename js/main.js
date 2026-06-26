// Application entry point & initialization bootstrap

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Initialize Theme
  initTheme();
  
  // 2. Initialize Routing
  appRouter.init();

  // 3. Initialize Settings & State Loading
  loadLocalSettings();
  
  // 4. Initialize Database Connection & Auth (triggers loadUserData)
  await db.init();

  // 5. Initialize Bible Reader Controls & Selectors
  initReaderControls();

  // 6. Initialize Plan Creation Form & Checkboxes
  initPlanControls();

  // 6.2 Initialize Devotional Notes Controls
  initDevotionalControls();

  // 6.5 Load Church Organization Structure
  await db.loadOrgStructure();

  // 7. Load Data & Render initial Dashboard
  await db.loadUserData();
  updateDashboardView();

  // 8. Register Service Worker for PWA offline support
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .then(reg => console.log("Service Worker 註冊成功，範圍:", reg.scope))
      .catch(err => console.error("Service Worker 註冊失敗:", err));
  }
});

// Mock stats data for the Offline/Demo Mode to showcase Pastoral Zone statistics with RBAC
const MOCK_GREAT_REGIONS = ["第一大區", "第二大區"];

const MOCK_PASTORAL_ZONES_BY_REGION = {
  "第一大區": ["約書亞牧區", "大衛牧區"],
  "第二大區": ["提摩太牧區", "撒母耳牧區"]
};

const MOCK_PASTORAL_ZONES = ["約書亞牧區", "大衛牧區", "提摩太牧區", "撒母耳牧區"];

const MOCK_SMALL_GROUPS = {
  "約書亞牧區": ["迦勒小組", "以利亞小組", "以西結小組"],
  "大衛牧區": ["約拿單小組", "班雅明小組", "恩典小組"],
  "提摩太牧區": ["信實小組", "喜樂小組", "和平小組"],
  "撒母耳牧區": ["信心小組", "盼望小組", "愛心小組"]
};

// Generate mock users with roles and great regions
const MOCK_USERS_DATA = [
  // 第一大區 - 約書亞牧區
  { name: "陳建國", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "迦勒小組", role: "group_leader", chapters_read: 480, plan_progress: 85, streak: 12, last_read: "2026-06-25" },
  { name: "林秀琴", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "迦勒小組", role: "member", chapters_read: 210, plan_progress: 35, streak: 3, last_read: "2026-06-25" },
  { name: "張明哲", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "以利亞小組", role: "group_leader", chapters_read: 650, plan_progress: 92, streak: 25, last_read: "2026-06-24" },
  { name: "黃雅婷", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "以利亞小組", role: "member", chapters_read: 120, plan_progress: 20, streak: 1, last_read: "2026-06-23" },
  { name: "李冠宇", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "以西結小組", role: "member", chapters_read: 310, plan_progress: 55, streak: 6, last_read: "2026-06-25" },
  { name: "王淑芬", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "以西結小組", role: "member", chapters_read: 90, plan_progress: 15, streak: 0, last_read: "2026-06-22" },
  { name: "吳志明", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "迦勒小組", role: "member", chapters_read: 520, plan_progress: 88, streak: 14, last_read: "2026-06-25" },
  { name: "劉美玲", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "以利亞小組", role: "member", chapters_read: 430, plan_progress: 70, streak: 8, last_read: "2026-06-24" },
  { name: "蔡佳穎", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "以西結小組", role: "member", chapters_read: 180, plan_progress: 30, streak: 2, last_read: "2026-06-25" },
  { name: "王區長", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "迦勒小組", role: "zone_leader", chapters_read: 600, plan_progress: 75, streak: 18, last_read: "2026-06-25" },

  // 第一大區 - 大衛牧區
  { name: "楊俊傑", great_region: "第一大區", pastoral_zone: "大衛牧區", small_group: "約拿單小組", role: "group_leader", chapters_read: 980, plan_progress: 99, streak: 45, last_read: "2026-06-25" },
  { name: "許美惠", great_region: "第一大區", pastoral_zone: "大衛牧區", small_group: "約拿單小組", role: "member", chapters_read: 540, plan_progress: 80, streak: 15, last_read: "2026-06-25" },
  { name: "鄭裕民", great_region: "第一大區", pastoral_zone: "大衛牧區", small_group: "班雅明小組", role: "member", chapters_read: 300, plan_progress: 48, streak: 5, last_read: "2026-06-24" },
  { name: "謝佩珊", great_region: "第一大區", pastoral_zone: "大衛牧區", small_group: "班雅明小組", role: "member", chapters_read: 150, plan_progress: 22, streak: 2, last_read: "2026-06-25" },
  { name: "郭家豪", great_region: "第一大區", pastoral_zone: "大衛牧區", small_group: "恩典小組", role: "member", chapters_read: 620, plan_progress: 90, streak: 21, last_read: "2026-06-25" },
  { name: "賴美珍", great_region: "第一大區", pastoral_zone: "大衛牧區", small_group: "恩典小組", role: "member", chapters_read: 80, plan_progress: 12, streak: 0, last_read: "2026-06-20" },
  { name: "曾怡君", great_region: "第一大區", pastoral_zone: "大衛牧區", small_group: "約拿單小組", role: "member", chapters_read: 450, plan_progress: 72, streak: 9, last_read: "2026-06-24" },
  { name: "林志強", great_region: "第一大區", pastoral_zone: "大衛牧區", small_group: "班雅明小組", role: "member", chapters_read: 270, plan_progress: 40, streak: 4, last_read: "2026-06-23" },
  { name: "蘇瑞祥", great_region: "第一大區", pastoral_zone: "大衛牧區", small_group: "恩典小組", role: "member", chapters_read: 390, plan_progress: 62, streak: 7, last_read: "2026-06-25" },
  { name: "林大區長", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "迦勒小組", role: "great_zone_leader", chapters_read: 750, plan_progress: 88, streak: 20, last_read: "2026-06-25" },

  // 第二大區 - 提摩太牧區
  { name: "葉子毅", great_region: "第二大區", pastoral_zone: "提摩太牧區", small_group: "信實小組", role: "member", chapters_read: 110, plan_progress: 18, streak: 1, last_read: "2026-06-24" },
  { name: "周宛儒", great_region: "第二大區", pastoral_zone: "提摩太牧區", small_group: "信實小組", role: "member", chapters_read: 340, plan_progress: 50, streak: 7, last_read: "2026-06-25" },
  { name: "蕭志平", great_region: "第二大區", pastoral_zone: "提摩太牧區", small_group: "喜樂小組", role: "group_leader", chapters_read: 800, plan_progress: 95, streak: 30, last_read: "2026-06-25" },
  { name: "莊雅雯", great_region: "第二大區", pastoral_zone: "提摩太牧區", small_group: "喜樂小組", role: "member", chapters_read: 250, plan_progress: 42, streak: 5, last_read: "2026-06-25" },
  { name: "沈家欣", great_region: "第二大區", pastoral_zone: "提摩太牧區", small_group: "和平小組", role: "member", chapters_read: 190, plan_progress: 30, streak: 3, last_read: "2026-06-23" },
  { name: "馬永強", great_region: "第二大區", pastoral_zone: "提摩太牧區", small_group: "和平小組", role: "member", chapters_read: 50, plan_progress: 8, streak: 0, last_read: "2026-06-19" },
  { name: "何佩芬", great_region: "第二大區", pastoral_zone: "提摩太牧區", small_group: "信實小組", role: "member", chapters_read: 220, plan_progress: 36, streak: 4, last_read: "2026-06-25" },
  { name: "董建華", great_region: "第二大區", pastoral_zone: "提摩太牧區", small_group: "喜樂小組", role: "member", chapters_read: 410, plan_progress: 68, streak: 8, last_read: "2026-06-24" },
  { name: "薛如玉", great_region: "第二大區", pastoral_zone: "提摩太牧區", small_group: "和平小組", role: "member", chapters_read: 320, plan_progress: 52, streak: 6, last_read: "2026-06-25" },

  // 第二大區 - 撒母耳牧區
  { name: "梁哲瑋", great_region: "第二大區", pastoral_zone: "撒母耳牧區", small_group: "信心小組", role: "group_leader", chapters_read: 670, plan_progress: 91, streak: 18, last_read: "2026-06-25" },
  { name: "徐淑貞", great_region: "第二大區", pastoral_zone: "撒母耳牧區", small_group: "信心小組", role: "member", chapters_read: 290, plan_progress: 45, streak: 6, last_read: "2026-06-25" },
  { name: "孫啟宏", great_region: "第二大區", pastoral_zone: "撒母耳牧區", small_group: "盼望小組", role: "member", chapters_read: 430, plan_progress: 70, streak: 11, last_read: "2026-06-25" },
  { name: "傅小敏", great_region: "第二大區", pastoral_zone: "撒母耳牧區", small_group: "盼望小組", role: "member", chapters_read: 150, plan_progress: 25, streak: 2, last_read: "2026-06-23" },
  { name: "趙崇禮", great_region: "第二大區", pastoral_zone: "撒母耳牧區", small_group: "愛心小組", role: "member", chapters_read: 590, plan_progress: 88, streak: 16, last_read: "2026-06-24" },
  { name: "魏雅琪", great_region: "第二大區", pastoral_zone: "撒母耳牧區", small_group: "愛心小組", role: "member", chapters_read: 110, plan_progress: 18, streak: 0, last_read: "2026-06-21" },
  { name: "韓秀蘭", great_region: "第二大區", pastoral_zone: "撒母耳牧區", small_group: "信心小組", role: "member", chapters_read: 380, plan_progress: 60, streak: 8, last_read: "2026-06-25" },
  { name: "馮俊男", great_region: "第二大區", pastoral_zone: "撒母耳牧區", small_group: "盼望小組", role: "member", chapters_read: 240, plan_progress: 38, streak: 3, last_read: "2026-06-24" },
  { name: "秦碧君", great_region: "第二大區", pastoral_zone: "撒母耳牧區", small_group: "愛心小組", role: "member", chapters_read: 490, plan_progress: 75, streak: 10, last_read: "2026-06-25" },
  
  // 主任牧師
  { name: "張主任牧師", great_region: "第一大區", pastoral_zone: "約書亞牧區", small_group: "迦勒小組", role: "senior_pastor", chapters_read: 1050, plan_progress: 95, streak: 60, last_read: "2026-06-25" }
];

// Helper functions for mock data calculations with RBAC role filter
const MockStatsService = {
  // Filters raw user list based on the logged-in user's role and scopes
  filterUsersByRole: (users, currentUser) => {
    if (!currentUser) return users;
    const role = currentUser.role || "member";
    
    if (role === "senior_pastor" || role === "admin") {
      return users; // Can see everything
    }
    
    if (role === "great_zone_leader") {
      // Can only see their own great region
      return users.filter(u => u.great_region === currentUser.great_region);
    }
    
    if (role === "zone_leader") {
      // Can only see their own pastoral zone
      return users.filter(u => u.pastoral_zone === currentUser.pastoral_zone);
    }
    
    if (role === "group_leader") {
      // Can only see their own small group
      return users.filter(u => u.pastoral_zone === currentUser.pastoral_zone && u.small_group === currentUser.small_group);
    }
    
    // member: Can only see themselves
    return users.filter(u => u.name === currentUser.name);
  },

  getAllUsers: (currentUser = null) => {
    let users = [...MOCK_USERS_DATA];
    if (currentUser && currentUser.name && currentUser.pastoral_zone && currentUser.small_group) {
      const existingIdx = users.findIndex(u => u.name === currentUser.name);
      if (existingIdx !== -1) {
        users[existingIdx] = { ...users[existingIdx], ...currentUser };
      } else {
        users.push(currentUser);
      }
    }
    // Apply RBAC filtering
    return MockStatsService.filterUsersByRole(users, currentUser);
  },

  getPastoralZoneStats: (currentUser = null) => {
    const users = MockStatsService.getAllUsers(currentUser);
    const zoneStats = {};

    // Get zones relevant to the filtered users
    users.forEach(user => {
      const zone = user.pastoral_zone;
      if (!zone) return;
      
      if (!zoneStats[zone]) {
        zoneStats[zone] = {
          name: zone,
          great_region: user.great_region,
          member_count: 0,
          total_chapters: 0,
          avg_progress: 0,
          active_count: 0,
          progress_sum: 0
        };
      }

      const stats = zoneStats[zone];
      stats.member_count += 1;
      stats.total_chapters += user.chapters_read;
      stats.progress_sum += user.plan_progress;

      // Active status check
      if (user.last_read) {
        const lastReadDate = new Date(user.last_read);
        const today = new Date();
        const diffTime = Math.abs(today - lastReadDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays <= 2) {
          stats.active_count += 1;
        }
      }
    });

    Object.keys(zoneStats).forEach(key => {
      const stats = zoneStats[key];
      if (stats.member_count > 0) {
        stats.avg_progress = Math.round(stats.progress_sum / stats.member_count);
      }
    });

    return Object.values(zoneStats).sort((a, b) => b.total_chapters - a.total_chapters);
  },

  getSmallGroupStats: (pastoralZone, currentUser = null) => {
    const users = MockStatsService.getAllUsers(currentUser).filter(u => u.pastoral_zone === pastoralZone);
    const groupStats = {};

    users.forEach(user => {
      const group = user.small_group;
      if (!group) return;

      if (!groupStats[group]) {
        groupStats[group] = {
          name: group,
          member_count: 0,
          total_chapters: 0,
          progress_sum: 0,
          avg_progress: 0
        };
      }

      const stats = groupStats[group];
      stats.member_count += 1;
      stats.total_chapters += user.chapters_read;
      stats.progress_sum += user.plan_progress;
    });

    Object.keys(groupStats).forEach(key => {
      const stats = groupStats[key];
      if (stats.member_count > 0) {
        stats.avg_progress = Math.round(stats.progress_sum / stats.member_count);
      }
    });

    return Object.values(groupStats).sort((a, b) => b.total_chapters - a.total_chapters);
  }
};

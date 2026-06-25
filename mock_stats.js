// Mock stats data for the Offline/Demo Mode to showcase Pastoral Zone statistics with RBAC
const MOCK_GREAT_REGIONS = ["東區", "南區", "西區", "北區", "青少年", "慶典", "創藝"];

const MOCK_PASTORAL_ZONES_BY_REGION = {
  "東區": ["大安1", "大安2", "大安3", "大安4", "大安7", "大安8", "大安9", "大安10", "大安11", "大安12", "信義2", "南港"],
  "南區": ["大安6", "信義3", "松山", "文山", "新烏1", "新烏2", "新烏3", "新烏4"],
  "西區": ["中正1", "中正2", "中正3", "中正4", "中永和", "新莊1", "新莊2", "新莊3"],
  "北區": ["中正5", "中山1", "中山2", "中山3", "中山5", "士林", "內湖", "板三蘆"],
  "青少年": ["青少年教會", "活校1", "活嗨", "大學"],
  "慶典": ["慶典1", "慶典2"],
  "創藝": ["創藝"]
};

const MOCK_PASTORAL_ZONES = [
  "大安1", "大安2", "大安3", "大安4", "大安7", "大安8", "大安9", "大安10", "大安11", "大安12", "信義2", "南港",
  "大安6", "信義3", "松山", "文山", "新烏1", "新烏2", "新烏3", "新烏4",
  "中正1", "中正2", "中正3", "中正4", "中永和", "新莊1", "新莊2", "新莊3",
  "中正5", "中山1", "中山2", "中山3", "中山5", "士林", "內湖", "板三蘆",
  "青少年教會", "活校1", "活嗨", "大學",
  "慶典1", "慶典2",
  "創藝"
];

// Generate default small groups for each pastoral zone to show in options
// Predefined small groups mapped to pastoral zones
const MOCK_SMALL_GROUPS = {
  "大安1": ["馬鈴", "安利", "玉君"],
  "大安2": ["名雅", "韋彤", "文文", "Eason"],
  "大安3": ["兆尹", "朱朱", "絢伊", "嘉宥"],
  "大安4": ["天韻", "怡信", "旭雯"],
  "大安6": ["郁君", "Jeff", "無敵", "瑞玉"],
  "大安7": ["曉萍", "楊桃", "鈺書"],
  "大安8": ["倩如", "莊導/Isa", "佳靜/Isa"],
  "大安9": ["明耀", "玉銓", "惠英"],
  "大安10": ["意茹", "福智", "桂心"],
  "大安11": ["秋桂", "夙珠"],
  "大安12": ["芝綺", "子媛", "東宏"],
  "中正1": ["詠溱", "Marisa", "濰瑄", "文如"],
  "中正2": ["Dolly", "旻鴻", "Ingrid", "韻芝/馨柳", "Irene"],
  "中正3": ["鍾傑", "老人", "小紅"],
  "中正4": ["達哥", "孟玲"],
  "中正5": ["樹人", "毓倩", "琇誼"],
  "中山1": ["建安", "愉琍琬婷", "壹晴", "鳳如"],
  "中山2": ["培貞", "昌賢", "凱仲", "宛瑜", "琬婷培貞"],
  "中山3": ["華誠", "梅雋", "儷友"],
  "中山5": ["依庭", "易姍", "阿康", "裕昇"],
  "信義2": ["Gary", "衍如", "小葉", "阿鐘"],
  "信義3": ["保羅", "易展", "太郎", "稚鈞辰辰"],
  "士林": ["哲蓉", "盈蒨", "小菜", "爸爸", "金宛"],
  "松山": ["小美", "Stacy", "維靜", "正道", "育萍"],
  "南港": ["逸賢", "慧甜", "秋如"],
  "內湖": ["育玲", "瑋琦", "雅鈴"],
  "文山": ["千惠", "雯菁", "Kelly", "毛姐"],
  "新烏1": ["秀鳳", "旻柔", "家興"],
  "新烏2": ["達威", "櫻蒨", "俊雄", "怡惠"],
  "新烏3": ["Erika", "雨農"],
  "新烏4": ["亭筑", "秀枝"],
  "中永和": ["季樺", "婷羽", "維新培霖", "右聖", "小萍"],
  "板三蘆": ["彥宇", "Cindy"],
  "青少年教會": ["第一組", "第二組", "第三組", "第四組", "第五組"],
  "活校1": ["高嘉鴻", "盧冠毓"],
  "活嗨": ["干靖", "沛恩", "予芯"],
  "大學": ["朵拉", "又銓永祥"],
  "慶典1": ["威宇", "瑋佑", "雯樺", "佳樺", "姿穎"],
  "慶典2": ["唐寧", "乃華/裕順", "宥宥", "政緯", "競文", "秀怡", "科技"],
  "創藝": ["嘎嘎", "宸瑋", "美珠"],
  "新莊1": ["翠欗", "阿淳"],
  "新莊2": ["慧雯", "都都", "佳欣"],
  "新莊3": ["善揚", "比嗨", "家榕+瑞典"]
};

// Generate mock users with roles and great regions mapping
const MOCK_USERS_DATA = [
  // 東區 - 大安1
  { name: "陳建國", great_region: "東區", pastoral_zone: "大安1", small_group: "馬鈴", role: "group_leader", chapters_read: 480, plan_progress: 85, streak: 12, last_read: "2026-06-25" },
  { name: "林秀琴", great_region: "東區", pastoral_zone: "大安1", small_group: "馬鈴", role: "member", chapters_read: 210, plan_progress: 35, streak: 3, last_read: "2026-06-25" },
  { name: "吳志明", great_region: "東區", pastoral_zone: "大安1", small_group: "安利", role: "member", chapters_read: 520, plan_progress: 88, streak: 14, last_read: "2026-06-25" },
  
  // 東區 - 大安2
  { name: "張明哲", great_region: "東區", pastoral_zone: "大安2", small_group: "名雅", role: "group_leader", chapters_read: 650, plan_progress: 92, streak: 25, last_read: "2026-06-24" },
  { name: "黃雅婷", great_region: "東區", pastoral_zone: "大安2", small_group: "名雅", role: "member", chapters_read: 120, plan_progress: 20, streak: 1, last_read: "2026-06-23" },
  
  // 東區 - 信義2
  { name: "李冠宇", great_region: "東區", pastoral_zone: "信義2", small_group: "Gary", role: "group_leader", chapters_read: 310, plan_progress: 55, streak: 6, last_read: "2026-06-25" },
  { name: "王淑芬", great_region: "東區", pastoral_zone: "信義2", small_group: "Gary", role: "member", chapters_read: 90, plan_progress: 15, streak: 0, last_read: "2026-06-22" },
  
  // 東區 - 區長
  { name: "東區區長", great_region: "東區", pastoral_zone: "大安1", small_group: "馬鈴", role: "zone_leader", chapters_read: 600, plan_progress: 75, streak: 18, last_read: "2026-06-25" },
  { name: "東區大區長", great_region: "東區", pastoral_zone: "大安1", small_group: "馬鈴", role: "great_zone_leader", chapters_read: 750, plan_progress: 88, streak: 20, last_read: "2026-06-25" },

  // 南區 - 大安6
  { name: "楊俊傑", great_region: "南區", pastoral_zone: "大安6", small_group: "郁君", role: "group_leader", chapters_read: 980, plan_progress: 99, streak: 45, last_read: "2026-06-25" },
  { name: "許美惠", great_region: "南區", pastoral_zone: "大安6", small_group: "郁君", role: "member", chapters_read: 540, plan_progress: 80, streak: 15, last_read: "2026-06-25" },
  
  // 南區 - 信義3
  { name: "鄭裕民", great_region: "南區", pastoral_zone: "信義3", small_group: "保羅", role: "member", chapters_read: 300, plan_progress: 48, streak: 5, last_read: "2026-06-24" },
  { name: "謝佩珊", great_region: "南區", pastoral_zone: "信義3", small_group: "保羅", role: "member", chapters_read: 150, plan_progress: 22, streak: 2, last_read: "2026-06-25" },
  
  // 南區 - 文山
  { name: "郭家豪", great_region: "南區", pastoral_zone: "文山", small_group: "千惠", role: "member", chapters_read: 620, plan_progress: 90, streak: 21, last_read: "2026-06-25" },
  
  // 南區 - 區長
  { name: "南區區長", great_region: "南區", pastoral_zone: "大安6", small_group: "郁君", role: "zone_leader", chapters_read: 610, plan_progress: 78, streak: 16, last_read: "2026-06-25" },

  // 西區 - 中正1
  { name: "葉子毅", great_region: "西區", pastoral_zone: "中正1", small_group: "詠溱", role: "member", chapters_read: 110, plan_progress: 18, streak: 1, last_read: "2026-06-24" },
  { name: "周宛儒", great_region: "西區", pastoral_zone: "中正1", small_group: "詠溱", role: "member", chapters_read: 340, plan_progress: 50, streak: 7, last_read: "2026-06-25" },
  
  // 西區 - 中永和
  { name: "蕭志平", great_region: "西區", pastoral_zone: "中永和", small_group: "季樺", role: "group_leader", chapters_read: 800, plan_progress: 95, streak: 30, last_read: "2026-06-25" },
  { name: "莊雅雯", great_region: "西區", pastoral_zone: "中永和", small_group: "季樺", role: "member", chapters_read: 250, plan_progress: 42, streak: 5, last_read: "2026-06-25" },
  
  // 西區 - 區長
  { name: "西區區長", great_region: "西區", pastoral_zone: "中正1", small_group: "詠溱", role: "zone_leader", chapters_read: 640, plan_progress: 80, streak: 15, last_read: "2026-06-25" },

  // 北區 - 中山1
  { name: "梁哲瑋", great_region: "北區", pastoral_zone: "中山1", small_group: "建安", role: "group_leader", chapters_read: 670, plan_progress: 91, streak: 18, last_read: "2026-06-25" },
  { name: "徐淑貞", great_region: "北區", pastoral_zone: "中山1", small_group: "建安", role: "member", chapters_read: 290, plan_progress: 45, streak: 6, last_read: "2026-06-25" },
  
  // 北區 - 士林
  { name: "孫啟宏", great_region: "北區", pastoral_zone: "士林", small_group: "哲蓉", role: "member", chapters_read: 430, plan_progress: 70, streak: 11, last_read: "2026-06-25" },
  { name: "傅小敏", great_region: "北區", pastoral_zone: "士林", small_group: "哲蓉", role: "member", chapters_read: 150, plan_progress: 25, streak: 2, last_read: "2026-06-23" },
  
  // 北區 - 區長
  { name: "北區區長", great_region: "北區", pastoral_zone: "中山1", small_group: "建安", role: "zone_leader", chapters_read: 630, plan_progress: 82, streak: 12, last_read: "2026-06-25" },

  // 青少年 - 青少年教會
  { name: "林青年", great_region: "青少年", pastoral_zone: "青少年教會", small_group: "第一組", role: "group_leader", chapters_read: 420, plan_progress: 78, streak: 19, last_read: "2026-06-25" },
  { name: "王同學", great_region: "青少年", pastoral_zone: "青少年教會", small_group: "第一組", role: "member", chapters_read: 180, plan_progress: 30, streak: 4, last_read: "2026-06-24" },
  
  // 慶典 - 慶典1
  { name: "慶典同工", great_region: "慶典", pastoral_zone: "慶典1", small_group: "威宇", role: "group_leader", chapters_read: 590, plan_progress: 88, streak: 16, last_read: "2026-06-24" },
  
  // 創藝 - 創藝
  { name: "創藝同工", great_region: "創藝", pastoral_zone: "創藝", small_group: "嘎嘎", role: "group_leader", chapters_read: 490, plan_progress: 75, streak: 10, last_read: "2026-06-25" },
  
  // 主任牧師 & Admin
  { name: "張主任牧師", great_region: "東區", pastoral_zone: "大安1", small_group: "馬鈴", role: "senior_pastor", chapters_read: 1050, plan_progress: 95, streak: 60, last_read: "2026-06-25" },
  { name: "系統管理員", great_region: "東區", pastoral_zone: "大安1", small_group: "馬鈴", role: "admin", chapters_read: 80, plan_progress: 72, streak: 15, last_read: "2026-06-25" }
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

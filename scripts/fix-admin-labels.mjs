import fs from 'fs';
import path from 'path';

const filepath = path.resolve('js/modules/admin.js');
console.log('Reading file:', filepath);
let content = fs.readFileSync(filepath, 'utf-8');

const replacements = [
  // 1. Chips & Arrow
  { from: '嚙踝蕭嚙', to: '清除' },
  { from: '嚙踝蕭賂蕭訾嚙踝蕭嚙', to: '篩選大區' },
  { from: '嚙踝蕭賂蕭踝蕭對蕭嚙', to: '篩選牧區' },
  { from: '嚙踝蕭賂蕭賂蕭嚙質嚙', to: '篩選小組' },
  { from: '嚙踝蕭鞊ｇ蕭嚙質蕭鞊ｇ蕭嚙賡嚙', to: '篩選大區/牧區/小組' },
  { from: '嚙踝蕭鞊ｇ蕭嚙賣對蕭嚙', to: '選擇大區' },
  { from: '嚙踝蕭鞊ｇ蕭嚙踝蕭嚙賣嚙踝蕭', to: '選擇牧區' },
  { from: '嚙踝蕭鞊ｇ蕭嚙賣嚙質嚙', to: '選擇小組' },
  { from: '嚙踝蕭賂蕭嚙', to: '全部' },
  { from: '剜嚙踝蕭', to: '大區' },
  { from: '嚙踝蕭對蕭嚙', to: '牧區' },
  { from: '蕭荔蕭', to: '小組' },

  // 2. Predefined regions (fallback array)
  { from: '"嚙踝蕭蕭嚙"', to: '"第一大區"' },
  { from: '"嚙踝蕭嚙踝蕭嚙踝蕭"', to: '"第二大區"' },
  { from: '"潸號嚙踝蕭"', to: '"第三大區"' },
  { from: '"嚙踝蕭嚙踝蕭嚙踝蕭"', to: '"第四大區"' },
  { from: '"嚙踝蕭嚙賣嚙賣嚙"', to: '"第五大區"' },
  { from: '"嚙踝蕭蕭嚙"', to: '"第六大區"' },
  { from: '"嚙踝蕭蕭嚙"', to: '"第七大區"' },

  // 3. Debug logging
  { from: '嚙踝蕭嚙踝蕭 [Debug] Bottom Sheet 嚙踝蕭鞊ｇ蕭嚙賜嚙踝蕭嚙賣蟡蕭嚙踝蕭: 嚙踝蕭賂蕭嚙', to: '管理 [Debug] Bottom Sheet 選擇清除條件: ' },
  { from: '嚙踝蕭嚙踝蕭 [Debug] Bottom Sheet 嚙踝蕭鞊ｇ蕭嚙質蕭鞊ｇ蕭嚙賡嚙:', to: '管理 [Debug] Bottom Sheet 選擇條件:' },
  { from: '嚙踝蕭嚙踝蕭 [Debug] 嚙踝蕭嚙踝蕭嚙踝蕭嚙踝蕭剜嚙踝蕭 Bottom Sheet', to: '管理 [Debug] 關閉篩選 Bottom Sheet' },
  { from: '嚙踝蕭嚙 [Debug] 蕭嚙踝蕭斤嚙踝蕭鞊ｇ蕭嚙質蕭嚙踝蕭嚙踝蕭綽蕭嚙踝蕭嚙:', to: '管理 [Debug] 清除篩選條件:' },
  { from: '嚙踝蕭嚙踝蕭 [Debug] 剜嚙質悻嚙踝蕭嚙踝蕭嚙踝蕭嚙賣嚙踝蕭嚙踝蕭蕭嚙踝蕭嚙踝蕭嚙踝蕭 Bottom Sheet:', to: '管理 [Debug] 點擊篩選按鈕開啟 Bottom Sheet:' },
  { from: '嚙踝蕭嚙踝蕭 [Debug] 嚙踝蕭嚙踝蕭嚙踝蕭 Bottom Sheet 嚙踝蕭嚙踝蕭嚙踝蕭綽蕭嚙踝蕭嚙', to: '管理 [Debug] 點擊關閉按鈕關閉 Bottom Sheet' },
  { from: '嚙踝蕭嚙踝蕭 [Debug] 嚙踝蕭 Bottom Sheet 嚙踝蕭嚙', to: '管理 [Debug] 點擊背景關閉 Bottom Sheet' },

  // 4. Role names & options
  { from: '蕭嚙踝蕭蟡蕭嚙踝蕭嚙踝蕭', to: '一般會友' },
  { from: '蕭荔蕭嚙踝蕭嚙', to: '小組長' },
  { from: '剜嚙踝蕭嚙踝蕭嚙', to: '大區長' },
  { from: '蝯蕭嚙踝蕭嚙踝蕭', to: '系統管理員' },
  { from: '蕭嚙踝蕭鈭嚙踝蕭嚙:', to: '渲染名單失敗:' },
  { from: '嚙踝蕭 ${user.name} 嚙踝蕭嚙賜嚙踝蕭嚙踝蕭', to: '變更 ${user.name} 的權限階級' },
  { from: '嚙踝蕭曇澈堆蕭', to: '未設定' },
  { from: '賣嚙賢祐嚙質嚙踝蕭嚙踝蕭', to: '修改管理範圍' },
  { from: '嚙踝蕭嚙賢嚙 [Debug] 賣嚙賢祐嚙質嚙踝蕭嚙踝蕭嚙踝蕭嚙踝蕭嚙踝蕭⊥嚙踝蕭嚙踝蕭嚙賢嚙踝蕭嚙踝蕭嚙踝蕭湛蕭嚙${user.name}', to: '管理 [Debug] 點擊修改管理範圍按鈕: ${user.name}' },
  { from: '漸嚙踝蕭嚙踝蕭嚙踝蕭嚙賣嚙賢嚙質嚙踝蕭嚙踝蕭蕭', to: '管理範圍修改成功' }, // Wait, in line 328 it was 嚙踝蕭
  { from: '嚙踝蕭嚙踝蕭嚙踝蕭嚙賣嚙賢嚙質嚙踝蕭嚙踝蕭蕭', to: '管理範圍修改成功' },
  { from: '嚙踝蕭皝蕭改蕭哨蕭嚙踝蕭嚙賣蕭嚙賢嚙賡嚙踝蕭嚙踝蕭啗嚙踝蕭', to: '伺服器連線失敗，請稍後再試或聯絡管理員' },
  { from: '蕭嚙踝蕭皜莎蕭嚙踝蕭嚙質瞉蕭嚙踝蕭蕭', to: '請選擇變更的權限階級' },
  { from: '嚙踝蕭嚙賢嚙 [Debug] 蕭嚙踝蕭皜莎蕭嚙踝蕭嚙質瞉蕭嚙踝蕭綽蕭嚙踝蕭嚙: ${user.name} -> ${opt.label}', to: '管理 [Debug] 點擊變更權限階級: ${user.name} -> ${opt.label}' },
  { from: '嚙踝蕭嚙踝蕭嚙賡嚙踝蕭嚙賣嚙踝蕭嚙踝蕭伐蕭嚙踝蕭嚙踝蕭恬蕭嚙踝蕭蕭嚙', to: '權限變更成功' },
  { from: '蕭嚙踝蕭皜莎蕭嚙踝蕭嚙質隞蕭嚙踝蕭蕭ｇ蕭嚙踝蕭嚙賡橘蕭嚙', to: '權限變更失敗，請重新整理頁面' },

  // 5. Select placeholder options
  { from: '-- ???踝蕭??????????--', to: '-- 請選擇大區 --' },
  { from: '-- ???踝蕭???????????賡?踝蕭????--', to: '-- 請先選擇大區以載入牧區 --' },
  { from: '-- ???踝蕭????踝蕭?賣??踝蕭綽?蕭?????--', to: '-- 請先選擇牧區以載入小組 --' },
  { from: '-- ???踝蕭????踝蕭?賣??踝蕭 --', to: '-- 請選擇牧區 --' },
  { from: '-- ???踝蕭??????質??--', to: '-- 請選擇小組 --' },

  // 6. Responsibility Modal Labels & Inputs
  { from: '蕭嚙賣嚙踝蕭 (嚙踝蕭迎蕭嚙踝蕭嚙踝蕭)', to: '勾選管轄牧區 (可多選)' },
  { from: '蕭嚙踝蕭荔蕭 (嚙踝蕭迎蕭嚙踝蕭嚙踝蕭)', to: '勾選管轄小組 (可多選)' },
  { from: '嚙踝蕭嚙賜嚙', to: '取消' },
  { from: '嚙踝蕭蕭嚙踝蕭嚙', to: '確認變更' },
  { from: '嚙踝蕭芯嚙踝蕭嚙賡嚙踝蕭嚙踝蕭', to: '暫無資料' },
  { from: '蕭銋蕭嚙踝蕭 (嚙踝蕭迎蕭嚙踝蕭嚙踝蕭)', to: '勾選管轄大區 (可多選)' },

  // 7. Responsibility Modal Validation
  { from: 'alert("ｇ蕭嚙踝蕭喉蕭嚙踝蕭嚙質悻嚙踝蕭蕭嚙踝蕭嚙賣對蕭嚙賢嚙");', to: 'alert("請選擇至少一個管轄大區！");' },
  { from: 'alert("ｇ蕭嚙踝蕭喉蕭嚙踝蕭嚙質悻嚙踝蕭蕭嚙踝蕭嚙踝蕭嚙賣嚙踝蕭蕭");', to: 'alert("請選擇至少一個管轄牧區！");' },
  { from: 'alert("ｇ蕭嚙踝蕭喉蕭嚙踝蕭嚙質悻嚙踝蕭蕭嚙踝蕭嚙賣嚙質嚙賢嚙");', to: 'alert("請選擇至少一個管轄小組！");' },

  // 8. Feature settings wall control labels
  { from: 'enabled ? "?殷蕭???對蕭??????賣??????蕭?" : "??????賣????????賡獢?????€?蕭?"', to: 'enabled ? "牧區分享牆功能已開啟" : "牧區分享牆功能已關閉"' },
  { from: 'status.textContent = enabled ? "???獢???????????????蕭????????輯改????賣??????蕭?" : "???獢????蕭殷???????賡???????賡??蕭?";', to: 'status.textContent = enabled ? "已開啟：所有堂會成員皆可在首頁看見「牧區分享牆」，進行靈修分享與互動。" : "已關閉：首頁將隱藏「牧區分享牆」，僅保留個人靈修進度紀錄與團隊功能。";' },
  { from: 'feedback.textContent = "???獢??????????賡??????????ｇ蕭????????賣?伐蕭?????????????";', to: 'feedback.textContent = "無法載入設定：從伺服器獲取牧區分享牆設定失敗。";' },
  { from: 'feedback.textContent = "?????????????質?????????????ｇ蕭??綽蕭????賡?????";', to: 'feedback.textContent = "更新設定失敗：無法將設定儲存至伺服器。";' },
  { from: 'showToast(nextEnabled ? "???對蕭??????賣??????蕭?賣歹蕭??????" : "???對蕭??????賣??????蕭?賣蕭?賣???);', to: 'showToast(nextEnabled ? "牧區分享牆功能已開啟！" : "牧區分享牆功能已關閉。");' },

  // 9. Extra UI values / fallback roles
  { from: '嚙踝蕭蕭鞎陬嚙踝蕭嚙踝蕭嚙踝蕭', to: '無符合搜尋條件的成員' }
];

let replacedCount = 0;
for (const rep of replacements) {
  if (content.includes(rep.from)) {
    // Escape regex characters
    const escapedFrom = rep.from.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    content = content.replace(new RegExp(escapedFrom, 'g'), rep.to);
    console.log(`Replaced string [${rep.from}] with [${rep.to}]`);
    replacedCount++;
  }
}

fs.writeFileSync(filepath, content, 'utf-8');
console.log(`Successfully completed ${replacedCount} replacements in admin.js!`);

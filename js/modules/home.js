// js/modules/home.js
import { validateVerseSource } from "./verse-validator.mjs";
import { DAILY_VERSES, pickDailyVerse } from "../data/daily_verses.mjs";
import { DevotionalSharingController } from "./devotional-sharing-controller.mjs";
import { formatUpcomingPlanCountdown } from "./home-plan-countdown.mjs";
import { refreshLightningQuizHomeCard } from "./lightning-quiz.mjs";
import { getRoundProgressDisplay } from "../data/round-progress-display.mjs";
import { decideReminderBanners, readDismissed, saveDismissal, toDateKey as toReminderDateKey } from "../data/plan-reminders.mjs";

const sharingController = new DevotionalSharingController();
let pastoralSharingWallEnabled = false;
let dashboardSecondaryWorkTimer = null;

function applyPastoralSharingWallVisibility(enabled) {
  pastoralSharingWallEnabled = enabled === true;
  const card = document.getElementById("pastoral-sharing-wall-card");
  if (!card) return;
  card.classList.toggle("hidden", !pastoralSharingWallEnabled);
  card.setAttribute("aria-hidden", pastoralSharingWallEnabled ? "false" : "true");
  if (!pastoralSharingWallEnabled) {
    const wall = document.getElementById("home-verse-wall");
    if (wall) wall.innerHTML = "";
    document.querySelector(".devotional-card")?.classList.add("hidden");
  }
}

async function refreshPastoralSharingWallAvailability() {
  applyPastoralSharingWallVisibility(false);
  if (typeof db === "undefined" || typeof db.getFeatureSetting !== "function") return false;
  const result = await db.getFeatureSetting("pastoral_sharing_wall", false);
  const enabled = !result.error && result.enabled === true;
  applyPastoralSharingWallVisibility(enabled);
  if (enabled) await fetchPastoralVerseWall();
  return enabled;
}

window.addEventListener("pastoral-sharing-wall-changed", event => {
  const enabled = event.detail?.enabled === true;
  applyPastoralSharingWallVisibility(enabled);
  if (enabled) fetchPastoralVerseWall();
});

function scheduleDashboardSecondaryWork() {
  if (dashboardSecondaryWorkTimer !== null) {
    clearTimeout(dashboardSecondaryWorkTimer);
  }

  const scheduleAfterPaint = typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : callback => window.setTimeout(callback, 0);

  scheduleAfterPaint(() => {
    dashboardSecondaryWorkTimer = window.setTimeout(() => {
      dashboardSecondaryWorkTimer = null;
      calculateAndRenderPersonalRankings();
      loadTodayDevotional();
      refreshPastoralSharingWallAvailability();
      renderPilgrimageTrail();
      if (typeof hydrateIcons === "function") {
        hydrateIcons(document.getElementById("dashboard-view"));
      }
    }, 0);
  });
}




const HEAVENLY_FATHER_CARDS = [
  "親愛的孩子：不要怕，只要信！當你覺得疲憊或孤單時，來到我這裡，我必為你重新注滿愛與力量。我以永遠的愛愛你，我絕不撇下你。",
  "親愛的孩子：你不是一個錯誤。你生命中所有的日子，都寫在我的冊上了。我定準了你的年歲和所住的疆界，你受造是極其奇妙可畏的。",
  "親愛的孩子：我是你的供應者，我必供應你所需的一切。我向你所懷的意念，是要叫你末後有指望。放手交託給我，我就為你成就大事。",
  "親愛的孩子：你傷心的時候，我靠近你；如同牧人懷抱羊羔，我將你懷抱在胸前。有一天，我要擦去你一切的眼淚，帶走你所有的苦楚。",
  "親愛的孩子：當你感到信心不足時，請來仰望我。失敗只是我磨練你的過程，生命真正的意義，在於即便在困難中仍能靠我常常喜樂。",
  "親愛的孩子：不要害怕，我與你同在。我用張開、充滿熱情的愛環繞你。當你感到孤單絕望時，來到我面前，我會賜給你不同的眼光看世界。",
  "親愛的孩子：你是照著我的形象所造的，在我的眼中你是極其珍貴的。你的頭髮我都一一數過了，你生活、動作、存留，都在乎我。",
  "親愛的孩子：我並非冷漠而憤怒的，我是完全的愛。我因你歡欣喜樂，我決不停止施恩與你，因為你是我最珍貴的產業。",
  "親愛的孩子：如果你一心一意尋找我，就必尋見；以我為樂，我就把你心裡所求的賜給你。我能為你成就一切，遠超過你所求所想。",
  "親愛的孩子：我是你最佳的鼓勵者，也是在一切患難中安慰你的父親。我要恢復你的力量，恢復你的禱告，因為在我這裡永遠有平安。",
  "親愛的孩子：無論發生什麼，請記得我永遠愛你，你永遠是我的寶貝。當世界讓你失望時，我的雙手永遠為你敞開，等候你回家。",
  "親愛的孩子：在乾旱之年你也不用掛慮，因為你就像栽在水旁的樹。只要你倚靠我，你的葉子仍必青翠，且會源源不斷地結出豐盛的果實。",
  "親愛的孩子：應當一無罣慮，只要凡事藉著禱告和感謝，將你所要的告訴我。我所賜出人意外的平安，必在基督耶穌裡保守你的心懷意念。",
  "親愛的孩子：你所經歷的風浪，我都看見了。我是平息風浪的主，只要對我有信心，安靜在我懷裡，你會看見風浪之後的彩虹與晴天。",
  "親愛的孩子：在人這是不能的，但在我凡事都能。不要用你受限的眼光來看你的未來，因為我為你預備的，是眼睛未曾看見、人心也未曾想到的美妙計劃。",
  "親愛的孩子：我的恩典夠你用的，因為我的能力是在人的軟弱上顯得完全。當你覺得自己最軟弱無助的時候，正是我的大能要彰顯的時候。",
  "親愛的孩子：要常常喜樂，不住地禱告，凡事謝恩。因為當你開始感恩時，喜樂的泉源就會從你心中湧流出來，黑暗與愁雲也必退去。",
  "親愛的孩子：你要保守你心，勝過保守一切，因為一生的果效是由心發出。不要讓世界的喧囂奪走了你的平靜，讓我的話語成為你心中的錨。",
  "親愛的孩子：我留下平安給你，我將我的平安賜給你。我所賜的，不像世人所賜的。所以你心裡不要憂愁，也不要膽怯，昂首前行吧！",
  "親愛的孩子：你要專心仰賴我，不可倚靠自己的聰明。在你一切所行的事上都要認定我，我必指引你的路，帶領你走出迷茫。",
  "親愛的孩子：我以永遠的愛愛你，我向你的意念其數比海沙更多。你是獨一無二的，不需要去迎合世界或與他人比較，因為我就是愛本來的你。",
  "親愛的孩子：疲乏的，我賜能力；軟弱的，我加力量。當你奔跑困倦、行走疲乏時，來到我的施恩座前，我必使你如鷹展翅上騰，重新得力。",
  "親愛的孩子：你是我的手工作品，在基督裡造成的。我為你量身打造了美好的路程，不要害怕跨出腳步，因為我早已在你前面為你開路。",
  "親愛的孩子：不要為明天憂慮，因為明天自有明天的憂慮。一天的難處一天當就夠了。學會活在今天，享受我今天為你預備的陽光與恩典。",
  "親愛的孩子：手扶著犁向後看的人，不配進神的國。忘記背後，努力面前的，向著標竿直跑。你的過去已經被我塗抹，你的未來充滿無限的榮耀。",
  "親愛的孩子：你們要先求我的國和我的義，這些東西都要加給你們了。當你把我放在你生命的首位時，你會發現一切的需要我都早已為你預備妥當。",
  "親愛的孩子：各人要隨本心所酌定的，不要作難，不要勉強，因為捐得樂意的人是我所喜愛的。用慷慨與愛心去祝福他人，你必經歷加倍的豐盛。",
  "親愛的孩子：主就是那靈；我的靈在那裡，那裡就得以自由。脫去那些束縛你的重擔與罪疚感，在我愛的光中，你可以自由自在地呼吸與生活。",
  "親愛的孩子：你從水中經過，我必與你同在；你逿過江河，水必不漫過你。不管環境看起來多麼險惡，我都在你身邊，我是你隨時的幫助。",
  "親愛的孩子：凡你們所做的都要憑愛心而做。愛是恆久忍耐，又有恩慈。當你用愛去對待身邊的人時，你就是在彰顯我的榮耀，我也必因此賜福與你。",
  "親愛的孩子：當你覺得無人了解你的痛苦時，請記得我看見了你的眼淚。我將你的眼淚裝在我的革袋裡，我比任何人都更在乎你的心痛。",
  "親愛的孩子：你不用刻意裝得堅強。在我面前，你可以坦然哭泣，展現你的脆弱。我就是你最好的避難所，我溫柔的手會撫平你的不安。",
  "親愛的孩子：事情的終局強如事情的起頭。雖然現在這段路看起來漫長而痛苦，但我正在為你預備一個榮耀的終局，忍耐到底的必然得救。",
  "親愛的孩子：世界總是以你的表現和成就來定義你的價值，但我只因為你是我的孩子而愛你。你的存在本身就是對我最大的喜悅。",
  "親愛的孩子：你所做最微小的善事，哪怕只是給小子一杯涼水，我都牢記在心。不要灰心喪志，因為到了時候，你必會看見豐收的喜樂。",
  "親愛的孩子：人看外貌，我卻看內心。你的善良、你的掙扎、你對正直的堅持，我都看得清清楚楚。你在暗中行的一切，我都必在明處報答你。",
  "親愛的孩子：不要與別人比較。每個人都有我為他們量身設定的腳步。專注於我帶領你的方向，因為你的腳步也是我所定準的。",
  "親愛的孩子：我從來不打盹，也不睡覺。在黑夜最深的時候，我也依然站在你身旁守護你。安心合眼入睡吧，我正在為你承擔一切重擔。",
  "親愛的孩子：你的過去無法決定你的未來。在我這裡，每天都是新的起點。我的恩典每天早上都是新的，我的誠實極其廣大。",
  "親愛的孩子：不要讓怨恨留在你心裡。原諒那些傷害你的人，不是因為他們配得，而是因為你配得自由。放手交給我，我會親自為你伸冤。",
  "親愛的孩子：我是平息狂風暴雨的神。雖然你現在的環境狂風肆虐，但只要你相信我，對我說：'主啊，我相信你'，風浪就必漸漸平息。",
  "親愛的孩子：我必為你打破銅門，砍斷鐵閂。你生命中所面臨的那些看似無法逾越的障礙，在我面前都將如蠟融化。要剛強壯膽！",
  "親愛的孩子：我向你所懷的意念，不是降災禍的意念，而是賜平安的意念。你要堅定相信，我所允許發生的一切事情，最終都將使你得益處。",
  "親愛的孩子：不要害怕別人的眼光。我是你的盾牌，是你的榮耀，又是叫你抬起頭來的。在我的愛中，你可以抬起頭來，充滿自信地生活。",
  "親愛的孩子：你的身體是聖靈的殿。要好好愛護自己，不要用過度的工作或焦慮來摧殘你的身心。安靜休息，也是一種對我的信靠。",
  "親愛的孩子：我是你隨時的幫助。你不需要等到事情完美了才來找我。現在，就在你最混亂、最不知所措的時刻，直接開口呼求我吧！",
  "親愛的孩子：我是你的盾牌。那射向你的冷言冷語和惡意攻擊，我都為你擋下了。不要害怕，因為保護你的，是萬軍之耶和華。",
  "親愛的孩子：要學會安靜下來。在安靜中，你才能聽見我微小的聲音，領受我給你的智慧與指引。得力在乎平靜安穩，得救在乎歸回安息。",
  "親愛的孩子：不要羨惡人發達。他們的路終必走入荒涼。而你的路，雖然可能窄小，卻是一條引向永恆生命與無限豐盛的生命之路。",
  "親愛的孩子：我必為你敞開天上的府庫，將福氣傾倒在你身上，甚至無處可容。只要你行事為人對得起我，你就必看見我的恩惠滿溢。",
  "親愛的孩子：我是好牧人。我認識我的羊，我的羊也認識我。哪怕你走迷了路，我也必翻山越嶺把你找回來，抱在懷中帶回溫暖的家。",
  "親愛的孩子：不要因為等待而失去信心。我的時間表是最完美的。當我似乎沒有回應時，我其實正在你的生命中做更深、更美好的鋪陳。",
  "親愛的孩子：你手所做的工作，我都必親自堅立。不要覺得你的努力都是徒然。只要你心裡存著誠實為我而做，你的勞苦就必蒙我紀念。",
  "親愛的孩子：我是醫治你的主。不論是身體的疾病，還是心靈的創傷，我都能醫治。將你的痛處交給我，讓我用慈愛的膏油為你抹平傷痛。",
  "親愛的孩子：要用愛心接待客旅。當你用愛去溫暖身邊的人時，你就如同在服事我。我必照著你付出的愛，加倍地回饋與你。",
  "親愛的孩子：不要被過去的失敗所束縛。我的兒子耶穌已經在十字架上為你承擔了一切。抬起頭來，你是自由的，也是被赦免的。",
  "親愛的孩子：我必為你開通達的道路。當前面看似無路時，我必在曠野開道路，在沙漠開江河。要堅信我的大能，我正為你做一件新事。",
  "親愛的孩子：我是阿拉法，我是俄梅戛；我是創始成終的神。既然我開始了在你身上的美好善工，我就必親自帶領你，直到這工圓滿完成。",
  "親愛的孩子：要穿戴我賜給你的全副軍裝，就能抵擋魔鬼的詭計。這軍裝就是真理、公義、平安的福音、信德、救恩與聖靈的寶劍。",
  "親愛的孩子：不要懼怕黑暗，因為我就是光。當你走在死蔭的幽谷時，我的光也必照亮你的腳步，保護你安然度過每一個險境。",
  "親愛的孩子：你的靈魂極其寶貴，甚至連全天下的財寶都無法相比。我是如此珍惜你，甚至願意為你付出生命。要明白你被愛的程度。",
  "親愛的孩子：要用智慧與溫柔來回答眾人。一句溫和的回答能消解怒氣，一腔暴戾的言語只會挑起爭端。讓你的口成為祝福的源頭。",
  "親愛的孩子：在人際關係中受的傷，我都看見了。我是纏裹傷口的神，我必為你預備真心相待的屬靈夥伴，讓你重新經歷愛的溫暖。",
  "親愛的孩子：不要為生命憂慮吃什麼、喝什麼，為身體憂慮穿什麼。你看野地的百合花，野地的草，我都如此妝飾牠們，何況是你們呢？",
  "親愛的孩子：我是看顧你的神。不論你走到哪裡，我的眼目都從不離開你。你出你入，我都必保護你，從現在直到永遠。",
  "親愛的孩子：要常常在我的愛中扎根。只有當你深深明白我是如何愛你時，你才能有充足的勇氣去面對生活中的所有挑戰與風浪。",
  "親愛的孩子：我必賜智慧給你，使你能在複雜的局面中做出正確的抉擇。只要你向我求，我必慷慨賜予，並且不責備你。",
  "親愛的孩子：不要讓世界的價值觀奪走了你的喜樂。追求地上的名利終必虛空，追求我的國度和永恆的福分，必能帶給你持久的平安。",
  "親愛的孩子：我是你的山寨，是你的高臺。當仇敵像洪水般湧來時，來到我的保護傘下，沒有任何武器能傷害躲在我懷裡的你。",
  "親愛的孩子：要存心謙卑，彼此順服。尊榮以前，必有謙卑。當你願意放低自己、服事他人時，我必在最適當的時刻將你升為高。",
  "親愛的孩子：當你覺得無路可走時，向天舉目吧！你的幫助是從造天地的耶和華而來。我必不叫你的腳搖動，保護你的也必不打盹。",
  "親愛的孩子：我必用我的恩惠像盾牌一樣四面護衛你。只要你行在我的心意中，恩惠與慈愛就必一生一世緊緊隨著你，永不離開。",
  "親愛的孩子：要保守口舌，不出惡言。多言多語難免有過，禁止嘴唇是有智慧。讓你的言語充滿恩慈，好像用鹽調和一樣。",
  "親愛的孩子：我是你生命的主宰。你一生的道路都在我的手中。不要害怕未知的明天，因為我早已站在你的明天，為你安排好了一切。",
  "親愛的孩子：當你感到軟弱、提不起勁來禱告時，不要自責。我的聖靈會用說不出來的嘆息替你祈求，我深知你心中的渴望與無奈。",
  "親愛的孩子：要結出聖靈的果子，就是仁愛、喜樂、和平、忍耐、恩慈、良善、信實、溫柔和節制。這是我要在你生命中雕琢的樣貌。",
  "親愛的孩子：不要因環境的艱難而對我的愛產生懷疑。我的愛是永恆不變的，沒有任何事情能叫你與我的愛隔絕。我是你永遠的靠山。",
  "親愛的孩子：我是你性命的保障，你還懼怕誰呢？縱有軍兵安營攻擊你，你的心也不要害怕。要堅信在爭戰之中，我必為你取得勝利。",
  "親愛的孩子：要用喜樂的心去面對每一天。喜樂的心乃是良藥，憂傷的靈使骨枯乾。當你笑看生活時，我的恩典就會成為你的力量。",
  "親愛的孩子：我是賜平安的神，我必親自將平安充滿你的心，使你在這動盪的世界中，依然能擁有平靜的靈魂與安穩的腳步。",
  "親愛的孩子：要行公義，好憐憫，存謙卑的心，與你的神同行。這就是我對你的期望，當你如此行時，你就必得著滿足的喜樂。",
  "親愛的孩子：不要害怕為主名受委屈。在世上你們有苦難，但你們可以放心，耶穌已經勝了世界。你在我裡面所受的苦，必有榮耀的賞賜。",
  "親愛的孩子：我是你的磐石，我的工作是完美的。不論你覺得自己有多少缺點，在我眼中，你都是我精心設計、無可替代的藝術品。",
  "親愛的孩子：要將你的道路交託耶和華，並倚靠他，他就必成全。不要急著用自己的手段去解決問題，安靜等候我的作為吧！",
  "親愛的孩子：我是你的亮光，要照亮你黑暗的角落。不論你心中藏著什麼陰霾，帶到我的光中吧，我必用溫暖的愛將其完全驅散。",
  "親愛的孩子：要以感謝進入我的門，以讚美進入我的院。當你開始讚美時，鎖鏈就會斷開，監牢的大門也必為你震動敞開。",
  "親愛的孩子：不要灰心，我的恩典始終與你同在。你在流淚撒種時所付出的每一份努力，都必在歡呼收割的季節得到百倍的收成。",
  "親愛的孩子：我是你的避難所，是你的力量，是你在患難中隨時的幫助。所以地雖改變，山雖動搖到海心，我們也不要害怕。",
  "親愛的孩子：要常常思念上面的事，不要只思念地上的事。地上的事物都會過去，唯有我給你的應許與永恆的國度會永遠長存。",
  "親愛的孩子：我是萬王之王，萬主之主。這世界上沒有任何權勢能大過我。只要你堅定跟隨我，就沒有任何環境能阻擋我對你的祝福。",
  "親愛的孩子：要凡事謝恩。不論在順境還是逆境中，都尋找值得感謝的地方。感恩的心境會開啟你屬靈的眼睛，看見藏在困難背後的祝福。",
  "親愛的孩子：不要怕，因為我與你同在。我必堅固你，我必幫助你，我必用我公義的右手扶持你。我的右手滿有能力，必領你進入寬闊之地。",
  "親愛的孩子：我是耶和華拉法，是醫治你的神。我聽見了你的禱告，看見了你的眼淚，我必醫治你，使你的生命重新煥發出健康與朝氣。",
  "親愛的孩子：要殷勤不可懶惰。要心裡火熱，常常服事主。在你的崗位上盡忠職守，因為你不是在服事人，而是在服事愛你的天父。",
  "親愛的孩子：我是耶和華以勒，在我的山上必有預備。不要為明天的生計和物質缺乏焦慮，我必照著我榮耀的豐富，充足地供應你一切需要。",
  "親愛的孩子：要保守自己常在我的愛中，仰望我們主耶穌基督的憐憫，直到永生。你是我懷裡的羊羔，沒有人能從我的手中將你奪去。",
  "親愛的孩子：不要為作惡的心懷不平，也不要嫉妒那行不義的。因為他們如草快被割下，又如綠色的青草快要枯乾。你當倚靠我而行善。",
  "親愛的孩子：我是你的引導者。我必在你的前面行，為你修平崎嶇的道路。只要你緊緊跟隨我的腳步，你就必不至迷失方向，得著生命的冠冕。",
  "親愛的孩子：要曉得真理，真理必叫你們得以自由。不要再被謊言和罪疚感所控訴，在我兒子耶穌的寶血裡，你已經獲得了完全的釋放與自由。",
  "親愛的孩子：無論你現在面對什麼，請記住我的慈愛永遠長存。我的慈愛比生命更好，我的嘴唇要頌讚你。去吧，帶著我的愛與祝福，勇敢地活出精彩的每一天！"
];

export function updateDashboardView() {
  try {
    if (typeof calculatePlanProgress === "function") {
      calculatePlanProgress();
    }
  } catch (e) {
    console.warn("[Home] calculatePlanProgress error:", e);
  }
  const greetingEl = document.getElementById("user-greeting");
  if (greetingEl) {
    greetingEl.textContent = state.currentUser.name || "弟兄姊妹";
  }
  const streakEl = document.getElementById("streak-days");
  if (streakEl) {
    streakEl.textContent = state.currentUser.streak || "0";
  }

  renderDailyVerse();
  updateAnnouncementsList();
  refreshPlanReminderBanner();
  void refreshExamHomeBanner();
  void refreshDevotionHomeCard();
  void refreshGroupMeetingHomeCard();
  void refreshLightningQuizHomeCard();



  const planSummaryDiv = document.getElementById("active-plan-summary");
  // state.activePlan 是全 app 共用的單一指標，「預覽」每日靈修／小組聚會週
  // 計畫時也會暫時把它設成那份計畫（見 previewDevotionalPlanAsMember 等）。
  // 這張卡是繞著一般讀經計畫的章節/輪次/百分比畫的，靈修計畫沒有這些欄位，
  // 硬塞進來只會顯示一堆 undefined——所以這裡當作「沒有進行中的計畫」處理，
  // 靈修計畫改由獨立的「每日靈修」卡片（refreshDevotionHomeCard）負責。
  const activePlanKind = state.activePlan && (state.activePlan.planKind || state.activePlan.plan_kind);
  const hasRegularActivePlan = state.activePlan
    && activePlanKind !== "devotional" && activePlanKind !== "group_meeting";
  if (hasRegularActivePlan) {
    const progress = state.activePlan.progress || 0;
    const currentRound = state.activePlan.currentRound || 1;
    const currentRoundTotalChapters = state.activePlan.currentRoundTotalChapters || state.activePlan.totalChapters;
    // #293：第 2 遍以後不要再讓「0%」單獨出現——用「第幾遍」代表進度，
    // 本遍的實際章數改到狀態文字裡（見下方 roundProgress.roundStatusText）。
    const roundProgress = getRoundProgressDisplay({
      round: currentRound,
      progress,
      read: state.activePlan.completedChapters,
      total: currentRoundTotalChapters
    });
    const started = isPlanStarted(state.activePlan);
    const countdownText = started
      ? ""
      : formatUpcomingPlanCountdown(state.activePlan.startDate);
    const waitingLabel = countdownText
      ? `等待開始・${countdownText}`
      : "等待開始";
    const isAdmin = state.currentUser && getUserRoleCode(state.currentUser) === 'admin';
    const isPlanAvailable = started || isAdmin;
    let statusText = "";
    if (started) {
      statusText = roundProgress.isMultiRound
        ? roundProgress.roundStatusText
        : `進度: ${progress}% (${state.activePlan.completedChapters} / ${currentRoundTotalChapters} 章)`;
    } else {
      statusText = `<span class="text-brand" style="font-weight: 500;">${waitingLabel}</span> (將於 ${state.activePlan.startDate} 開始)`;
    }

    const streakDays = state.currentUser.streak || 0;
    const totalCompletionRate = progress;

    const now = new Date();
    const todayYear = now.getFullYear();
    const todayMonth = now.getMonth() + 1;
    const todayDay = now.getDate();

    const isFixed = state.activePlan.isFixed !== false && state.activePlan.is_fixed !== false;

    let todayDayObj = null;
    const planDays = Array.isArray(state.activePlan.days) ? state.activePlan.days : [];
    if (isFixed) {
      todayDayObj = planDays.find(d => {
        if (!d || Number(d.year) !== todayYear || Number(d.month) !== todayMonth) return false;
        const parts = String(d.date || "").split('/');
        return parts.length === 2 && Number(parts[1]) === todayDay;
      });
    } else {
      // 彈性時間計畫：指向第一個未完成的讀經天數
      todayDayObj = planDays.find(d => {
        const currentRound = state.activePlan.currentRound || 1;
        return d.chapters && d.chapters.some(ch => {
          const taskRound = ch.round || currentRound;
          let isRead = false;
          if (taskRound === 1) isRead = ch.isReadR1 || ch.isRead;
          else if (taskRound === 2) isRead = ch.isReadR2;
          else if (taskRound >= 3) isRead = ch.isReadR3;
          else isRead = ch.isRead;
          return !isRead;
        });
      });
      if (!todayDayObj && planDays.length > 0) {
        todayDayObj = planDays[planDays.length - 1];
      }
    }

    let todayTotalCount = 0;
    let todayReadCount = 0;
    if (todayDayObj && todayDayObj.chapters) {
      todayTotalCount = todayDayObj.chapters.length;
      todayDayObj.chapters.forEach(ch => {
        const currentRound = state.activePlan.currentRound || 1;
        const taskRound = ch.round || currentRound;
        let isRead = false;
        if (taskRound === 1) isRead = ch.isReadR1 || ch.isRead;
        else if (taskRound === 2) isRead = ch.isReadR2;
        else if (taskRound >= 3) isRead = ch.isReadR3;
        else isRead = ch.isRead;
        if (isRead) todayReadCount++;
      });
    }

    const periodHtml = isFixed
      ? `計畫週期: ${state.activePlan.startDate} ~ ${state.activePlan.endDate} (${state.activePlan.totalDays} 天)`
      : `計畫類型: 彈性時間 (共 ${state.activePlan.totalDays} 天)`;

    const progressLabel = isFixed ? "今日進度" : `第 ${todayDayObj ? todayDayObj.dayNum : 1} 天`;

    let dayNum = 1;
    if (isFixed) {
      if (todayDayObj) {
        dayNum = todayDayObj.dayNum;
      } else {
        const planStart = new Date(state.activePlan.startDate + "T00:00:00");
        const todayZero = new Date();
        todayZero.setHours(0, 0, 0, 0);
        dayNum = Math.max(1, Math.round((todayZero - planStart) / 86400000) + 1);
      }
    } else {
      dayNum = todayDayObj ? todayDayObj.dayNum : 1;
    }

    planSummaryDiv.innerHTML = `
      <div class="plan-progress-header">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
          <h4 style="font-size: 1.15rem; font-weight: 500; color: var(--text-primary); margin: 0;">${state.activePlan.name}</h4>
          ${started
        ? `<span class="stat-badge stat-badge--success">第 ${dayNum} 天</span>`
        : `<span class="stat-badge stat-badge--brand">${waitingLabel}</span>`
      }
        </div>
        <p style="font-size: 0.88rem; color: var(--text-secondary); margin-top: 0.2rem;">
          ${periodHtml}
        </p>
        <div class="plan-progress-wrapper plan-progress-wrapper--spaced${roundProgress.isMultiRound ? " plan-progress-wrapper--layered" : ""}">
          ${roundProgress.isMultiRound ? `<div class="plan-progress-bar-base"></div>` : ""}
          <div class="plan-progress-bar" style="width: ${roundProgress.isMultiRound ? roundProgress.progressLayers.currentRoundPercent : progress}%;"></div>
        </div>
        <p style="font-size: 0.88rem; font-weight: 500; color: var(--text-secondary); margin-top: 0.5rem; text-align: right; margin-bottom: 1rem;">
          ${statusText}
        </p>

        <div class="dashboard-stat-strip"
             onclick="event.stopPropagation(); window.showPlanStatsModal ? window.showPlanStatsModal() : null;"
             title="點擊展開詳細統計">
          <div class="dashboard-stat-strip__item">
            <span class="dashboard-stat-strip__value dashboard-stat-strip__value--warning">
              <span class="nlc-icon dashboard-stat-strip__icon" data-icon="fire" aria-hidden="true"></span>${streakDays} 天
            </span>
            <span class="dashboard-stat-strip__label">連續讀經</span>
          </div>
          <div class="dashboard-stat-strip__divider"></div>
          <div class="dashboard-stat-strip__item">
            <span class="dashboard-stat-strip__value dashboard-stat-strip__value--brand">
              <span class="nlc-icon dashboard-stat-strip__icon" data-icon="bookOpen" aria-hidden="true"></span>${todayReadCount}/${todayTotalCount} 章
            </span>
            <span class="dashboard-stat-strip__label">${progressLabel}</span>
          </div>
          <div class="dashboard-stat-strip__divider"></div>
          <div class="dashboard-stat-strip__item">
            <span class="dashboard-stat-strip__value dashboard-stat-strip__value--success">
              ${roundProgress.isMultiRound
                ? `<span class="nlc-icon dashboard-stat-strip__icon" data-icon="crown" aria-hidden="true"></span>${roundProgress.roundLabel}`
                : `<span class="nlc-icon dashboard-stat-strip__icon" data-icon="trendTwo" aria-hidden="true"></span>${totalCompletionRate}%`}
            </span>
            <span class="dashboard-stat-strip__label">計畫進度</span>
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 1rem; margin-top: 1.2rem;">
        <button class="secondary-btn flex-btn" onclick="event.stopPropagation(); window.openActivePlanFromDashboard()">讀經表</button>
        <button class="primary-btn flex-btn" onclick="event.stopPropagation(); window.startReadingCurrentChapter()" ${isPlanAvailable ? '' : 'disabled style="opacity: 0.6; cursor: not-allowed;"'}>開始閱讀</button>
      </div>
    `;
    planSummaryDiv.classList.add("route-plan-card");
    planSummaryDiv.setAttribute("role", "button");
    planSummaryDiv.setAttribute("tabindex", "0");
    planSummaryDiv.onclick = window.openActivePlanFromDashboard;
    planSummaryDiv.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        window.openActivePlanFromDashboard(event);
      }
    };
  } else {
    planSummaryDiv.classList.remove("route-plan-card");
    planSummaryDiv.removeAttribute("role");
    planSummaryDiv.removeAttribute("tabindex");
    planSummaryDiv.onclick = null;
    planSummaryDiv.onkeydown = null;
    planSummaryDiv.innerHTML = `
      <div class="empty-state" style="text-align: center; padding: 2rem 0;">
        <p style="color: var(--text-secondary); margin-bottom: 1rem;">${(window.APP_COPY && window.APP_COPY.plan.emptyBody) || "還沒加入讀經計畫"}</p>
        <button class="primary-btn" onclick="appRouter.switchTab('plan-view')">${(window.APP_COPY && window.APP_COPY.plan.emptyCta) || "去找計畫"}</button>
      </div>
    `;
  }

  scheduleDashboardSecondaryWork();
}

async function renderPilgrimageTrail(customMembers = null, customPlan = null) {
  const canvas = document.getElementById("team-pilgrimage-canvas") || document.getElementById("pilgrimage-canvas");
  if (!canvas) return;

  const targetPlan = customPlan || state.activePlan || (Array.isArray(state.activePlans) ? state.activePlans[0] : null) || (Array.isArray(state.globalPlans) ? state.globalPlans[0] : null);
  let planDays = (targetPlan && Array.isArray(targetPlan.days) && targetPlan.days.length > 0) ? targetPlan.days : [];
  if (planDays.length === 0 && typeof window.createChurchCampaignStageDefinitions === "function" && typeof window.cloneChurchCampaign === "function") {
    try {
      const defaultCampaign = window.cloneChurchCampaign();
      const stages = window.createChurchCampaignStageDefinitions(defaultCampaign);
      if (stages && stages[0] && Array.isArray(stages[0].days)) {
        planDays = stages[0].days;
      }
    } catch (e) {
      console.warn("Fallback stage generation error:", e);
    }
  }

  if (planDays.length === 0) {
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const ctx = canvas.getContext("2d");
  const currentRound = (targetPlan && targetPlan.currentRound) || 1;
  // Canvas 2D silently ignores an invalid fillStyle/strokeStyle assignment
  // (keeping whatever color was last set) rather than throwing — assigning
  // a raw "var(--x)" string here was a no-op the whole time, so unread
  // tiles were actually drawn in whatever color the previous tile/path left
  // behind. Resolve the actual computed colors once instead.
  const rootStyles = getComputedStyle(document.body);
  const unreadTileStroke = rootStyles.getPropertyValue("--border-card").trim() || "gray";
  const unreadTileText = rootStyles.getPropertyValue("--text-secondary").trim() || "gray";

  const planChapters = [];
  let lastBook = null;
  planDays.forEach(day => {
    if (!day || !day.chapters) return;
    day.chapters.forEach(ch => {
      const isBookStart = ch.book !== lastBook;
      planChapters.push({
        bookName: ch.book,
        chapterNum: ch.chapter,
        isReadR1: ch.isReadR1 || false,
        isReadR2: ch.isReadR2 || false,
        isReadR3: ch.isReadR3 || false,
        isRead: ch.isRead || false,
        isBookStart
      });
      lastBook = ch.book;
    });
  });

  const TOTAL_PLAN_CHAPTERS = planChapters.length;
  if (TOTAL_PLAN_CHAPTERS === 0) return;

  const myR1Count = planChapters.filter(c => c.isReadR1).length;
  const myR2Count = planChapters.filter(c => c.isReadR2).length;
  const myR3Count = planChapters.filter(c => c.isReadR3).length;
  const myChaptersRead = currentRound === 3 ? myR3Count : (currentRound === 2 ? myR2Count : myR1Count);

  let groupMembers = [];
  if (Array.isArray(customMembers) && customMembers.length > 0) {
    groupMembers = customMembers.map(m => {
      const name = m.name || m.displayName || (m.profile && m.profile.name) || "隊友";
      const chapters_read = Number(m.chapters_read ?? m.completedChapters ?? m.readChapters ?? m.completed_chapters ?? m.completed ?? 0);
      return {
        name,
        chapters_read,
        isMe: Boolean(m.isMe || name === state.currentUser?.name)
      };
    });
  } else {
    let allUsers = await db.fetchMergedUsersList();
    const myZone = state.currentUser.pastoral_zone || "";
    groupMembers = myZone ? allUsers.filter(u => u.pastoral_zone === myZone) : [];
    if (!groupMembers || groupMembers.length === 0) {
      groupMembers = [{ name: state.currentUser.name, chapters_read: myChaptersRead }];
    }

    groupMembers = groupMembers.map(m =>
      m.name === state.currentUser?.name ? { ...m, chapters_read: myChaptersRead } : m
    );
    if (!groupMembers.some(m => m.name === state.currentUser?.name)) {
      groupMembers = [{ name: state.currentUser?.name || "我", chapters_read: myChaptersRead }, ...groupMembers];
    }
  }

  const maxChaptersRead = groupMembers.reduce((max, m) => Math.max(max, m.chapters_read || 0), 0);
  const maxDrawIndex = Math.min(Math.max(16, maxChaptersRead - 1 + 16), TOTAL_PLAN_CHAPTERS - 1);

  const brand = (window.NLC_DESIGN && window.NLC_DESIGN.brand) || "#04A9D2";
  const brandActive = (window.NLC_DESIGN && window.NLC_DESIGN.brandActive) || "#0396BA";
  const brandHover = (window.NLC_DESIGN && window.NLC_DESIGN.brandHover) || "#5BB8D4";
  const success = (window.NLC_DESIGN && window.NLC_DESIGN.success) || "var(--status-success, #04A9D2)";
  const successFg = (window.NLC_DESIGN && window.NLC_DESIGN.successForeground) || "#047857";
  const palette = {
    1: { myPath: brand, grpPath: "#8ED4EA", myFill: "rgba(4,169,210,0.15)", grpFill: "rgba(4,169,210,0.08)", myStroke: brand, grpStroke: brandHover, myText: brandActive, grpText: brandHover },
    2: { myPath: success, grpPath: "#A8F5C0", myFill: "rgba(102,247,143,0.15)", grpFill: "rgba(102,247,143,0.08)", myStroke: success, grpStroke: success, myText: successFg, grpText: successFg },
    3: { myPath: "#f59e0b", grpPath: "#fcd34d", myFill: "#fef3c7", grpFill: "#fffbeb", myStroke: "#d97706", grpStroke: "#ca8a04", myText: "#92400e", grpText: "#b45309" },
  };
  const pal = palette[Math.min(currentRound, 3)];

  const cols = 8;
  const spacingX = 72;
  const spacingY = 72;
  const rowsCount = Math.ceil((maxDrawIndex + 1) / cols);
  canvas.width = cols * spacingX + 15;
  canvas.height = rowsCount * spacingY + 15;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  function getTileCoords(index) {
    const row = Math.floor(index / cols);
    let col = index % cols;
    if (row % 2 === 1) col = cols - 1 - col;
    return { x: col * spacingX + 36, y: row * spacingY + 36 };
  }

  function drawPathLine(startIndex, endIndex, color, width = 7) {
    if (endIndex < startIndex) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const s = getTileCoords(startIndex);
    ctx.moveTo(s.x, s.y);
    for (let i = startIndex + 1; i <= endIndex; i++) {
      const p = getTileCoords(i);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  drawPathLine(0, maxDrawIndex, "rgba(226, 232, 240, 0.8)", 7);
  if (currentRound >= 2 && myR1Count > 1) {
    drawPathLine(0, Math.min(myR1Count - 1, maxDrawIndex), "rgba(4, 169, 210, 0.2)", 5);
  }
  if (maxChaptersRead > 1) {
    drawPathLine(0, Math.min(maxChaptersRead - 1, maxDrawIndex), pal.grpPath, 6);
  }
  if (myChaptersRead > 1) {
    drawPathLine(0, Math.min(myChaptersRead - 1, maxDrawIndex), pal.myPath, 8);
  }

  for (let i = 0; i <= maxDrawIndex; i++) {
    const pos = getTileCoords(i);
    const ch = planChapters[i];
    if (!ch) continue;

    const isBookStart = ch.isBookStart;
    const r = isBookStart ? 22 : 13;

    let fillStyle = "#ffffff";
    let strokeStyle = unreadTileStroke;
    let textColor = unreadTileText;
    let isBold = false;
    let strokeW = isBookStart ? 2.5 : 1.5;

    const isMineRead = i < myChaptersRead;
    const isGrpRead = !isMineRead && i < maxChaptersRead;

    if (isMineRead) {
      fillStyle = pal.myFill;
      strokeStyle = pal.myStroke;
      textColor = pal.myText;
      isBold = true;
      strokeW = isBookStart ? 3.5 : 2.5;
    } else if (isGrpRead) {
      fillStyle = pal.grpFill;
      strokeStyle = pal.grpStroke;
      textColor = pal.grpText;
      strokeW = isBookStart ? 2.5 : 1.5;
    }

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (isBookStart) {
      ctx.font = `bold 10px sans-serif`;
      ctx.fillText(ch.bookName.substring(0, 2), pos.x, pos.y);
    } else {
      ctx.font = isBold ? "bold 8px sans-serif" : "7px sans-serif";
      ctx.fillText(ch.chapterNum, pos.x, pos.y);
    }
  }

  const membersByPos = {};
  groupMembers.forEach(m => {
    const posIndex = Math.max(0, (m.chapters_read || 0) - 1);
    if (!membersByPos[posIndex]) membersByPos[posIndex] = [];
    membersByPos[posIndex].push(m);
  });

  Object.entries(membersByPos).forEach(([posStr, list]) => {
    const posIndex = parseInt(posStr, 10);
    if (posIndex > maxDrawIndex) return;
    const tilePos = getTileCoords(posIndex);
    const count = list.length;
    list.forEach((m, idx) => {
      const angle = count > 1 ? (idx * 2 * Math.PI) / count : 0;
      const offset = count > 1 ? 15 : 0;
      const x = tilePos.x + Math.cos(angle) * offset;
      const y = tilePos.y + Math.sin(angle) * offset;

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = getMemberColor(m.name);
      ctx.fill();
      ctx.lineWidth = m.isMe ? 2 : 1;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 8px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(m.name || "").substring(0, 2), x, y);
    });
  });

  const legendEl = document.getElementById("team-pilgrimage-legend") || document.getElementById("pilgrimage-legend");
  if (legendEl) {
    legendEl.innerHTML = `
      <span class="px-2 py-0.5 rounded-full flex items-center gap-1" style="display:inline-flex;align-items:center;white-space:nowrap;background: color-mix(in srgb, var(--text-primary) 5%, var(--bg-card));"><span style="display:inline-block;width:6px;height:6px;background:${pal.myStroke};border-radius:50%;"></span>隊友軌跡</span>`;
  }
}

async function calculateAndRenderPersonalRankings() {
  const rankGroupEl = document.getElementById("rank-group");
  const rankZoneEl = document.getElementById("rank-zone");
  const rankRegionEl = document.getElementById("rank-region");
  const rankChurchEl = document.getElementById("rank-church");

  if (!rankGroupEl || !rankZoneEl || !rankRegionEl || !rankChurchEl) return;

  const hasPlan = state.activePlans && state.activePlans.length > 0;
  if (!hasPlan) {
    rankGroupEl.textContent = "未加入計畫";
    rankZoneEl.textContent = "未加入計畫";
    rankRegionEl.textContent = "未加入計畫";
    rankChurchEl.textContent = "未加入計畫";
    return;
  }

  try {
    const rankSkeleton = typeof ComponentSkeletonLoader !== "undefined"
      ? ComponentSkeletonLoader.getHtml("inline", { width: "5.5rem", height: "1.4rem" })
      : "—";
    if (firstPaint(rankGroupEl)) rankGroupEl.innerHTML = rankSkeleton;
    if (firstPaint(rankZoneEl)) rankZoneEl.innerHTML = rankSkeleton;
    if (firstPaint(rankRegionEl)) rankRegionEl.innerHTML = rankSkeleton;
    if (firstPaint(rankChurchEl)) rankChurchEl.innerHTML = rankSkeleton;

    const rankings = await db.getUserRankings();
    if (rankings) {
      rankGroupEl.textContent = rankings.groupRank > 0 ? `第 ${rankings.groupRank} 名 / 共 ${rankings.groupTotal} 人` : "尚無資料";
      rankZoneEl.textContent = rankings.zoneRank > 0 ? `第 ${rankings.zoneRank} 名 / 共 ${rankings.zoneTotal} 人` : "尚無資料";
      rankRegionEl.textContent = rankings.regionRank > 0 ? `第 ${rankings.regionRank} 名 / 共 ${rankings.regionTotal} 人` : "尚無資料";
      rankChurchEl.textContent = rankings.churchRank > 0 ? `第 ${rankings.churchRank} 名 / 共 ${rankings.churchTotal} 人` : "尚無資料";
    } else {
      rankGroupEl.textContent = "無資料";
      rankZoneEl.textContent = "無資料";
      rankRegionEl.textContent = "無資料";
      rankChurchEl.textContent = "無資料";
    }
  } catch (err) {
    console.error("Error rendering personal rankings:", err);
    rankGroupEl.textContent = "載入失敗";
    rankZoneEl.textContent = "載入失敗";
    rankRegionEl.textContent = "載入失敗";
    rankChurchEl.textContent = "載入失敗";
  }
}

function getAnnouncementCategory(rawTitle = "", isFirstItem = false) {
  const title = String(rawTitle || "").trim();

  if (/【重要】|\[重要\]|【緊急】|\[緊急\]/i.test(title)) {
    return {
      categoryName: "重要／緊急公告",
      badgeClass: "announcement-badge--danger",
      iconName: "flame",
      cleanTitle: title.replace(/【重要】|\[重要\]|【緊急】|\[緊急\]/gi, "").trim(),
      isFeatured: true,
    };
  }
  if (/【一般】|\[一般\]|【公告】|\[公告\]/i.test(title)) {
    return {
      categoryName: "一般公告",
      badgeClass: "announcement-badge--default",
      iconName: "megaphone",
      cleanTitle: title.replace(/【一般】|\[一般\]|【公告】|\[公告\]/gi, "").trim(),
      isFeatured: isFirstItem,
    };
  }
  if (/【主日】|\[主日\]|【聚會】|\[聚會\]|【崇拜】|\[崇拜\]/i.test(title)) {
    return {
      categoryName: "主日消息",
      badgeClass: "announcement-badge--info",
      iconName: "church",
      cleanTitle: title.replace(/【主日】|\[主日\]|【聚會】|\[聚會\]|【崇拜】|\[崇拜\]/gi, "").trim(),
      isFeatured: isFirstItem,
    };
  }
  if (/【活動】|\[活動\]|【報名】|\[報名\]|【特會】|\[特會\]/i.test(title)) {
    return {
      categoryName: "活動報名",
      badgeClass: "announcement-badge--success",
      iconName: "party-popper",
      cleanTitle: title.replace(/【活動】|\[活動\]|【報名】|\[報名\]|【特會】|\[特會\]/gi, "").trim(),
      isFeatured: isFirstItem,
    };
  }
  if (/【提醒】|\[提醒\]|【通知】|\[通知\]|【注意事項】/i.test(title)) {
    return {
      categoryName: "溫馨提醒",
      badgeClass: "announcement-badge--warning",
      iconName: "bell",
      cleanTitle: title.replace(/【提醒】|\[提醒\]|【通知】|\[通知\]|【注意事項】/gi, "").trim(),
      isFeatured: isFirstItem,
    };
  }

  return {
    categoryName: isFirstItem ? "最新公告" : "教會消息",
    badgeClass: "announcement-badge--default",
    iconName: isFirstItem ? "sparkles" : "megaphone",
    cleanTitle: title,
    isFeatured: isFirstItem,
  };
}

function formatRelativeAnnouncementTime(dateString) {
  if (!dateString) return "";
  if (typeof formatTaiwanDateTime === "function") {
    return formatTaiwanDateTime(dateString, { relative: true });
  }
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' });
}

// #358：進度提醒橫幅。落後（本遍排定到今天卻還沒打卡）的速讀計畫各一則；沒落後就整塊隱藏。
// 決策全在 js/data/plan-reminders.mjs；這裡只做讀 localStorage（try/catch）、畫、綁事件。
// 點橫幅 → 開該計畫；按 ✕ → 當天不再出現（同一天內重畫也不會回來）。
function refreshPlanReminderBanner() {
  const host = document.getElementById("plan-reminder-banner");
  if (!host) return;
  const hide = () => { host.classList.add("hidden"); host.innerHTML = ""; };
  try {
    const plans = Array.isArray(state.activePlans) ? state.activePlans : [];
    const todayKey = toReminderDateKey(new Date());
    let storage = null;
    try { storage = window.localStorage; } catch (_) { storage = null; }
    const banners = decideReminderBanners({ plans, todayKey, dismissed: readDismissed(storage) });
    if (!banners.length) return hide();

    host.classList.remove("hidden");
    host.innerHTML = banners.map(banner => `
      <div class="plan-reminder-banner__item plan-reminder-banner__item--${banner.level}" data-plan-key="${escapeHTML(banner.planKey)}" role="button" tabindex="0">
        <span class="plan-reminder-banner__icon nlc-icon nlc-icon--md" data-icon="bell" aria-hidden="true"></span>
        <div class="plan-reminder-banner__main">
          <div class="plan-reminder-banner__title">${escapeHTML(banner.message)}</div>
          ${banner.planName ? `<div class="plan-reminder-banner__plan">${escapeHTML(banner.planName)}</div>` : ""}
        </div>
        <button type="button" class="plan-reminder-banner__close icon-button icon-button--subtle" aria-label="今天不再提醒" data-plan-reminder-dismiss>
          <span class="nlc-icon nlc-icon--sm" data-icon="close" aria-hidden="true"></span>
        </button>
      </div>`).join("");

    const openPlan = (planKey) => {
      const plan = plans.find(p => p && String(p.globalPlanId || p.id || p.presetKey || "") === planKey);
      if (!plan) return;
      state.activePlan = plan;
      if (typeof window.openActivePlanFromDashboard === "function") window.openActivePlanFromDashboard();
    };
    host.querySelectorAll(".plan-reminder-banner__item").forEach(item => {
      const planKey = item.getAttribute("data-plan-key") || "";
      item.addEventListener("click", (event) => {
        if (event.target.closest("[data-plan-reminder-dismiss]")) return;
        openPlan(planKey);
      });
      item.addEventListener("keydown", (event) => {
        if (event.target !== item) return;
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openPlan(planKey); }
      });
      const closeBtn = item.querySelector("[data-plan-reminder-dismiss]");
      if (closeBtn) closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        saveDismissal(storage, planKey, todayKey);
        item.remove();
        if (!host.querySelector(".plan-reminder-banner__item")) hide();
      });
    });
    if (typeof hydrateIcons === "function") hydrateIcons(host);
  } catch (e) {
    console.warn("[Home] refreshPlanReminderBanner error:", e);
    hide();
  }
}

// 重要／緊急公告單獨置頂（#urgent-announcements-banner），暖色外框，比一般公告醒目。
// 沒有有效的緊急公告時整塊隱藏。
function renderUrgentAnnouncementsBanner(urgentAnnouncements) {
  const banner = document.getElementById("urgent-announcements-banner");
  if (!banner) return;

  if (!urgentAnnouncements || urgentAnnouncements.length === 0) {
    banner.classList.add("hidden");
    banner.innerHTML = "";
    return;
  }

  banner.classList.remove("hidden");
  banner.innerHTML = `
    <div class="urgent-announcement-banner__list">
      ${urgentAnnouncements.map(ann => {
        const category = getAnnouncementCategory(ann.title);
        const displayTitle = category.cleanTitle || ann.title;
        const expiresAt = Date.parse(ann.expires_at || "") || 0;
        const metaText = expiresAt
          ? `顯示至 ${formatRelativeAnnouncementTime(ann.expires_at)}`
          : formatRelativeAnnouncementTime(ann.created_at);
        return `
        <article class="urgent-announcement-banner__item">
          <span class="urgent-announcement-banner__icon nlc-icon nlc-icon--md" data-icon="flame" aria-hidden="true"></span>
          <div class="urgent-announcement-banner__main">
            <div class="urgent-announcement-banner__head">
              <span class="announcement-badge announcement-badge--danger">
                <span class="nlc-icon nlc-icon--sm" data-icon="flame" aria-hidden="true"></span>
                <span>重要／緊急公告</span>
              </span>
              <time class="urgent-announcement-banner__time">${escapeHTML(metaText)}</time>
            </div>
            <h4 class="urgent-announcement-banner__title">${escapeHTML(displayTitle)}</h4>
            <p class="urgent-announcement-banner__body">${escapeHTML(ann.content || "")}</p>
          </div>
        </article>`;
      }).join("")}
    </div>`;

  if (typeof hydrateIcons === "function") hydrateIcons(banner);
}

async function renderChurchAnnouncements() {
  const container = document.getElementById("church-announcements-list");
  if (!container) return;

  const now = Date.now();
  const isUrgent = ann => getAnnouncementCategory(ann.title).badgeClass === "announcement-badge--danger";
  const allAnnouncements = (await db.fetchAnnouncements())
    .filter(announcement => {
      if (!isUrgent(announcement)) return true;
      const expiresAt = Date.parse(announcement.expires_at || "") || 0;
      return !expiresAt || expiresAt > now;
    })
    .sort((a, b) => (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0));

  // 重要／緊急公告抽出來置頂，其餘留在下方一般公告列表。
  const urgentAnnouncements = allAnnouncements.filter(isUrgent);
  const announcements = allAnnouncements.filter(ann => !isUrgent(ann));
  renderUrgentAnnouncementsBanner(urgentAnnouncements);

  if (announcements.length === 0) {
    container.className = "announcements-list";
    container.innerHTML = `
      <div class="announcements-empty">
        <span class="announcements-empty__icon nlc-icon nlc-icon--md" data-icon="inbox" aria-hidden="true"></span>
        <p class="announcements-empty__text">目前尚無教會公告。</p>
      </div>`;
    if (typeof hydrateIcons === "function") hydrateIcons(container);
    return;
  }

  container.className = "announcements-list";
  container.innerHTML = "";

  announcements.forEach((ann, index) => {
    const item = document.createElement("div");
    const categoryInfo = getAnnouncementCategory(ann.title, index === 0);

    item.className = `announcement-item${categoryInfo.isFeatured ? " announcement-item--featured" : ""}`;

    const formattedTime = formatRelativeAnnouncementTime(ann.created_at);
    const displayTitle = categoryInfo.cleanTitle || ann.title;

    item.innerHTML = `
      <div class="announcement-item__header">
        <div class="announcement-item__header-left">
          <div class="announcement-item__icon-avatar" aria-hidden="true">
            <span class="nlc-icon nlc-icon--sm" data-icon="${categoryInfo.iconName}"></span>
          </div>
          <div class="announcement-item__title-group">
            <div class="announcement-item__tags">
              <span class="announcement-badge ${categoryInfo.badgeClass}">
                <span class="nlc-icon nlc-icon--sm" data-icon="${categoryInfo.iconName}" aria-hidden="true"></span>
                <span>${categoryInfo.categoryName}</span>
              </span>
            </div>
            <h4 class="announcement-item__title">${escapeHTML(displayTitle)}</h4>
          </div>
        </div>
        <div class="announcement-item__meta">
          <time class="announcement-item__time" datetime="${escapeHTML(ann.created_at || "")}">${formattedTime}</time>
        </div>
      </div>
      <p class="announcement-item__body">${escapeHTML(ann.content)}</p>
    `;
    container.appendChild(item);
  });

  if (typeof hydrateIcons === "function") hydrateIcons(container);
}

// renderPastoralZoneRankingList removed 2026-09-16: its target container
// #dashboard-pastoral-ranking doesn't exist anywhere in the current dashboard
// template (a leftover call from a dashboard layout that was redesigned), so
// this was a permanent no-op — and its query (view_pastoral_zone_stats) had
// also been failing the whole time since that view never existed in the
// active schema. See js/modules/plan.js's removed "Stats View Logic" comment
// for the matching small-group-side story.

async function loadTodayDevotional() {
  const textarea = document.getElementById("devotional-content");
  const countEl = document.getElementById("devotional-word-count");
  if (!textarea) return;

  textarea.value = "";
  if (countEl) countEl.textContent = "字數: 0 字";
  state.currentEditingNoteId = null;
}

let isSavingDevotional = false;

function initDevotionalControls() {
  const textarea = document.getElementById("devotional-content");
  const saveBtn = document.getElementById("btn-save-devotional");
  const countEl = document.getElementById("devotional-word-count");

  if (!textarea) return;

  textarea.addEventListener("input", () => {
    const text = textarea.value;
    if (countEl) countEl.textContent = `字數: ${text.length} 字`;
  });

  if (saveBtn) {
    saveBtn.addEventListener("click", (e) => {
      e.preventDefault();
      publishDevotionalNote();
    });
  }

  const toggleBtn = document.getElementById("btn-toggle-devotional-box");
  const devCard = document.querySelector(".devotional-card");
  if (toggleBtn && devCard) {
    toggleBtn.addEventListener("click", () => {
      devCard.classList.toggle("hidden");
      if (!devCard.classList.contains("hidden")) {
        // 💡 關鍵修復：點擊分享心得時清空輸入框，且不自動寫入資料庫
        textarea.value = "";
        if (countEl) countEl.textContent = "字數: 0 字";
        textarea.focus();
      }
    });
  }

  // 歷史靈修分享切換與篩選監聽器
  const tabToday = document.getElementById("btn-wall-tab-today");
  const tabHistory = document.getElementById("btn-wall-tab-history");
  const historyFilter = document.getElementById("wall-history-filter");

  if (tabToday && tabHistory) {
    const switchTab = (activeTab, inactiveTab, targetState) => {
      try {
        sharingController.tab = targetState;
      } catch (err) {
        console.error(err);
        return;
      }

      activeTab.classList.add("active");
      activeTab.style.background = "var(--bg-card)";
      activeTab.style.color = "var(--color-brand)";
      activeTab.style.boxShadow = "var(--shadow-sm)";
      activeTab.style.fontWeight = "600";

      inactiveTab.classList.remove("active");
      inactiveTab.style.background = "transparent";
      inactiveTab.style.color = "var(--text-secondary)";
      inactiveTab.style.boxShadow = "none";
      inactiveTab.style.fontWeight = "500";

      fetchPastoralVerseWall();
    };

    tabToday.addEventListener("click", () => switchTab(tabToday, tabHistory, "today"));
    tabHistory.addEventListener("click", () => switchTab(tabHistory, tabToday, "history"));
  }

  if (historyFilter) {
    historyFilter.addEventListener("change", () => {
      try {
        sharingController.filter = historyFilter.value;
      } catch (err) {
        console.error(err);
        return;
      }
      fetchPastoralVerseWall();
    });
  }
}

async function publishDevotionalNote() {
  const textarea = document.getElementById("devotional-content");
  const saveBtn = document.getElementById("btn-save-devotional");
  const countEl = document.getElementById("devotional-word-count");
  if (!textarea) return;

  let content;
  try {
    content = sharingController.validateContent(textarea.value);
  } catch (err) {
    alert(err.message);
    return;
  }


  if (isSavingDevotional) return;

  const todayStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');

  isSavingDevotional = true;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.style.opacity = "0.6";
    const spanText = saveBtn.querySelector("span:not(.nlc-icon)");
    if (spanText) spanText.textContent = "發佈中...";
  }

  try {
    // 💡 關鍵修復：只在點擊「發佈」按鈕時才呼叫資料庫 API 新增一則心得（傳入 null 代表新增而非 update），
    // 徹底解決輸入中失去焦點或自動存檔導致在分享牆上跑出未寫完的草稿與產生重複留言的問題。
    await db.saveDevotionalNote(todayStr, content, null);

    // 發佈成功後清空欄位、關閉心得框並重整分享牆
    textarea.value = "";
    if (countEl) countEl.textContent = "字數: 0 字";

    const devCard = document.querySelector(".devotional-card");
    if (devCard) {
      devCard.classList.add("hidden");
    }

    if (typeof fetchPastoralVerseWall === "function") {
      await fetchPastoralVerseWall();
    }
  } catch (err) {
    console.error("Failed to publish devotional note:", err);
    alert("發佈失敗，請稍後再試！");
  } finally {
    isSavingDevotional = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.style.opacity = "";
      const spanText = saveBtn.querySelector("span:not(.nlc-icon)");
      if (spanText) spanText.textContent = "發佈";
    }
  }
}

window.checkAndPromptTodayCompletion = async function () {
  // 保持靜默打卡已讀，不跳出干擾視覺的恭喜字幕與對話框
  return;
  if (!state.activePlan) return;

  const now = new Date();
  const todayYear = now.getFullYear();
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();
  const todayDayObj = state.activePlan.days.find(d => {
    if (Number(d.year) !== todayYear || Number(d.month) !== todayMonth) return false;
    const parts = d.date.split('/');
    return parts.length === 2 && Number(parts[1]) === todayDay;
  });

  if (!todayDayObj || !todayDayObj.chapters || todayDayObj.chapters.length === 0) return;

  const currentRound = state.activePlan.currentRound || 1;
  const isTodayComplete = todayDayObj.chapters.every(ch => {
    const r = ch.round || currentRound;
    if (r === 1) return Boolean(ch.isReadR1 || ch.isRead);
    if (r === 2) return Boolean(ch.isReadR2);
    if (r >= 3) return Boolean(ch.isReadR3);
    return Boolean(ch.isRead);
  });

  if (!isTodayComplete) return;

  const todayStr = todayYear + '-' + String(todayMonth).padStart(2, '0') + '-' + String(todayDay).padStart(2, '0');
  const existingNote = await db.getDevotionalNote(todayStr);
  if (existingNote && existingNote.trim().length > 0) return;

  setTimeout(() => {
    if (typeof showToast === "function") {
      showToast("🎉 恭喜完成今日速讀！寫下今天最深刻的金句，分享給小組吧！", 5000);
    }
    const devContent = document.getElementById("devotional-content");
    if (devContent) {
      devContent.scrollIntoView({ behavior: 'smooth', block: 'center' });
      devContent.focus();
      const devCard = devContent.closest(".devotional-card");
      if (devCard) {
        devCard.style.outline = "2.5px solid var(--color-brand)";
        devCard.style.boxShadow = "var(--shadow-focus-ring)";
        setTimeout(() => {
          devCard.style.outline = "";
          devCard.style.boxShadow = "";
        }, 4000);
      }
    } else {
      (async () => {
        const confirmed = await window.showConfirmDialog({
          title: "🎉 恭喜完成今日速讀！",
          message: "是否前往「首頁」記錄你最印象深刻的今日金句並分享給小組？",
          confirmText: "前往分享",
          cancelText: "留在讀經"
        });
        if (confirmed) {
          appRouter.switchTab("dashboard-view");
          setTimeout(() => {
            const dc = document.getElementById("devotional-content");
            if (dc) {
              dc.scrollIntoView({ behavior: 'smooth', block: 'center' });
              dc.focus();
              const dcCard = dc.closest(".devotional-card");
              if (dcCard) {
                dcCard.style.outline = "2.5px solid var(--color-brand)";
                dcCard.style.boxShadow = "var(--shadow-focus-ring)";
                setTimeout(() => {
                  dcCard.style.outline = "";
                  dcCard.style.boxShadow = "";
                }, 4000);
              }
            }
          }, 300);
        }
      })();
    }
  }, 1000);
};

function showSaveSuccess(isAuto) {
  const statusEl = document.getElementById("devotional-save-status");
  if (!statusEl) return;

  const savedMarkup = (label) =>
    `<span class="devotional-save-status__dot" aria-hidden="true"></span>${label}`;

  statusEl.innerHTML = savedMarkup(isAuto ? "已自動儲存" : "儲存成功");
  statusEl.classList.add("text-success-fg");
  statusEl.classList.remove("text-danger");
  statusEl.style.opacity = "1";

  setTimeout(() => {
    statusEl.style.opacity = "0";
  }, 2000);
}

// renderTodayGroupProgress / renderProgressListFiltered removed 2026-09-16:
// their target #member-today-list / #member-today-search don't exist
// anywhere in index.html or any JS template — verified independently (not
// just via the automated audit) that this isn't a feature-flag-hidden
// element like the pastoral_sharing_wall's .devotional-card, it's genuinely
// absent from the DOM everywhere. state.todayGroupMembers was only ever
// written/read by this pair, so it goes too.

function getTileCoords(index) {
  const cols = 8;
  const spacingX = 72;
  const spacingY = 72;
  const startX = 40;
  const startY = 40;

  const row = Math.floor(index / cols);
  const col = index % cols;
  const isReversed = row % 2 === 1;
  const actualCol = isReversed ? (cols - 1 - col) : col;

  return {
    x: startX + actualCol * spacingX,
    y: startY + row * spacingY
  };
}

function getMemberColor(name) {
  if (name === state.currentUser.name) return (window.NLC_DESIGN && NLC_DESIGN.brand) || "#04A9D2";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = window.NLC_MEMBER_COLORS || (window.NLC_DESIGN
    ? [window.NLC_DESIGN.brand, window.NLC_DESIGN.brandHover, window.NLC_DESIGN.success, window.NLC_DESIGN.warning, "#5BB8D4", window.NLC_DESIGN.brandActive, "#8ED4EA", window.NLC_DESIGN.danger]
    : ["#04A9D2", "#0396BA", "#FE7615", "#FC365A"]);
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

window.renderPilgrimageTrail = renderPilgrimageTrail;

// initPilgrimageControls removed 2026-09-16: its target #pilgrimage-trail-board
// doesn't exist — the trail board moved into team-registration.js and was
// renamed to #team-pilgrimage-trail-board, but this zoom-control wiring
// (and its #increase-trail-zoom/-decrease-trail-zoom/-reset-trail-zoom
// buttons) never got updated, so it was a guaranteed no-op (`if (!board) return;`)
// on every call. renderPilgrimageTrail itself is unaffected and still live.

async function updateAnnouncementsList() {
  const listContainer = document.getElementById("church-announcements-list");
  if (!listContainer) return;

  if (typeof ComponentSkeletonLoader !== "undefined") {
    ComponentSkeletonLoader.fill("announcement", listContainer, { count: 2 });
  }

  await renderChurchAnnouncements();
}

let currentVerse = null;
let currentBlessing = null;
let isVerseLoading = false;
let isImgLoading = false;

const CHINESE_TO_ENGLISH_BOOKS = {
  "詩篇": "psalms",
  "以賽亞書": "isaiah",
  "箴言": "proverbs",
  "約翰福音": "john",
  "約約翰福音": "john",
  "腓立比書": "philippians",
  "羅馬書": "romans",
  "馬太福音": "matthew",
  "希伯來書": "hebrews",
  "提摩太前書": "1timothy",
  "約書亞記": "joshua",
  "申命記": "deuteronomy",
  "加拉太書": "galatians",
  "約翰一書": "1john",
  "馬可福音": "mark"
};

const CURATED_IMAGE_POOL = [
  "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1473448912268-2022ce9509d8?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1470252649358-96f5e5047118?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1475924156734-496f6cac6ec1?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1454496522488-7a8e488e8606?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1472214222541-d510753a4907?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1502082553048-f009c37129b9?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1475113548554-5a36f1f523d6?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1433086966358-54859d0ed716?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1502759683299-cdcd6974244f?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1500964757637-c85e8a162699?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1482862549707-f63cb32c5fd9?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1518156677180-95a2893f3e9f?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1528183429752-a97d0bf99b5a?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=800&q=80",
  "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?auto=format&fit=crop&w=800&q=80"
];

const VERSE_CARD_FALLBACK_IMAGE = CURATED_IMAGE_POOL[0];

function setVerseCardLoading(loading, options = {}) {
  const card = document.getElementById("verse-card");
  const skeleton = document.getElementById("verse-card-skeleton");
  const body = document.getElementById("verse-card-body");
  const bgImgEl = document.getElementById("card-bg");
  if (!card) return;

  card.classList.toggle("is-loading", loading);

  if (loading) {
    if (skeleton && typeof ComponentSkeletonLoader !== "undefined") {
      ComponentSkeletonLoader.fill("verse-card", skeleton);
    }
    if (body) body.setAttribute("aria-hidden", "true");
    if (bgImgEl && !options.preserveBackground) bgImgEl.style.opacity = "0";
  } else if (body) {
    body.removeAttribute("aria-hidden");
    body.style.pointerEvents = "";
  }
}

function preloadVerseCardImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => resolve(VERSE_CARD_FALLBACK_IMAGE);
    img.src = url;
  });
}

function applyVerseCardContent(verseData, imageUrl) {
  const card = document.getElementById("verse-card");
  const textEl = document.getElementById("daily-verse-text");
  const sourceEl = document.getElementById("daily-verse-source");
  const bgImgEl = document.getElementById("card-bg");
  const content = document.getElementById("daily-verse-content");

  if (textEl) textEl.textContent = verseData.text;
  if (sourceEl) sourceEl.textContent = verseData.source;

  if (bgImgEl) {
    bgImgEl.src = imageUrl;
    bgImgEl.style.opacity = "1";
  }

  const isBlessing = state.verseCardMode === 'blessing';
  if (isBlessing) {
    currentBlessing = { ...verseData, imageUrl };
  } else {
    currentVerse = { ...verseData, imageUrl };
  }

  if (typeof syncVerseLikes === "function") {
    syncVerseLikes(verseData.source);
  }

  setVerseCardLoading(false);
  isVerseLoading = false;
  isImgLoading = false;

  const toolbar = document.getElementById("verse-card-toolbar");
  if (toolbar && typeof hydrateIcons === "function") {
    hydrateIcons(toolbar);
  }

  card?.classList.remove("opacity-90");
  if (content) {
    content.classList.remove("opacity-40");
    content.style.opacity = "0";
    void content.offsetWidth;
    content.style.opacity = "1";
  }
}

function getDisplayedVerseCardImageUrl() {
  const bgImgEl = document.getElementById("card-bg");
  const displayedUrl = bgImgEl && bgImgEl.getAttribute("src");
  return displayedUrl || localStorage.getItem("verse_card_bg") || "";
}

async function fetchRandomVerse(event, options = {}) {
  if (event) {
    if (event.target.closest(".social-toolbar") || event.target.closest("#share-card-btn")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  if (isVerseLoading || isImgLoading) return;

  const card = document.getElementById("verse-card");
  if (!card) return;

  isVerseLoading = true;
  isImgLoading = true;

  setVerseCardLoading(true, options);

  if (!state.verseCardMode) {
    state.verseCardMode = 'verse';
  }

  const isBlessingMode = state.verseCardMode === 'blessing';
  let cardText, cardSource;

  // 使用台北時間生成今日日期字串
  const todayStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  const storageDateKey = isBlessingMode ? "daily_blessing_saved_date" : "daily_verse_saved_date";
  const savedDate = localStorage.getItem(storageDateKey);
  
  let loadedUrl = "";
  // 如果是使用者點擊按鈕手動抽卡（event 存在），或是今天尚未儲存過卡片，就重新抽取
  let shouldGenerate = !!event || savedDate !== todayStr;

  if (!shouldGenerate) {
    cardText = localStorage.getItem(isBlessingMode ? "daily_blessing_text" : "daily_verse_text");
    cardSource = localStorage.getItem(isBlessingMode ? "daily_blessing_source" : "daily_verse_source");
    loadedUrl = localStorage.getItem(isBlessingMode ? "daily_blessing_bg" : "daily_verse_bg");
  }

  if (!cardText) {
    if (isBlessingMode) {
      const randomCard = HEAVENLY_FATHER_CARDS[Math.floor(Math.random() * HEAVENLY_FATHER_CARDS.length)];
      cardText = randomCard;
      cardSource = "—— 愛你的天父";
    } else {
      // 手動「換一句」（event）維持隨機；每日預設以台北日期決定，全教會同一天同一句
      const randomLocal = event
        ? DAILY_VERSES[Math.floor(Math.random() * DAILY_VERSES.length)]
        : pickDailyVerse(todayStr);
      cardText = randomLocal.text;
      cardSource = randomLocal.source;
    }

    // 儲存至 localStorage
    localStorage.setItem(storageDateKey, todayStr);
    localStorage.setItem(isBlessingMode ? "daily_blessing_text" : "daily_verse_text", cardText);
    localStorage.setItem(isBlessingMode ? "daily_blessing_source" : "daily_verse_source", cardSource);
  }

  const preservedImageUrl = options.preserveBackground ? getDisplayedVerseCardImageUrl() : "";
  const nextImageUrl = preservedImageUrl
    || loadedUrl
    || CURATED_IMAGE_POOL[Math.floor(Math.random() * CURATED_IMAGE_POOL.length)];
  
  if (!preservedImageUrl) {
    localStorage.setItem("verse_card_bg", nextImageUrl);
    localStorage.setItem(isBlessingMode ? "daily_blessing_bg" : "daily_verse_bg", nextImageUrl);
  }
  const imgPromise = preloadVerseCardImage(nextImageUrl);

  const fetchPromise = Promise.resolve({ text: cardText, source: cardSource });

  const [result, finalLoadedUrl] = await Promise.all([fetchPromise, imgPromise]);
  applyVerseCardContent(result, finalLoadedUrl);
}

// 效能重構 A3：html2canvas（~200KB）以前是 index.html <head> 的 render-blocking
// <script>，但只有「分享今日經文卡片為圖片」會用到。改成使用者按下分享時才動態
// 載入 CDN bundle（鎖版），完全不碰首屏與資料層。
let _html2canvasLibPromise = null;
function ensureHtml2CanvasLib() {
  if (typeof html2canvas !== "undefined") return Promise.resolve();
  if (_html2canvasLibPromise) return _html2canvasLibPromise;
  _html2canvasLibPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-html2canvas-lib="1"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("html2canvas 載入失敗")));
      return;
    }
    const el = document.createElement("script");
    el.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    el.crossOrigin = "anonymous";
    el.dataset.html2canvasLib = "1";
    el.onload = () => resolve();
    el.onerror = () => {
      _html2canvasLibPromise = null;
      reject(new Error("html2canvas 載入失敗"));
    };
    document.head.appendChild(el);
  });
  return _html2canvasLibPromise;
}

async function shareAsImage(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  const shareBtn = document.getElementById("share-card-btn");
  const card = document.getElementById("verse-card");
  if (!card) return;

  if (shareBtn) {
    shareBtn.disabled = true;
    shareBtn.innerHTML = `<span class="nlc-icon nlc-icon--md" data-icon="refresh" aria-hidden="true"></span><span>分享中</span>`;
    if (typeof hydrateIcons === "function") hydrateIcons(shareBtn);
  }

  const toolbar = document.getElementById("verse-card-toolbar");

  try {
    await ensureHtml2CanvasLib();

    if (toolbar) toolbar.style.visibility = "hidden";

    const canvas = await html2canvas(card, {
      useCORS: true,
      scale: 2,
      logging: false,
      ignoreElements: (el) => {
        return el.id === "verse-card-toolbar" || el.tagName === "BUTTON";
      }
    });

    canvas.toBlob(async (blob) => {
      if (!blob) return alert('圖片產生失敗');

      const file = new File([blob], 'daily-verse.png', { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: (window.APP_COPY && window.APP_COPY.verse.shareTitle) || "今日經文",
            text: (window.APP_COPY && window.APP_COPY.verse.shareText) || "分享今日經文給你"
          });

        } catch (shareError) {
          if (shareError.name !== 'AbortError') {
            fallbackDownload(canvas);
          }
        }
      } else {
        fallbackDownload(canvas);
      }
    }, 'image/png');

  } catch (error) {
    console.error('產生分享圖片時發生錯誤:', error);
    alert((window.APP_COPY && window.APP_COPY.verse.shareFail) || '分享失敗，等一下再試試');
  } finally {
    if (toolbar) toolbar.style.visibility = "";
    if (shareBtn) {
      setTimeout(() => {
        shareBtn.disabled = false;
        shareBtn.innerHTML = `<span class="nlc-icon nlc-icon--md" data-icon="share" aria-hidden="true"></span><span>${(window.APP_COPY && window.APP_COPY.verse.share) || "分享"}</span>`;
        if (typeof hydrateIcons === "function") hydrateIcons(shareBtn);
      }, 1000);
    }
  }
}

function fallbackDownload(canvas) {
  const link = document.createElement('a');
  link.download = 'daily-verse.png';
  link.href = canvas.toDataURL('image/png');
  link.click();

}

async function syncVerseLikes(verseSource) {
  const likeBtn = document.getElementById("like-btn");
  const label = document.getElementById("like-count-text");
  if (!likeBtn || !label) return;

  let validatedSource;
  try {
    validatedSource = validateVerseSource(verseSource);
  } catch (err) {
    console.error("Invalid verse source for sync:", err);
    return;
  }

  let count = Math.max(0, parseInt(localStorage.getItem(`verse_like_count_${validatedSource}`) || "0"));
  let liked = localStorage.getItem(`verse_liked_${validatedSource}`) === "true";

  const updateUI = () => {
    const iconEl = likeBtn.querySelector(".nlc-icon");
    if (iconEl) {
      iconEl.setAttribute("data-icon", liked ? "heartFill" : "heart");
      likeBtn.classList.toggle("is-liked", liked);
      iconEl.style.color = "";
      if (typeof hydrateIcons === "function") hydrateIcons(likeBtn);
    }
    if (label) {
      label.textContent = count >= 10000 ? `${(count / 10000).toFixed(1)}萬` : count;
    }
  };

  updateUI();

  if (state.supabase && state.isSupabaseMode) {
    try {
      const { data, error } = await state.supabase.from("verse_likes").select("like_count").eq("source", validatedSource).maybeSingle();
      if (!error) {
        if (data) {
          count = Math.max(0, data.like_count || 0);
          localStorage.setItem(`verse_like_count_${validatedSource}`, count.toString());
          updateUI();
        } else {
          count = 0;
          localStorage.setItem(`verse_like_count_${validatedSource}`, "0");
          updateUI();
        }
      }
    } catch (e) {
      console.warn("Failed to sync like count from Supabase:", e);
    }
  }
}

async function toggleVerseLike(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  if (!currentVerse || !currentVerse.source) return;
  const verseSource = currentVerse.source;

  let validatedSource;
  try {
    validatedSource = validateVerseSource(verseSource);
  } catch (err) {
    console.error("Invalid verse source for like toggle:", err);
    return;
  }

  const likeBtn = document.getElementById("like-btn");
  const label = document.getElementById("like-count-text");
  if (!likeBtn || !label) return;

  let liked = localStorage.getItem(`verse_liked_${validatedSource}`) === "true";
  let count = Math.max(0, parseInt(localStorage.getItem(`verse_like_count_${validatedSource}`) || "0"));
  const previousLiked = liked;
  const previousCount = count;

  liked = !liked;
  count = Math.max(0, count + (liked ? 1 : -1));

  localStorage.setItem(`verse_liked_${validatedSource}`, liked ? "true" : "false");
  localStorage.setItem(`verse_like_count_${validatedSource}`, count.toString());

  const iconEl = likeBtn.querySelector(".nlc-icon");
  if (iconEl) {
    iconEl.setAttribute("data-icon", liked ? "heartFill" : "heart");
    likeBtn.classList.toggle("is-liked", liked);
    iconEl.style.color = "";
    if (typeof hydrateIcons === "function") hydrateIcons(likeBtn);
  }
  if (label) {
    label.textContent = count >= 10000 ? `${(count / 10000).toFixed(1)}萬` : count;
  }

  if (state.supabase && state.isSupabaseMode) {
    try {
      if (typeof state.supabase.rpc === "function") {
        const rpcName = liked ? "increment_likes" : "decrement_likes";
        const { data, error } = await state.supabase.rpc(rpcName, { verse_source: validatedSource });
        if (error) throw new Error(error.message || error.error || String(error));
        if (typeof data !== "number") throw new Error("Atomic verse-like RPC returned an invalid count.");
        const guardedData = Math.max(0, data);
        count = guardedData;
        localStorage.setItem(`verse_like_count_${validatedSource}`, guardedData.toString());
        if (label) {
          label.textContent = guardedData >= 10000 ? `${(guardedData / 10000).toFixed(1)}萬` : guardedData;
        }
      } else {
        throw new Error("Atomic verse-like RPC is unavailable; direct counter writes are forbidden.");
      }
    } catch (dbErr) {
      liked = previousLiked;
      count = previousCount;
      localStorage.setItem(`verse_liked_${validatedSource}`, liked ? "true" : "false");
      localStorage.setItem(`verse_like_count_${validatedSource}`, count.toString());
      if (iconEl) {
        iconEl.setAttribute("data-icon", liked ? "heartFill" : "heart");
        likeBtn.classList.toggle("is-liked", liked);
        if (typeof hydrateIcons === "function") hydrateIcons(likeBtn);
      }
      if (label) label.textContent = count >= 10000 ? `${(count / 10000).toFixed(1)}萬` : count;
      console.warn("Failed to toggle like on Supabase; optimistic state rolled back.", dbErr);
    }
  }
}

function renderDailyVerse(options = {}) {
  const shareBtn = document.getElementById("share-card-btn");
  if (shareBtn && !shareBtn._hasShareListener) {
    shareBtn.addEventListener("click", shareAsImage);
    shareBtn._hasShareListener = true;
  }

  const drawBtn = document.getElementById("draw-card-btn");
  if (drawBtn && !drawBtn._hasDrawListener) {
    drawBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fetchRandomVerse(e);
    });
    drawBtn._hasDrawListener = true;
  }

  const likeBtn = document.getElementById("like-btn");
  if (likeBtn && !likeBtn._hasLikeListener) {
    likeBtn.addEventListener("click", toggleVerseLike);
    likeBtn._hasLikeListener = true;
  }

  const changeBgBtn = document.getElementById("btn-change-verse-bg");
  if (changeBgBtn && !changeBgBtn._hasChangeListener) {
    changeBgBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.changeVerseCardBackground();
    });
    changeBgBtn._hasChangeListener = true;
  }

  // Initialize Mode Selectors
  if (!state.verseCardMode) {
    state.verseCardMode = 'verse';
  }

  const btnModeVerse = document.getElementById("btn-mode-verse");
  const btnModeBlessing = document.getElementById("btn-mode-blessing");

  const updateModeUI = () => {
    const isVerse = state.verseCardMode === 'verse';
    if (btnModeVerse) {
      btnModeVerse.classList.toggle("active", isVerse);
      btnModeVerse.style.background = isVerse ? "rgba(255,255,255,0.22)" : "transparent";
      btnModeVerse.style.color = isVerse ? "#ffffff" : "rgba(255,255,255,0.7)";
      btnModeVerse.style.minHeight = "15px";
      btnModeVerse.style.boxShadow = "none";
    }
    if (btnModeBlessing) {
      btnModeBlessing.classList.toggle("active", !isVerse);
      btnModeBlessing.style.background = !isVerse ? "rgba(255,255,255,0.22)" : "transparent";
      btnModeBlessing.style.color = !isVerse ? "#ffffff" : "rgba(255,255,255,0.7)";
      btnModeBlessing.style.minHeight = "15px";
      btnModeBlessing.style.boxShadow = "none";
    }
    if (drawBtn) {
      const label = !isVerse ? "抽一張" : "換一句";
      drawBtn.innerHTML = `<span class="nlc-icon nlc-icon--sm" data-icon="refresh" aria-hidden="true"></span><span>${label}</span>`;
      if (typeof hydrateIcons === "function") hydrateIcons(drawBtn);
    }
  };

  updateModeUI();

  if (btnModeVerse && !btnModeVerse._hasModeListener) {
    btnModeVerse.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.verseCardMode === 'verse') return;
      state.verseCardMode = 'verse';
      updateModeUI();
      renderDailyVerse();
    });
    btnModeVerse._hasModeListener = true;
  }

  if (btnModeBlessing && !btnModeBlessing._hasModeListener) {
    btnModeBlessing.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state.verseCardMode === 'blessing') return;
      state.verseCardMode = 'blessing';
      updateModeUI();
      renderDailyVerse({ preserveBackground: true });
    });
    btnModeBlessing._hasModeListener = true;
  }

  const savedBg = localStorage.getItem("verse_card_bg");
  const activeMode = state.verseCardMode || 'verse';
  const currentData = activeMode === 'blessing' ? currentBlessing : currentVerse;

  if (!currentData) {
    setVerseCardLoading(true, options);
    fetchRandomVerse(null, options);
  } else {
    setVerseCardLoading(true, options);
    const imageUrl = savedBg || currentData.imageUrl || CURATED_IMAGE_POOL[(new Date().getDate() - 1) % CURATED_IMAGE_POOL.length];
    preloadVerseCardImage(imageUrl).then((loadedUrl) => {
      applyVerseCardContent(
        { text: currentData.text, source: currentData.source },
        loadedUrl
      );
    });
  }
}

// ── 首頁「每日靈修」獨立卡片 ────────────────────────────────────────────────
// 刻意跟上面「進行中的計畫」卡片完全分開：那張卡繞著單一個 state.activePlan
// 指標畫進度條/百分比，靈修計畫沒有「進度」這個概念，硬塞進同一張卡只會兩邊
// 都變得四不像。
//
// ⚠️ 靈修計畫沒有「加入」這回事（不像一般讀經計畫要寫進 reading_plans 才會
// 出現在 state.activePlans）——只有「這個人看不看得到」：daily_devotion 功能
// 開了就所有人看得到，沒開就只有 admin/pastor 看得到（先建內容用）。所以這裡
// 一定要查 state.globalPlans + isDevotionalPlanVisibleToUser()，查
// state.activePlans 永遠會是空的，卡片永遠不會出現。
let devotionHomeCardRequestId = 0;

// 首頁卡片判斷「這個人看不看得到靈修 / 小組聚會」靠 window.devotionGroupFeaturesMasterEnabled
// 等旗標——這些平常只有在使用者進「計畫」/「個人」分頁時，才由 plan.js 的
// ensureDevotionGroupPreferencesLoaded() 載入。剛登入直接停在首頁的話旗標還是
// undefined，isDevotionalPlanVisibleToUser() 會誤判成「看不到」把卡片藏起來
// （使用者回報：每次重新登入靈修 / 小組聚會卡都不出現）。這裡自己確保載入一次；
// plan.js 之後真的載入時，ensureDevotionGroupPreferencesLoaded 會沿用同一份值。
async function ensureDevotionGroupFlagsForHome() {
  if (typeof window.devotionGroupFeaturesMasterEnabled === "boolean"
      && typeof window.devotionGroupHidden === "boolean") return;
  if (typeof window.ensureDevotionGroupPreferencesLoaded === "function") {
    try { await window.ensureDevotionGroupPreferencesLoaded(); return; } catch (_) { /* 往下自己抓 */ }
  }
  if (typeof db === "undefined" || typeof db.getMyDevotionGroupPreferences !== "function") return;
  try {
    const [r, hiddenRes] = await Promise.all([
      db.getMyDevotionGroupPreferences(),
      db.getFeatureSetting ? db.getFeatureSetting("devotion_group_hidden", false) : Promise.resolve({ enabled: false })
    ]);
    window.devotionGroupHidden = !!(hiddenRes && hiddenRes.enabled === true);
    if (r && r.success && r.data) {
      window.devotionGroupFeaturesMasterEnabled = r.data.masterEnabled === true;
      window.dailyDevotionFeatureEnabled = r.data.dailyDevotion === true;
      window.groupMeetingPlanFeatureEnabled = r.data.groupMeetingPlan === true;
    }
  } catch (_) { /* 離線 / RPC 未部署：維持 undefined，卡片先不顯示 */ }
}

// 「這個人看不看得到靈修 / 小組聚會」——刻意在 home.js 內自己算一份，不呼叫
// plan.js 的 window.isDevotionalPlanVisibleToUser()：那些函式在 plan.js 裡，而
// plan.js 是背景延遲載入的，剛登入停在首頁時多半還沒載入好，`typeof ... ===
// "function"` 為 false → 卡片永遠找不到計畫。邏輯本身很小且穩定（角色 + 兩個
// 旗標，跟 migration 0156 一致），內聯即可。
function homeCanSeeDevotionGroupFeature(featureKey) {
  if (window.devotionGroupHidden === true) return false; // 政策審核期間：對所有人隱藏（含 admin/pastor）
  const role = typeof getUserRoleCode === "function" ? getUserRoleCode(state.currentUser) : null;
  if (role === "admin" || role === "pastor") return true;
  if (window.devotionGroupFeaturesMasterEnabled !== true) return false;
  return featureKey === "group_meeting_plan"
    ? window.groupMeetingPlanFeatureEnabled === true
    : window.dailyDevotionFeatureEnabled === true;
}

function findVisibleDevotionalPlan() {
  if (!homeCanSeeDevotionGroupFeature("daily_devotion")) return null;
  return (state.globalPlans || []).find(gp =>
    gp && (gp.planKind || gp.plan_kind) === "devotional"
  ) || null;
}

function formatDevotionHomeDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso || "";
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return `${d.getMonth() + 1}/${d.getDate()}（週${weekdays[d.getDay()]}）`;
}

async function refreshDevotionHomeCard() {
  const card = document.getElementById("devotion-home-card");
  const host = document.getElementById("devotion-home-content");
  if (!card || !host) return;

  await ensureDevotionGroupFlagsForHome();
  const plan = findVisibleDevotionalPlan();
  if (!plan) {
    card.classList.add("hidden");
    host.innerHTML = "";
    return;
  }
  // 總開關還沒開 = 功能還沒對會友開放，只有 admin/pastor 看得到（帶提示）
  const isDevMode = window.devotionGroupFeaturesMasterEnabled !== true;

  const requestId = ++devotionHomeCardRequestId;
  const planId = plan.globalPlanId || plan.global_plan_id || plan.id;
  try {
    const res = (typeof db !== "undefined" && typeof db.getDevotionalPlan === "function")
      ? await db.getDevotionalPlan(planId)
      : null;
    if (requestId !== devotionHomeCardRequestId) return; // 已經有更新的請求蓋過去了

    if (!res || !res.success) {
      card.classList.add("hidden");
      host.innerHTML = "";
      return;
    }
    const data = res.data || {};
    const days = Array.isArray(data.days) ? data.days : [];
    const todayRow = days.find(d => d.displayDate === data.today);
    if (!todayRow) {
      // 計畫還沒開始／已經結束當天沒有內容：這種狀態沒什麼好顯示的，直接藏起來。
      card.classList.add("hidden");
      host.innerHTML = "";
      return;
    }

    const dateLabel = formatDevotionHomeDate(todayRow.displayDate);
    const passageLabel = todayRow.passageLabel
      || (Array.isArray(todayRow.passageRefs) ? todayRow.passageRefs.join("、") : "");
    const hasVideo = !!(todayRow.videoUrl && String(todayRow.videoUrl).trim());

    card.classList.remove("hidden");
    host.innerHTML = `
      ${isDevMode ? '<p class="devotion-home-row__dev-hint">開發中・只有你看得到</p>' : ""}
      <div class="devotion-home-row" role="button" tabindex="0" aria-label="進入今日每日靈修">
        <span class="nlc-icon devotion-home-row__icon" data-icon="bookOpen" aria-hidden="true"></span>
        <div class="devotion-home-row__body">
          <p class="devotion-home-row__title">每日靈修・${escapeHTML(dateLabel)}</p>
          <p class="devotion-home-row__passage">${escapeHTML(passageLabel || "今日內容準備中")}</p>
        </div>
        ${hasVideo ? `<span class="devotion-home-row__video-hint"><span class="nlc-icon" data-icon="video" aria-hidden="true"></span>影片</span>` : ""}
        <span class="nlc-icon devotion-home-row__chevron" data-icon="chevronRight" aria-hidden="true"></span>
      </div>`;

    const row = host.querySelector(".devotion-home-row");
    if (row) {
      row.onclick = () => window.openDevotionPlanFromDashboard();
      row.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          window.openDevotionPlanFromDashboard();
        }
      };
    }
    if (typeof hydrateIcons === "function") hydrateIcons(host);
  } catch (e) {
    if (requestId !== devotionHomeCardRequestId) return;
    console.warn("[Home] refreshDevotionHomeCard error:", e);
    card.classList.add("hidden");
    host.innerHTML = "";
  }
}

window.openDevotionPlanFromDashboard = function () {
  const plan = findVisibleDevotionalPlan();
  if (!plan) return;
  // 靈修計畫沒有「加入」，走跟計畫分頁「預覽內容」按鈕同一條路
  // （previewDevotionalPlanAsMember：直接把這份計畫設為 activePlan 並切過去）。
  if (typeof window.resetDevotionViewerDay === "function") window.resetDevotionViewerDay();
  if (typeof window.previewDevotionalPlanAsMember === "function") {
    window.previewDevotionalPlanAsMember(plan.globalPlanId || plan.id);
  }
};

// ── 首頁「小組聚會週計畫」獨立卡片 ──────────────────────────────────────────
// 跟每日靈修卡片同一套邏輯（查 state.globalPlans + 可見性、沒有「加入」概念），
// 只是換成顯示「本週」的信息經文，點進去看整週的信息 / 奉獻經文 / 詩歌。
let groupMeetingHomeCardRequestId = 0;

function findVisibleGroupMeetingPlan() {
  if (!homeCanSeeDevotionGroupFeature("group_meeting_plan")) return null;
  return (state.globalPlans || []).find(gp =>
    gp && (gp.planKind || gp.plan_kind) === "group_meeting"
  ) || null;
}

async function refreshGroupMeetingHomeCard() {
  const card = document.getElementById("group-meeting-home-card");
  const host = document.getElementById("group-meeting-home-content");
  if (!card || !host) return;

  await ensureDevotionGroupFlagsForHome();
  const plan = findVisibleGroupMeetingPlan();
  if (!plan) {
    card.classList.add("hidden");
    host.innerHTML = "";
    return;
  }
  const isDevMode = window.devotionGroupFeaturesMasterEnabled !== true;

  const requestId = ++groupMeetingHomeCardRequestId;
  const planId = plan.globalPlanId || plan.global_plan_id || plan.id;
  try {
    const res = (typeof db !== "undefined" && typeof db.getGroupMeetingPlan === "function")
      ? await db.getGroupMeetingPlan(planId)
      : null;
    if (requestId !== groupMeetingHomeCardRequestId) return;

    if (!res || !res.success) { card.classList.add("hidden"); host.innerHTML = ""; return; }
    const data = res.data || {};
    const weeks = (Array.isArray(data.weeks) ? data.weeks : []).slice().sort((a, b) => a.weekIndex - b.weekIndex);
    if (!weeks.length) { card.classList.add("hidden"); host.innerHTML = ""; return; }

    // 跟 viewer 一致：本週 → 最後一個已過的週 → 第 1 週
    const past = weeks.filter(w => w.isPast);
    const cur = weeks.find(w => w.isThisWeek) || (past.length ? past[past.length - 1] : weeks[0]);
    if (!cur) { card.classList.add("hidden"); host.innerHTML = ""; return; }

    const subtitle = cur.locked
      ? `${cur.dateLabel || "下一週"} 開放`
      : (cur.messagePassageLabel || cur.messageTopic || cur.monthTheme || "本週內容準備中");
    const songCount = Array.isArray(cur.songs) ? cur.songs.length : 0;

    card.classList.remove("hidden");
    host.innerHTML = `
      ${isDevMode ? '<p class="devotion-home-row__dev-hint">開發中・只有你看得到</p>' : ""}
      <div class="devotion-home-row" role="button" tabindex="0" aria-label="進入本週小組聚會計畫">
        <span class="nlc-icon devotion-home-row__icon" data-icon="users" aria-hidden="true"></span>
        <div class="devotion-home-row__body">
          <p class="devotion-home-row__title">小組聚會・${escapeHTML(cur.dateLabel || "本週")}</p>
          <p class="devotion-home-row__passage">${escapeHTML(subtitle)}</p>
        </div>
        ${songCount ? `<span class="devotion-home-row__video-hint">詩歌 ${songCount} 首</span>` : ""}
        <span class="nlc-icon devotion-home-row__chevron" data-icon="chevronRight" aria-hidden="true"></span>
      </div>`;

    const row = host.querySelector(".devotion-home-row");
    if (row) {
      row.onclick = () => window.openGroupMeetingPlanFromDashboard();
      row.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          window.openGroupMeetingPlanFromDashboard();
        }
      };
    }
    if (typeof hydrateIcons === "function") hydrateIcons(host);
  } catch (e) {
    if (requestId !== groupMeetingHomeCardRequestId) return;
    console.warn("[Home] refreshGroupMeetingHomeCard error:", e);
    card.classList.add("hidden");
    host.innerHTML = "";
  }
}

window.openGroupMeetingPlanFromDashboard = function () {
  const plan = findVisibleGroupMeetingPlan();
  if (!plan) return;
  if (typeof window.resetGroupMeetingViewerWeek === "function") window.resetGroupMeetingViewerWeek();
  if (typeof window.previewGroupMeetingPlanAsMember === "function") {
    window.previewGroupMeetingPlanAsMember(plan.globalPlanId || plan.id);
  }
};

window.openActivePlanFromDashboard = function (event) {
  if (typeof window.guardPlanEligibility === "function" && window.guardPlanEligibility()) return;
  if (!state.activePlan) return;
  if (typeof isPlanExpired === "function" && isPlanExpired(state.activePlan)) {
    showToast("此計畫已過期，無法再進入進度閱讀。");
    return;
  }
  state.planDetailOpen = true;
  state.selectedPlanDay = null;
  localStorage.setItem("selected_plan_key", state.activePlan.presetKey || state.activePlan.id || "");
  appRouter.switchTab('plan-view', { keepPlanDetail: true });
};

window.startReadingCurrentChapter = function () {
  if (typeof window.guardPlanEligibility === "function" && window.guardPlanEligibility()) return;
  try {
    if (typeof calculatePlanProgress === "function") {
      calculatePlanProgress();
    }
  } catch (e) {
    console.warn("[Home] calculatePlanProgress error in startReadingCurrentChapter:", e);
  }

  if (state.activePlan && typeof isPlanExpired === "function" && isPlanExpired(state.activePlan)) {
    showToast("此計畫已過期，無法再進入進度閱讀。");
    return;
  }
  if (!state.activePlan) {
    appRouter.switchTab('reader-view');
    return;
  }

  let targetBook = null;
  let targetChapter = 1;
  let targetDayNum = null;
  let targetRound = Number(state.activePlan.currentRound || 1);
  let found = false;

  if (state.activePlan.days) {
    for (const day of state.activePlan.days) {
      const unread = day.chapters.find(ch =>
        Number(ch.round || targetRound) === targetRound &&
        !ch[`isReadR${targetRound}`] &&
        !(targetRound === 1 && ch.isRead)
      );
      if (unread) {
        targetBook = unread.book;
        targetChapter = Number(unread.chapter);
        targetDayNum = day.dayNum;
        found = true;
        break;
      }
    }
  }

  if (!found && Array.isArray(state.activePlan.days)) {
    for (const day of state.activePlan.days) {
      const firstForRound = (day.chapters || []).find(ch => Number(ch.round || targetRound) === targetRound);
      if (!firstForRound) continue;
      targetBook = firstForRound.book;
      targetChapter = Number(firstForRound.chapter);
      targetDayNum = day.dayNum;
      break;
    }
  }

  if (targetBook && typeof BIBLE_BOOKS !== 'undefined') {
    const bookObj = BIBLE_BOOKS.find(b => b.name === targetBook);
    if (bookObj) {
      state.readerState.bookId = bookObj.id;
      state.readerState.chapter = targetChapter;
      state.readerState.fromPlan = true;
      state.readerState.planDayNum = targetDayNum;
      state.readerState.planRound = targetRound;
      state.readerState.planContextId = window.getActivePlanContextId?.(state.activePlan)
        || state.activePlan.id
        || state.activePlan.globalPlanId
        || state.activePlan.presetKey
        || null;

      if (typeof saveReaderPreferences === 'function') {
        saveReaderPreferences();
      } else {
        localStorage.setItem("reader_state", JSON.stringify({
          bookId: state.readerState.bookId,
          chapter: state.readerState.chapter
        }));
      }
    }
  }

  state.readerState.returnTab = "dashboard-view";
  appRouter.switchTab('reader-view', { fromPlan: true });
};

async function fetchPastoralVerseWall() {
  const container = document.getElementById("home-verse-wall");
  if (!container) return;

  const todayStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');

  if (!pastoralSharingWallEnabled) return;
  const isHistory = (sharingController.tab === "history");
  const historyFilter = sharingController.filter;
  const historyFilterWrapper = document.getElementById("wall-history-filter-wrapper");

  if (isHistory) {
    historyFilterWrapper?.classList.remove("hidden");
  } else {
    historyFilterWrapper?.classList.add("hidden");
  }

  if (state.isSupabaseMode && state.supabase) {
    try {
      const user = await db.getCurrentDbUser();
      const pastoralZone = (state.currentUser && state.currentUser.pastoral_zone) || "";
      // 沒有 pastoralZone 時（帳號還沒設牧區）不能只查一頁——那等於查全教會，
      // 沒分頁的話超過 PostgREST 預設 1000 列上限就會悄悄漏掉後面的人。
      const { data: profiles, error: pError } = await db.fetchAllRows(() => {
        let q = state.supabase.from("profiles").select("id, name, small_group");
        if (pastoralZone) q = q.eq("pastoral_zone", pastoralZone);
        return q;
      });

      if (pError) throw pError;
      if (!profiles || profiles.length === 0) {
        container.innerHTML = `<div class="text-xs text-center py-6" style="color: var(--text-muted);">尚無同工在該牧區</div>`;
        return;
      }

      const userIds = profiles.map(p => p.id);

      let notesQuery = state.supabase
        .from("devotional_notes")
        .select("id, user_id, content, created_at, note_date");

      if (isHistory) {
        if (historyFilter === "mine" && user) {
          notesQuery = notesQuery.eq("user_id", user.id);
        } else {
          notesQuery = notesQuery.in("user_id", userIds);
        }
        notesQuery = notesQuery.order("created_at", { ascending: false }).limit(50);
      } else {
        // 跟上面歷史分頁同樣加 limit(50)：這是一面牆的展示用途，不是統計數字，
        // 沒有必要（也不該）把全教會今天貼的心得全部抓下來。
        notesQuery = notesQuery.eq("note_date", todayStr).in("user_id", userIds).order("created_at", { ascending: false }).limit(50);
      }

      const { data: notes, error: nError } = await notesQuery;
      if (nError) throw nError;

      const activeNotes = (notes || []).filter(n => n.content && n.content.trim().length > 0);

      if (activeNotes.length === 0) {
        const noNotesMsg = isHistory
          ? (historyFilter === "mine" ? "您目前尚無過去分享的心得喔！" : "此小組/牧區尚無歷史分享心得喔！")
          : "今天還沒有人分享金句喔，快來分享吧！";
        container.innerHTML = `<div class="text-xs text-center py-6" style="color: var(--text-muted);">${noNotesMsg}</div>`;
        return;
      }

      const noteIds = activeNotes.map(n => n.id);
      // 這兩個沒有天然上限——熱門心得的讚/留言數不會被 noteIds 的數量限制住，
      // 一樣要分頁抓，不然愛心數字會算錯、留言串底部（最新的留言）會憑空消失。
      const { data: likes } = await db.fetchAllRows(() => state.supabase
        .from("devotional_likes")
        .select("note_id, user_id")
        .in("note_id", noteIds));

      const { data: comments } = await db.fetchAllRows(() => state.supabase
        .from("devotional_comments")
        .select("id, note_id, user_id, content, created_at")
        .in("note_id", noteIds)
        .order("created_at", { ascending: true }));

      const profileMap = {};
      profiles.forEach(p => {
        profileMap[p.id] = p;
      });

      renderVerseWallCards(activeNotes, profileMap, likes || [], comments || [], isHistory);
    } catch (err) {
      console.error("Failed to load pastoral sharing wall:", err);
      container.innerHTML = `<div class="text-xs text-danger text-center py-6">載入分享牆失敗</div>`;
    }
  } else {
    const defaultMock = [
      { id: "offline_note1", user_id: "offline1", content: "主是我的力量，我的盾牌；我心裡倚靠他就得幫助。 (詩 28:7)", created_at: new Date(Date.now() - 3600000).toISOString() },
      { id: "offline_note2", user_id: "offline2", content: "你要保守你心，勝過保守一切，因為一生的果效是由心發出。 (箴 4:23)", created_at: new Date(Date.now() - 7200000).toISOString() },
      { id: "offline_note3", user_id: "offline1", content: "敬畏耶和華是智慧的開端；認識至聖者便是聰明。 (箴 9:10)", created_at: new Date(Date.now() - 86400000 * 2).toISOString() },
      { id: "offline_note4", user_id: "me", content: "我將你的話藏在心裡，免得我得罪你。 (詩 119:11)", created_at: new Date(Date.now() - 86400000).toISOString() }
    ];

    const localNotesStr = localStorage.getItem("devotional_notes") || "[]";
    let localNotes = [];
    try {
      localNotes = JSON.parse(localNotesStr);
      if (!Array.isArray(localNotes)) localNotes = [];
    } catch (e) { }

    const mockNotes = [...localNotes, ...defaultMock];

    const mockProfileMap = {
      "offline1": { name: "張弟兄", small_group: "馬鈴薯組" },
      "offline2": { name: "李姊妹", small_group: "喜樂組" },
      "me": { name: (state.currentUser && state.currentUser.name) || "我", small_group: (state.currentUser && state.currentUser.small_group) || "" }
    };

    let processedMock = mockNotes.map(n => {
      const datePart = n.created_at ? n.created_at.slice(0, 10) : todayStr;
      return { ...n, note_date: datePart };
    });

    let filteredNotes = processedMock;
    if (isHistory) {
      if (historyFilter === "mine") {
        const myId = (state.currentUser && state.currentUser.id) || "me";
        filteredNotes = processedMock.filter(n => n.user_id === "me" || n.user_id === myId);
      }
      filteredNotes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      filteredNotes = filteredNotes.slice(0, 50);
    } else {
      filteredNotes = processedMock.filter(n => n.note_date === todayStr);
    }

    if (filteredNotes.length === 0) {
      const noNotesMsg = isHistory ? "無符合歷史心得" : "今天還沒有人分享金句喔，快來分享吧！";
      container.innerHTML = `<div class="text-xs text-center py-6" style="color: var(--text-muted);">${noNotesMsg}</div>`;
      return;
    }

    const likesList = [];
    const commentsList = [];
    filteredNotes.forEach(n => {
      const likedKey = `like_${n.id}`;
      if (localStorage.getItem(likedKey) === "true") {
        likesList.push({ note_id: n.id, user_id: "me" });
      }
      const commentsKey = `comments_${n.id}`;
      const localComms = JSON.parse(localStorage.getItem(commentsKey) || "[]");
      commentsList.push(...localComms);
    });

    renderVerseWallCards(filteredNotes, mockProfileMap, likesList, commentsList, isHistory);
  }
}

function renderCommentsTree(commentNodes, noteOwnerId, profileMap, depth = 0) {
  let html = "";
  
  // 依時間先後排序留言
  commentNodes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  
  commentNodes.forEach(c => {
    const commProfile = profileMap[c.user_id] || { name: "" };
    const commName = String(commProfile.name || "").trim() || "—";
    const isOp = c.user_id === noteOwnerId;
    
    // 巢狀縮排線與樣式
    const paddingLeftClass = depth > 0
      ? "pl-4 border-l-2 ml-2"
      : "";
    const nestingBorderStyle = depth > 0 ? "border-color: var(--border-card);" : "";
      
    // 遞迴渲染子留言
    const repliesHtml = c.replies && c.replies.length > 0 
      ? renderCommentsTree(c.replies, noteOwnerId, profileMap, depth + 1)
      : "";
      
    // 動態產生精美的 Dicebear 頭像
    const commAvatarUrl = `https://api.dicebear.com/8.x/lorelei/svg?seed=${encodeURIComponent(commName)}`;
      
    html += `
      <div class="comment-node mb-3.5 ${paddingLeftClass}" style="${nestingBorderStyle}">
        <div class="p-3 rounded-lg border transition-all duration-200 hover:bg-white/[0.01]" style="background: color-mix(in srgb, var(--text-primary) 1%, var(--bg-card)); border-color: var(--border-card);">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center space-x-2">
              <img src="${commAvatarUrl}" alt="${escapeHTML(commName)}" class="w-5.5 h-5.5 rounded-full border border-white/10" style="width: 22px; height: 22px; background-color: var(--color-brand-subtle);" />
              <div class="flex flex-col">
                <div class="flex items-center space-x-1.5">
                  <span style="font-weight: var(--type-weight-strong); color: var(--text-primary); font-size: 0.875rem;">${escapeHTML(commName)}</span>
                  ${isOp ? `<span class="privacy-badge stat-badge stat-badge--success text-[8px]" style="padding: 1px 4px; font-size: 0.875rem; line-height: 1; border-radius: 9999px;">OP</span>` : ""}
                </div>
              </div>
            </div>
            <span style="color: var(--text-muted); font-size: 0.875rem;">${new Date(c.created_at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <p style="margin: 0 0 0.5rem 0; color: var(--text-secondary); font-size: 0.875rem; line-height: 1.4; white-space: pre-wrap; padding-left: 2px;">${escapeHTML(c.content)}</p>
          
          <div class="flex items-center space-x-3 text-[10px]" style="padding-left: 2px;">
            <button type="button" class="flex items-center space-x-1 hover:text-brand transition-colors bg-transparent border-0 cursor-pointer p-0" style="font-size: 0.875rem; font-weight: 500; color: var(--text-muted);" onclick="window.showReplyInputBox('${c.id}')">
              <span class="nlc-icon nlc-icon--inline" data-icon="inbox" style="opacity: 0.8; margin-right: 2px;"></span>
              <span>回覆</span>
            </button>
          </div>
          
          <!-- 巢狀回覆輸入框 -->
          <div id="reply-input-box-${c.id}" class="hidden mt-3 pt-3 border-t border-dashed" style="border-color: var(--border-card);">
            <div class="flex items-center space-x-2">
              <input type="text" id="reply-input-${c.id}" placeholder="回覆 ${escapeHTML(commName)}..." class="form-control" style="padding: 0.35rem 1rem; border-radius: 9999px; flex: 1;">
              <button type="button" class="primary-btn" style="padding: 0.35rem 0.85rem; font-size: 0.875rem; border-radius: 9999px !important; white-space: nowrap; font-weight: 600;" onclick="window.submitDevotionalReply('${c.note_id}', '${c.id}')">發送</button>
              <button type="button" class="secondary-btn" style="padding: 0.35rem 0.85rem; font-size: 0.875rem; border-radius: 9999px !important; white-space: nowrap;" onclick="window.hideReplyInputBox('${c.id}')">取消</button>
            </div>
          </div>
        </div>
        ${repliesHtml ? `<div class="replies-container mt-2.5">${repliesHtml}</div>` : ""}
      </div>
    `;
  });
  
  return html;
}

function renderVerseWallCards(notes, profileMap, likes, comments, isHistory = false) {
  const container = document.getElementById("home-verse-wall");
  if (!container) return;

  container.innerHTML = "";
  const currentUserId = state.currentUser ? state.currentUser.id : null;
  window.expandedNoteIds = window.expandedNoteIds || new Set();

  notes.forEach(note => {
    const profile = profileMap[note.user_id] || { name: "", small_group: "" };
    const initial = profile.name ? profile.name.charAt(0) : "·";

    // Flat per-name accent tints (avatar background/text) — rewritten
    // 2026-09-16: was a `bg-gradient-to-br` of two raw Tailwind palette
    // shades (a "no gradient fills on UI chrome" violation on its own) whose
    // dark: variant only worked once Tailwind's darkMode was wired to the
    // app's own theme class, and had no warm-theme handling at all. Colors
    // now come from the --avatar-accent-* tokens in index.css (not raw hex
    // here — see color-audit.test.mjs) mixed against the current theme's
    // card surface so the background still adapts across themes.
    const colors = [1, 2, 3, 4, 5].map(n => ({
      bg: `color-mix(in srgb, var(--avatar-accent-${n}) 16%, var(--bg-card))`,
      fg: `var(--avatar-accent-${n}-fg)`
    }));
    const charCode = profile.name ? profile.name.charCodeAt(0) : 0;
    const avatarColor = colors[charCode % colors.length];

    let timeStr = "剛剛";
    if (note.created_at) {
      try {
        const noteDate = new Date(note.created_at);
        const todayDateStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
        const noteDateStr = noteDate.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');

        if (isHistory || noteDateStr !== todayDateStr) {
          const y = noteDate.getFullYear();
          const m = String(noteDate.getMonth() + 1).padStart(2, '0');
          const d = String(noteDate.getDate()).padStart(2, '0');
          const hr = String(noteDate.getHours()).padStart(2, '0');
          const min = String(noteDate.getMinutes()).padStart(2, '0');
          timeStr = `${y}-${m}-${d} ${hr}:${min}`;
        } else {
          const diffMs = new Date() - noteDate;
          const diffMins = Math.floor(diffMs / 60000);
          if (diffMins < 1) {
            timeStr = "剛剛";
          } else if (diffMins < 60) {
            timeStr = `${diffMins} 分鐘前`;
          } else {
            timeStr = noteDate.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
          }
        }
      } catch (e) { }
    }

    const noteLikes = likes.filter(l => l.note_id === note.id);
    const noteComments = comments.filter(c => c.note_id === note.id);
    const hasLiked = currentUserId && noteLikes.some(l => l.user_id === currentUserId);

    // 💡 關鍵升級：建立巢狀留言樹狀結構
    const commentMap = {};
    const rootComments = [];

    noteComments.forEach(c => {
      let parentId = null;
      let text = c.content;
      if (c.content && c.content.startsWith("{")) {
        try {
          const obj = JSON.parse(c.content);
          if (obj && typeof obj.text === "string") {
            parentId = obj.parent_id;
            text = obj.text;
          }
        } catch (e) { }
      }

      commentMap[c.id] = {
        id: c.id,
        note_id: c.note_id,
        user_id: c.user_id,
        created_at: c.created_at,
        content: text,
        parent_id: parentId,
        replies: []
      };
    });

    noteComments.forEach(c => {
      const node = commentMap[c.id];
      if (node) {
        if (node.parent_id && commentMap[node.parent_id]) {
          commentMap[node.parent_id].replies.push(node);
        } else {
          rootComments.push(node);
        }
      }
    });

    const commentsHtml = rootComments.length > 0
      ? renderCommentsTree(rootComments, note.user_id, profileMap, 0)
      : "";

    const isExpanded = window.expandedNoteIds.has(note.id);

    const card = document.createElement("div");
    card.className = "devotional-post-card transition-all duration-200 shadow-sm";
    card.style.background = "var(--bg-card)";
    card.style.border = "1px solid var(--border-card)";
    card.style.borderRadius = "12px";
    card.style.padding = "1rem";
    card.style.marginBottom = "1rem";

    card.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center space-x-3">
          <div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-inner" style="background: ${avatarColor.bg}; color: ${avatarColor.fg};">
            ${escapeHTML(initial)}
          </div>
          <div class="flex flex-col">
            <span class="text-xs font-medium" style="color: var(--text-primary);">${escapeHTML(String(profile.name || "").trim() || "—")}</span>
            <span class="text-[10px]" style="color: var(--text-muted);">${escapeHTML(String(profile.small_group || "").trim() || "—")}</span>
          </div>
        </div>
        <div class="flex items-center space-x-2">
          <span class="text-[10px]" style="color: var(--text-muted);">${timeStr}</span>
          ${note.user_id === currentUserId ? `
            <div class="relative inline-block" style="position: relative;">
              <button type="button" class="flex items-center justify-center p-1 rounded-full hover:bg-white/10 dark:hover:bg-white/5 transition-colors border-0 bg-transparent cursor-pointer" onclick="event.stopPropagation(); window.toggleDevotionalOptions('${note.id}')" style="color: var(--text-muted); height: 24px; width: 24px;">
                <span class="nlc-icon nlc-icon--sm" data-icon="threeDots" style="width: 16px; height: 16px;"></span>
              </button>
              <div id="devotional-options-${note.id}" class="hidden" style="position: absolute; right: 0; top: 28px; background: var(--bg-card); border: 1px solid var(--border-card); border-radius: var(--radius-sm); width: 100px; box-shadow: var(--shadow-lg); z-index: 99; display: flex; flex-direction: column; overflow: hidden; padding: 4px 0;">
                <button type="button" class="options-dropdown-item danger-item" onclick="event.stopPropagation(); window.deleteDevotionalNote('${note.id}')" style="padding: 0.5rem 0.75rem; font-size: 0.875rem; font-weight: var(--type-weight-strong); border: 0; background: transparent; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 0.35rem; color: var(--color-danger); width: 100%;">
                  <span class="nlc-icon nlc-icon--sm" data-icon="trash" style="width: 12px; height: 12px;"></span>
                  <span>刪除</span>
                </button>
              </div>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="my-3 pl-3" style="border-left: 2px solid var(--color-brand); margin: 0.75rem 0;">
        <p style="font-size: 0.875rem; line-height: 1.5; color: var(--text-primary); margin: 0; font-weight: var(--type-weight-regular);">
          ${escapeHTML(note.content)}
        </p>
      </div>

      <div class="flex items-center justify-start space-x-6 mt-3 pt-2" style="border-top: 1px solid var(--border-card); color: var(--text-secondary);">
        <button type="button" class="flex items-center space-x-1.5 hover:opacity-80 transition-opacity bg-transparent border-0 cursor-pointer p-0 text-xs" style="color: ${hasLiked ? 'var(--color-danger)' : 'var(--text-secondary)'}; font-weight: var(--type-weight-strong);" onclick="window.toggleDevotionalLike('${note.id}')">
          <span class="nlc-icon nlc-icon--sm" data-icon="${hasLiked ? 'heartFill' : 'heart'}" style="width: 15px; height: 15px;"></span>
          <span>${noteLikes.length > 0 ? noteLikes.length + ' ' : ''}讚</span>
        </button>
        <button type="button" class="flex items-center space-x-1.5 hover:opacity-80 transition-opacity bg-transparent border-0 cursor-pointer p-0 text-xs" style="color: var(--text-secondary); font-weight: var(--type-weight-strong);" onclick="window.toggleCommentsSection('${note.id}')">
          <span class="nlc-icon nlc-icon--sm" data-icon="inbox" style="width: 15px; height: 15px;"></span>
          <span>${noteComments.length > 0 ? noteComments.length + ' ' : ''}回覆</span>
        </button>
      </div>

      <div id="comments-section-${note.id}" class="${isExpanded ? '' : 'hidden'} mt-3 pt-3" style="border-top: 1px solid var(--border-card);">
        <div id="comments-list-${note.id}" class="space-y-2 mb-2">
          ${commentsHtml || '<div class="text-[10px] text-center py-2" style="color: var(--text-muted);">沒有留言</div>'}
        </div>

        <div id="comment-input-container-${note.id}" class="flex items-center space-x-2 mt-2 pt-2" style="border-top: 1px dashed var(--border-card);">
          <input type="text" id="comment-input-${note.id}" placeholder="寫下你的回覆..." class="form-control" style="padding: 0.4rem 1.1rem; border-radius: 9999px; flex: 1;">
          <button type="button" class="primary-btn" style="padding: 0.4rem 1rem; font-size: 0.875rem; border-radius: 9999px !important; white-space: nowrap; font-weight: 600;" onclick="window.submitDevotionalComment('${note.id}')">發送</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  if (typeof hydrateIcons === "function") {
    hydrateIcons(container);
  }
}

window.toggleDevotionalLike = async function (noteId) {
  try {
    await db.toggleDevotionalLike(noteId);
    await fetchPastoralVerseWall();
  } catch (err) {
    console.error("Failed to toggle like:", err);
  }
};

window.toggleCommentsSection = function (noteId) {
  const el = document.getElementById(`comments-section-${noteId}`);
  if (el) {
    el.classList.toggle("hidden");
    window.expandedNoteIds = window.expandedNoteIds || new Set();
    if (el.classList.contains("hidden")) {
      window.expandedNoteIds.delete(noteId);
    } else {
      window.expandedNoteIds.add(noteId);
    }
  }
};

window.toggleCommentInput = function (noteId) {
  const sec = document.getElementById(`comments-section-${noteId}`);
  if (sec && sec.classList.contains("hidden")) {
    sec.classList.remove("hidden");
    window.expandedNoteIds = window.expandedNoteIds || new Set();
    window.expandedNoteIds.add(noteId);
  }
  const el = document.getElementById(`comment-input-container-${noteId}`);
  if (el) {
    el.classList.toggle("hidden");
    if (!el.classList.contains("hidden")) {
      const inp = document.getElementById(`comment-input-${noteId}`);
      if (inp) inp.focus();
    }
  }
};

window.showReplyInputBox = function (commentId) {
  const el = document.getElementById(`reply-input-box-${commentId}`);
  if (el) {
    el.classList.remove("hidden");
    const input = document.getElementById(`reply-input-${commentId}`);
    if (input) input.focus();
  }
};

window.hideReplyInputBox = function (commentId) {
  const el = document.getElementById(`reply-input-box-${commentId}`);
  if (el) {
    el.classList.add("hidden");
    const input = document.getElementById(`reply-input-${commentId}`);
    if (input) input.value = "";
  }
};

window.submitDevotionalReply = async function (noteId, parentCommentId) {
  const input = document.getElementById(`reply-input-${parentCommentId}`);
  if (!input) return;
  const content = input.value.trim();
  if (!content) return;

  const payload = JSON.stringify({ parent_id: parentCommentId, text: content });

  try {
    await db.addDevotionalComment(noteId, payload);
    input.value = "";

    window.expandedNoteIds = window.expandedNoteIds || new Set();
    window.expandedNoteIds.add(noteId);

    await fetchPastoralVerseWall();
  } catch (err) {
    console.error("Failed to add reply comment:", err);
    alert("發送回覆失敗，請稍後再試");
  }
};

window.submitDevotionalComment = async function (noteId) {
  const input = document.getElementById(`comment-input-${noteId}`);
  if (!input) return;
  const content = input.value.trim();
  if (!content) return;

  const payload = JSON.stringify({ parent_id: null, text: content });

  try {
    await db.addDevotionalComment(noteId, payload);
    input.value = "";

    window.expandedNoteIds = window.expandedNoteIds || new Set();
    window.expandedNoteIds.add(noteId);

    await fetchPastoralVerseWall();
  } catch (err) {
    console.error("Failed to add comment:", err);
    alert("發送回覆失敗，請稍後再試");
  }
};

window.toggleDevotionalOptions = function (noteId) {
  const dropdowns = document.querySelectorAll('[id^="devotional-options-"]');
  dropdowns.forEach(d => {
    if (d.id !== `devotional-options-${noteId}`) {
      d.classList.add("hidden");
    }
  });

  const dropdown = document.getElementById(`devotional-options-${noteId}`);
  if (dropdown) {
    dropdown.classList.toggle("hidden");
  }
};

window.deleteDevotionalNote = async function (noteId) {
  const confirmed = await window.showConfirmDialog({
    title: "確定要刪除此則靈修分享嗎？",
    message: "刪除後此條靈修紀錄將不再對其他人公開。",
    confirmText: "確認刪除",
    cancelText: "取消",
    isDestructive: true
  });
  if (!confirmed) return;

  try {
    await db.deleteDevotionalNote(noteId);
    if (typeof fetchPastoralVerseWall === "function") {
      fetchPastoralVerseWall();
    }
    showToast("已成功刪除");
  } catch (err) {
    console.error("Failed to delete devotional note:", err);
    showToast("刪除失敗");
  }
};

document.addEventListener("click", () => {
  const dropdowns = document.querySelectorAll('[id^="devotional-options-"]');
  dropdowns.forEach(d => d.classList.add("hidden"));
});

window.changeVerseCardBackground = function () {
  const randomImgUrl = CURATED_IMAGE_POOL[Math.floor(Math.random() * CURATED_IMAGE_POOL.length)];
  localStorage.setItem("verse_card_bg", randomImgUrl);

  if (currentVerse) {
    currentVerse.imageUrl = randomImgUrl;
  }

  const bgImgEl = document.getElementById("card-bg");
  if (bgImgEl) {
    bgImgEl.src = randomImgUrl;
    bgImgEl.style.opacity = "1";
  }

  // ── Broadcast background change so any tab can react ──
  window.dispatchEvent(new CustomEvent("app:bgChanged", { detail: { url: randomImgUrl } }));

  showToast("已成功更換背景");
};

// 8/30 速讀測驗宣示彈窗。測驗入口本身尚未開放（等 8/30 才會接上真正的測驗
// 流程），目前點擊只會顯示規則，姓名代入第6條空格，讓每個人看到的是自己
// 要簽署的版本，不需要手動輸入。
function openQuizPledgeModal() {
  const nameEl = document.getElementById("quiz-pledge-name");
  if (nameEl) {
    const name = (typeof getDisplayName === "function" ? getDisplayName(state.currentUser) : null)
      || state.currentUser?.name
      || "（您的姓名）";
    nameEl.textContent = name;
  }
  const modal = document.getElementById("quiz-pledge-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  if (typeof hydrateIcons === "function") hydrateIcons(modal);
}

function closeQuizPledgeModal() {
  const modal = document.getElementById("quiz-pledge-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function bindQuizPledgeBanner() {
  const btn = document.getElementById("btn-open-quiz-pledge");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "true";
    btn.addEventListener("click", openQuizPledgeModal);
  }
}

let examHomeCountdownTimer = null;

function stopExamHomeCountdown() {
  if (examHomeCountdownTimer) { clearInterval(examHomeCountdownTimer); examHomeCountdownTimer = null; }
}

// 把毫秒差轉成「2 天 3 小時 4 分 5 秒」（0 的高位單位省略）
function formatCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d} 天`);
  if (d || h) parts.push(`${h} 小時`);
  if (d || h || m) parts.push(`${m} 分`);
  parts.push(`${sec} 秒`);
  return parts.join(" ");
}

function getExamHomeCardState(d, serverNow) {
  const openTs = Date.parse(d.openAt) || 0;
  const closeTs = Date.parse(d.closeAt) || 0;
  const my = d.myAttemptStatus || null;
  let badge = "即將開放", badgeKind = "warning", note = d.body || "", action = null, practiceAction = null;
  let countdownTo = 0;
  if (d.resultReady) {
    badge = "已公布成績"; badgeKind = "success";
    note = d.myTotalScore != null ? `你的總分：${d.myTotalScore} 分` : "成績已公布。";
    action = { kind: "result", label: "查看成績" };
  } else if (my === "submitted" || my === "graded") {
    // 批改中（已截止、成績還沒公布）跟作答中已交卷分開說：前者讓人知道成績公布後會通知（#298）
    const grading = d.status === "closed" || (closeTs && serverNow > closeTs);
    badge = grading ? "批改中" : "已完成作答"; badgeKind = "brand";
    note = grading ? "已完成作答，成績公布後會通知你。" : "正式答案已鎖定；現在可查看自己的填答內容。";
    action = { kind: "review", label: "查看我的作答" };
  } else if (my === "in_progress") {
    badge = "作答中"; badgeKind = "brand";
    note = "你有一份未完成的測驗，計時仍在進行。";
    action = { kind: "resume", label: "繼續作答" };
  } else if (d.status === "closed" || (closeTs && serverNow > closeTs)) {
    badge = "已收卷"; badgeKind = "neutral"; note = "本次測驗已經結束。";
  } else if (d.canEnter === true) {
    badge = "開放中"; badgeKind = "success";
    action = { kind: "enter", label: d.ctaLabel || "進入測驗" };
  } else {
    action = { kind: "pledge", label: "測驗宣示" };
    if (openTs && serverNow < openTs) countdownTo = openTs;
  }
  if (d.practiceAttemptStatus === "in_progress") practiceAction = { label: "繼續複習" };
  else if (d.canPractice) practiceAction = { label: "題目回顧" };
  else if (d.practiceReviewReady) practiceAction = { label: "查看複習紀錄" };
  return { badge, badgeKind, note, action, practiceAction, countdownTo };
}

// 首頁「速讀大測驗」置頂區塊：同時呈現所有已排程的試卷（排程後就出現，#298），每卷狀態完全獨立。
async function refreshExamHomeBanner() {
  const card = document.getElementById("quiz-announcement-banner");
  const host = document.getElementById("exam-home-banner");
  if (!card || !host) return;
  stopExamHomeCountdown();

  let exams = [];
  try {
    if (typeof db !== "undefined" && typeof db.getExamHomeExams === "function") {
      const res = await db.getExamHomeExams();
      exams = Array.isArray(res?.data) ? res.data : [];
      if (res?.error && typeof db.getExamHomeBanner === "function") {
        const legacy = await db.getExamHomeBanner();
        exams = legacy?.data?.paperId ? [legacy.data] : [];
      }
    } else if (typeof db !== "undefined" && typeof db.getExamHomeBanner === "function") {
      const res = await db.getExamHomeBanner();
      exams = res?.data?.paperId ? [res.data] : [];
    }
  } catch (_) { exams = []; }

  exams = exams.filter(item => item?.paperId);
  if (!exams.length) { card.classList.add("hidden"); host.innerHTML = ""; return; }

  host.innerHTML = exams.map(d => {
    const nowServer = Date.parse(d.serverNow) || Date.now();
    const state = getExamHomeCardState(d, nowServer);
    return `<article class="exam-home-banner__item" data-exam-paper-id="${escapeHTML(d.paperId)}" data-server-skew="${nowServer - Date.now()}" data-countdown-to="${state.countdownTo || 0}">
      <span class="nlc-icon nlc-icon--hero exam-home-banner__icon" data-icon="megaphone" aria-hidden="true"></span>
      <div class="exam-home-banner__main">
        <div class="exam-home-banner__head">
          <h3 class="card-title exam-home-banner__title">${escapeHTML(d.headline || d.title || "速讀大測驗")}</h3>
          <span class="stat-badge stat-badge--${state.badgeKind}">${escapeHTML(state.badge)}</span>
        </div>
        ${state.note ? `<p class="exam-home-banner__note">${escapeHTML(state.note)}</p>` : ""}
        ${state.countdownTo ? `<p class="exam-home-banner__countdown">距離開放還有 <strong data-exam-countdown>${escapeHTML(formatCountdown(state.countdownTo - nowServer))}</strong></p>` : ""}
      </div>
      <div class="exam-home-banner__actions">
        ${state.action ? `<button type="button" class="primary-btn exam-home-banner__btn" data-exam-primary="${escapeHTML(state.action.kind)}">${escapeHTML(state.action.label)}</button>` : ""}
        ${state.practiceAction ? `<button type="button" class="secondary-btn exam-home-banner__btn" data-exam-practice>${escapeHTML(state.practiceAction.label)}</button>` : ""}
      </div>
    </article>`;
  }).join("");

  card.classList.remove("hidden");
  if (typeof hydrateIcons === "function") hydrateIcons(host);
  host.querySelectorAll("[data-exam-paper-id]").forEach(item => {
    const paperId = item.dataset.examPaperId;
    const go = practice => {
      const url = `exam.html?paper=${encodeURIComponent(paperId)}${practice ? "&attempt=practice" : ""}&return=${encodeURIComponent(location.pathname + location.search)}`;
      try { location.assign(url); } catch (_) { location.href = url; }
    };
    item.querySelector("[data-exam-primary]")?.addEventListener("click", event => {
      if (event.currentTarget.dataset.examPrimary === "pledge") openQuizPledgeModal(); else go(false);
    });
    item.querySelector("[data-exam-practice]")?.addEventListener("click", () => go(true));
  });
  if (host.querySelector("[data-exam-countdown]")) {
    examHomeCountdownTimer = setInterval(() => {
      let expired = false;
      host.querySelectorAll("[data-exam-countdown]").forEach(el => {
        const item = el.closest("[data-exam-paper-id]");
        const left = Number(item?.dataset.countdownTo || 0) - (Date.now() + Number(item?.dataset.serverSkew || 0));
        if (left <= 0) expired = true; else el.textContent = formatCountdown(left);
      });
      if (expired) { stopExamHomeCountdown(); refreshExamHomeBanner(); }
    }, 1000);
  }
}

window.openQuizPledgeModal = openQuizPledgeModal;
window.closeQuizPledgeModal = closeQuizPledgeModal;
window.refreshExamHomeBanner = refreshExamHomeBanner;

export function init() {
  initDevotionalControls();
  bindQuizPledgeBanner();

  // ── Subscribe to unified theme change event ──
  window.addEventListener("app:themeChanged", () => {
    // Re-render badge strips when theme changes (they use CSS-dependent colors)

  });

  // ── Subscribe to background change event (from profile tab or any other source) ──
  window.addEventListener("app:bgChanged", (e) => {
    const url = e.detail && e.detail.url;
    if (!url) return;
    const bgImgEl = document.getElementById("card-bg");
    if (bgImgEl) {
      bgImgEl.src = url;
      bgImgEl.style.opacity = "1";
    }
  });

  // ── Subscribe to cross-tab data refresh ──
  // When plan data changes, update the dashboard summary if it is currently visible.
  window.addEventListener("app:dataRefresh", (e) => {
    const scope = e.detail && e.detail.scope;
    if (scope === "plan" || scope === "all") {
      if (typeof updateDashboardView === "function") {
        updateDashboardView();
      }
    }
  });
}

window.updateDashboardView = updateDashboardView;
window.fetchPastoralVerseWall = fetchPastoralVerseWall;
window.initDevotionalControls = init;
window.changeVerseCardBackground = changeVerseCardBackground;

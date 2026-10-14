export function randomEventOptionsForState(state = {}) {
  const themeText = [
    state.project?.title,
    state.town?.name,
    state.town?.summary,
    state.worldSetup?.sourcePrompts?.world,
    ...(state.locations || []).map((location) => location.name),
  ].filter(Boolean).join(" ");

  if (/停剑|仙侠|修真|修仙|灵契|妖丹|照骨|归墟/.test(themeText)) {
    return [
      "四方法契门的界石忽然响起，显示有人用别人的灵契入城。",
      "无咎市的妖丹盒在拍卖前裂开，里面滚出一枚正道封印。",
      "照骨司的魂灯供词当庭翻供，指向一个没有到场的人。",
      "万灵医坊的庇护牌被抢走，伤者袖口露出血河楼暗纹。",
      "归墟渡的渡令同时失效，追捕者和逃亡者都被水阵困在岸边。",
      "停剑茶楼的停剑令被人按进茶盏，正邪两桌同时拔剑又停住。",
    ];
  }

  if (/取经|西游|山门|妖洞|通关文牒/.test(themeText)) {
    return [
      "山门前有人求救，通关文牒却被守门人扣住。",
      "密林里行李担忽然落地，树影里有人换了一张脸。",
      "妖洞厅摆出酒席，座位却少了一张。",
      "破寺院夜钟响起，紧箍咒的尾音被火光截断。",
    ];
  }

  if (/三国|军帐|城门|粮仓|虎符/.test(themeText)) {
    return [
      "中军帐里虎符被推到地图边，盟书上多出一枚陌生印记。",
      "城门迟迟不开，旧臣跪在箭簇旁要求献城。",
      "粮仓火把靠近木门，欠粮名单忽然被人藏起。",
    ];
  }

  if (/教父|家族|书房|街角|戒指/.test(themeText)) {
    return [
      "书房电话响起，门外的人突然不再说话。",
      "家族餐桌空出一个座位，酒杯却已经被倒满。",
      "街角车灯熄灭，花束落在车门旁。",
    ];
  }

  if (/变形|萨姆沙|格里高尔|公寓|账本/.test(themeText)) {
    return [
      "公司书记员提前来到公寓门口，要求立刻解释缺勤。",
      "格蕾特的小提琴练习被账本翻页声打断。",
      "父亲从柜子里翻出旧制服，又把它挂了回去。",
      "母亲替格里高尔解释身体不舒服，却没有碰账本。",
      "未来可出租的空房间被提前擦亮，餐巾叠得过分整齐。",
      "房门钥匙卡住了，门内和门外都听见彼此的停顿。",
      "家庭账本摊在餐桌上，债务数额第一次被说出口。",
      "街口电车准点驶过，格里高尔的样品箱仍留在地板上。",
      "公司柜台传来电话，询问为什么早班车上没有格里高尔。",
      "格蕾特把小提琴盒扣上，说自己还可以等。",
    ];
  }

  return [
    "入口处的登记物件被人拿走，旁边的人同时停住。",
    "桌上的凭证被推到光里，两个阵营都不肯先伸手。",
    "街口有人喊出一个旧名字，另一边的门立刻关上。",
    "一个临时庇护请求被送到公共场所，所有人都必须表态。",
  ];
}

export function pickRandomInjectedEvent(state = {}, random = Math.random) {
  const options = randomEventOptionsForState(state);
  return options[Math.floor(random() * options.length)] || options[0] || "";
}

// 图片处理页的猫咪科普短句：只调用服务端，不在小程序端保存 Hy3 凭证。

const CLOUD_FUNCTION_NAME = 'cat-knowledge';

const FALLBACK_KNOWLEDGE = [
  '猫咪的胡须根部有丰富的感觉神经，能帮助它感知周围空间。',
  '猫咪的耳朵可以独立转动，帮助它判断声音来自哪个方向。',
  '猫咪的瞳孔会随光线变化，明亮处变细，昏暗处变圆。',
  '猫咪会用舔舐整理毛发，也会借此留下熟悉的气味。',
  '猫咪睡眠时间较长，休息有助于保存能量和恢复状态。',
];

function getFallbackKnowledgeList() {
  return FALLBACK_KNOWLEDGE.slice();
}

function getFallbackKnowledge() {
  const list = getFallbackKnowledgeList();
  const index = Math.floor(Date.now() / (60 * 60 * 1000)) % list.length;
  return list[index];
}

function callKnowledge() {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: CLOUD_FUNCTION_NAME,
      data: { action: 'generate' },
      success: resolve,
      fail: reject,
    });
  });
}

async function getCatKnowledge() {
  const fallback = {
    text: getFallbackKnowledge(),
    source: 'fallback',
  };
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') return fallback;

  try {
    const response = await callKnowledge();
    const result = response && response.result ? response.result : response;
    if (!result || result.ok !== true || !result.text) return fallback;
    return {
      text: String(result.text),
      source: result.source === 'hy3' ? 'hy3' : 'fallback',
    };
  } catch (error) {
    console.warn('[CatKnowledge] 科普短句不可用，使用本地兜底:', error);
    return fallback;
  }
}

module.exports = {
  getCatKnowledge,
  getFallbackKnowledge,
  getFallbackKnowledgeList,
};

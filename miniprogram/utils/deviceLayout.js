// 真机布局数据：统一处理状态栏、微信胶囊和底部安全区。
function getWindowInfo() {
  try {
    if (typeof wx.getWindowInfo === 'function') {
      return wx.getWindowInfo() || {};
    }
    if (typeof wx.getSystemInfoSync === 'function') {
      return wx.getSystemInfoSync() || {};
    }
  } catch (err) {
    console.warn('[Layout] 获取窗口信息失败:', err);
  }
  return {};
}

function getMenuButtonRect() {
  try {
    if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
      return wx.getMenuButtonBoundingClientRect() || {};
    }
  } catch (err) {
    console.warn('[Layout] 获取胶囊位置失败:', err);
  }
  return {};
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function getDeviceLayout() {
  const windowInfo = getWindowInfo();
  const menuRect = getMenuButtonRect();
  const windowWidth = toNumber(windowInfo.windowWidth, 375);
  const windowHeight = toNumber(windowInfo.windowHeight, 667);
  const screenHeight = toNumber(windowInfo.screenHeight, windowHeight);
  const statusBarHeight = toNumber(windowInfo.statusBarHeight, 20);
  const menuTop = toNumber(menuRect.top, statusBarHeight + 6);
  const menuHeight = toNumber(menuRect.height, 32);
  const menuBottom = toNumber(menuRect.bottom, menuTop + menuHeight);
  const pageHorizontalPadding = windowWidth * 36 / 750;
  const hasUsableMenuRect = toNumber(menuRect.left, 0) > windowWidth / 2;
  const headerRightInset = hasUsableMenuRect
    ? Math.max(0, windowWidth - pageHorizontalPadding - menuRect.left + 10)
    : 0;
  const safeArea = windowInfo.safeArea || {};
  const safeAreaBottom = toNumber(safeArea.bottom, screenHeight);
  const safeBottom = Math.max(0, screenHeight - safeAreaBottom);

  // 主 Tab 的品牌行与胶囊同高，并在右侧主动让出胶囊区域。
  const pageHeaderTop = Math.max(statusBarHeight + 6, menuTop);
  // 相机取景框从胶囊下方开始，底部操作区按真机 Home Indicator 留白。
  const cameraControlsHeight = 118 + safeBottom;

  return {
    windowWidth: Math.round(windowWidth),
    windowHeight: Math.round(windowHeight),
    safeBottom: Math.round(safeBottom),
    pageHeaderTop: Math.round(pageHeaderTop),
    headerRightInset: Math.round(headerRightInset),
    cameraHeaderRight: Math.round(pageHorizontalPadding + headerRightInset),
    cameraFrameTop: Math.round(Math.max(menuBottom + 24, pageHeaderTop + 54)),
    cameraControlsHeight: Math.round(cameraControlsHeight),
    cameraFrameBottom: Math.round(cameraControlsHeight + 20),
    cameraHintBottom: Math.round(cameraControlsHeight + 30),
  };
}

module.exports = {
  getDeviceLayout,
};

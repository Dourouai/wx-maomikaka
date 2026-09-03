// 云存储文件地址工具：fileID 持久化，展示时换取短期可访问地址。

function getTempFileURL(fileID) {
  if (!fileID || !wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
    return Promise.reject(new Error('云存储暂不可用'));
  }

  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success(response) {
        const item = response && response.fileList && response.fileList[0];
        const url = item && (item.tempFileURL || item.tempFileUrl);
        if (!url) {
          reject(new Error('云存储文件地址不可用'));
          return;
        }
        resolve(url);
      },
      fail: reject,
    });
  });
}

module.exports = { getTempFileURL };

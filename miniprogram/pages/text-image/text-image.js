// pages/text-image/text-image.js
const { generateTextImage } = require('../../utils/textImage');

Page({
  data: {
    prompt: '',
    promptLength: 0,
    presets: [
      '一只橘猫坐在窗台上看雨，暖黄色灯光',
      '清晨的屋顶上，一只猫咪伸懒腰，柔和阳光',
      '猫咪在花园里追一片蝴蝶，轻松明亮的插画',
    ],
    isGenerating: false,
    imagePath: '',
    imageFileID: '',
    modelLabel: 'HY-Image-3.0-Plus',
    resultStatus: '等待输入',
    showException: false,
    exceptionEyebrow: '小小插曲',
    exceptionTitle: '',
    exceptionMessage: '',
    exceptionPrimaryText: '知道了',
  },

  onPromptInput(event) {
    const prompt = String(event.detail && event.detail.value || '');
    this.setData({
      prompt,
      promptLength: prompt.length,
      resultStatus: this.data.imagePath ? '可重新生成' : '等待输入',
    });
  },

  usePreset(event) {
    const prompt = String(event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.prompt || '');
    this.setData({
      prompt,
      promptLength: prompt.length,
      resultStatus: '等待生成',
    });
  },

  async generateImage() {
    if (this.data.isGenerating) return;

    const prompt = String(this.data.prompt || '').trim();
    if (!prompt) {
      this._showException('还差一句话', '先写下你想看到的画面，小猫才能开始画画');
      return;
    }

    this.setData({
      isGenerating: true,
      resultStatus: '生成中',
    });

    try {
      const result = await generateTextImage(prompt);
      this.setData({
        imagePath: result.imagePath,
        imageFileID: result.imageFileID,
        modelLabel: result.modelLabel || 'HY-Image-3.0-Plus',
        resultStatus: '生成完成',
      });
    } catch (error) {
      console.error('[TextImage] 文生图失败:', error);
      this.setData({ resultStatus: '生成失败' });
      this._showException(
        error && error.code === 'RISKY_PROMPT' ? '换个说法吧' : '图片没有画出来',
        error && error.code === 'RISKY_PROMPT'
          ? '你输入的内容含违规信息，请修改后再试'
          : (error && error.message) || '模型暂时没有回应，请稍后再试',
      );
    } finally {
      this.setData({ isGenerating: false });
    }
  },

  _showException(title, message) {
    this.setData({
      showException: true,
      exceptionTitle: title,
      exceptionMessage: message,
    });
  },

  closeException() {
    this.setData({ showException: false });
  },
});

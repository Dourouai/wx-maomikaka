Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    eyebrow: {
      type: String,
      value: '小小插曲',
    },
    title: {
      type: String,
      value: '这次没收好',
    },
    message: {
      type: String,
      value: '先歇一下，再试一次吧',
    },
    detail: {
      type: String,
      value: '',
    },
    primaryText: {
      type: String,
      value: '知道了',
    },
    secondaryText: {
      type: String,
      value: '',
    },
    showSecondary: {
      type: Boolean,
      value: false,
    },
    dismissOnMask: {
      type: Boolean,
      value: false,
    },
  },

  methods: {
    stopPropagation() {},

    handlePrimary() {
      this.triggerEvent('primary');
    },

    handleSecondary() {
      this.triggerEvent('secondary');
    },

    handleMaskTap() {
      if (this.data.dismissOnMask) this.triggerEvent('dismiss');
    },
  },
});

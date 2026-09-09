// 罐罐流水：把相遇消耗和购买订单放在同一页，购买到账以服务端发货状态为准。
const storage = require('../../utils/storage');
const virtualPayment = require('../../utils/virtualPayment');
const deviceLayout = require('../../utils/deviceLayout');

Page({
  data: {
    pageHeaderTop: 48,
    headerRightInset: 0,
    activeFilter: 'all',
    filters: [
      { id: 'all', label: '全部' },
      { id: 'usage', label: '使用' },
      { id: 'recharge', label: '购买' },
    ],
    allRecords: [],
    records: [],
    usageCount: 0,
    rechargeCount: 0,
    loading: false,
    rechargeUnavailable: false,
  },

  onLoad() {
    this._syncDeviceLayout();
  },

  onShow() {
    this._syncDeviceLayout();
    this._loadRecords();
  },

  onResize() {
    this._syncDeviceLayout();
  },

  _syncDeviceLayout() {
    const layout = deviceLayout.getDeviceLayout();
    this.setData({
      pageHeaderTop: layout.pageHeaderTop,
      headerRightInset: layout.headerRightInset,
    });
  },

  _getTimestamp(value) {
    if (value && typeof value === 'object') {
      if (value.$date) return this._getTimestamp(value.$date);
      if (value.value) return this._getTimestamp(value.value);
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  },

  _formatDate(timestamp) {
    const date = new Date(this._getTimestamp(timestamp) || Date.now());
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  },

  _formatTime(timestamp) {
    const date = new Date(this._getTimestamp(timestamp) || Date.now());
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  },

  _buildUsageRecords() {
    return storage.getAllRecords().map((record, index) => {
      const sourceLabel = record.canUsageSource === 'purchased' ? '充值罐罐' : '每日赠送';
      return {
      id: `usage-${record.recordId || index}`,
      type: 'usage',
      icon: '/assets/icon-can-coral.svg',
      title: `遇见${record.catName || '一只猫'}`,
      subtitle: `${this._formatDate(record.createdAt)} · ${this._formatTime(record.createdAt)} · ${sourceLabel}`,
      amount: '-1',
      amountClass: 'can-ledger-amount-negative',
      status: sourceLabel,
      statusClass: record.canUsageSource === 'purchased'
        ? 'can-ledger-status-purchased'
        : 'can-ledger-status-gift',
      timestamp: this._getTimestamp(record.createdAt),
      };
    });
  },

  _buildRechargeRecords(orders) {
    return (Array.isArray(orders) ? orders : []).map((order, index) => {
      const canAmount = Math.max(0, Number(order.canAmount) || 0);
      const delivered = order.delivered === true || order.status === 'delivered';
      const status = delivered
        ? '已到账'
        : order.status === 'failed'
          ? '未完成'
          : '待确认';
      const statusClass = delivered
        ? 'can-ledger-status-success'
        : (status === '未完成' ? 'can-ledger-status-failed' : 'can-ledger-status-pending');
      const priceYuan = Math.max(0, Number(order.goodsPrice) || 0) / 100;
      const price = Number.isInteger(priceYuan) ? String(priceYuan) : priceYuan.toFixed(2);
      const timestamp = this._getTimestamp(order.createdAt || order.updatedAt);
      return {
        id: `recharge-${order.orderId || index}`,
        type: 'recharge',
        icon: '/assets/icon-recharge-coral.svg',
        title: `购买 ${canAmount} 个罐罐`,
        subtitle: `¥${price} · ${this._formatDate(timestamp)} · ${this._formatTime(timestamp)}`,
        amount: `+${canAmount}`,
        amountClass: 'can-ledger-amount-positive',
        status,
        statusClass,
        timestamp,
      };
    });
  },

  async _loadRecords() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const usageRecords = this._buildUsageRecords();
    let rechargeRecords = [];
    let rechargeUnavailable = false;

    try {
      const result = await virtualPayment.listOrders();
      rechargeRecords = this._buildRechargeRecords(result && result.orders);
    } catch (error) {
      rechargeUnavailable = true;
      const rawMessage = String(error && (error.errMsg || error.message) || '');
      if (!/functionname.*(?:could not be found|not found)|function.*not found|云函数.*不存在/i.test(rawMessage)) {
        console.warn('[CanHistory] 充值记录暂不可用:', error);
      }
    }

    const allRecords = usageRecords.concat(rechargeRecords)
      .sort((left, right) => right.timestamp - left.timestamp);
    this.setData({
      usageCount: usageRecords.length,
      rechargeCount: rechargeRecords.length,
      rechargeUnavailable,
      loading: false,
      allRecords,
      records: this._filterRecords(allRecords, this.data.activeFilter),
    });
  },

  _filterRecords(records, filter) {
    if (filter === 'usage') return records.filter(item => item.type === 'usage');
    if (filter === 'recharge') return records.filter(item => item.type === 'recharge');
    return records;
  },

  selectFilter(event) {
    const filter = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.filter || 'all');
    if (!this.data.filters.some(item => item.id === filter)) return;
    this.setData({
      activeFilter: filter,
      records: this._filterRecords(this.data.allRecords, filter),
    });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/my/my' }),
    });
  },
});

// pages/card-detail/card-detail.js
const storage = require('../../utils/storage');
const { getCatById } = require('../../utils/catData');
const cloudFiles = require('../../utils/cloudFiles');
const catScoring = require('../../utils/catScoring');
const deviceLayout = require('../../utils/deviceLayout');

Page({
  data: {
    catData: null,
    records: [],
    featuredPhoto: '',
    featuredRecordId: '',
    bestLevelCode: 'C',
    bestLevelLabel: '街角',
    bestLevelShortLabel: '街角常客',
    bestOverallScore: null,
    bestOverallScoreText: '--',
    bestScoreItems: [],
    bestPawReward: null,
    bestPointReward: null,
    bestScorePending: true,
    encounterCount: 0,
    encounterCountText: '00',
    encounterCountLabel: '尚未相遇',
    archiveCode: '0000',
    fieldNoteText: '',
    fieldNoteDate: '--',
    fieldNoteEncounterTitle: '相遇手记',
    firstSeenText: '--',
    lastSeenText: '--',
    showDeleteConfirm: false,
    deleteBusy: false,
    deleteError: '',
    pageHeaderTop: 48,
    headerRightInset: 0,
  },

  onLoad(options) {
    this._syncDeviceLayout();
    this.catId = options.catId || '';
    if (this.catId) this._loadCatData(this.catId);
  },

  onShow() {
    this._syncDeviceLayout();
    if (this.catId) this._loadCatData(this.catId);
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

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/collection/collection' }),
    });
  },

  _loadCatData(catId) {
    const catData = getCatById(catId);
    if (!catData) return;

    const collection = storage.getCollection();
    const entry = collection[catId] || {};
    const storedRecords = storage.getRecordsForCat(catId);
    const totalRecords = storedRecords.length;
    const records = storedRecords.map((record, index) => {
      const encounter = catScoring.getStoredEncounter(record);
      const encounterNumber = totalRecords - index;
      return {
        ...record,
        ...encounter,
        photoPath: storage.getRecordDisplayPath(record),
        originalPhotoPath: record.photoPath || record.photo || '',
        timeText: this._formatDate(record.createdAt),
        timeShort: this._formatShortDate(record.createdAt),
        encounterNumber,
        encounterIndex: String(encounterNumber).padStart(2, '0'),
        encounterTitle: encounterNumber === 1 ? '第一次遇见' : `第 ${encounterNumber} 次相遇`,
      };
    });
    const featuredRecord = entry.featuredRecordId
      ? records.find(record => record.recordId === entry.featuredRecordId)
      : records[0];
    const firstRecord = records[records.length - 1];
    const lastRecord = records[0];
    const displayCatData = {
      ...catData,
      name: entry.displayName || (lastRecord && lastRecord.catName) || catData.name,
      breed: (lastRecord && lastRecord.detectedBreed) || catData.breed,
      trait: lastRecord && Array.isArray(lastRecord.detectedTraits) && lastRecord.detectedTraits.length
        ? lastRecord.detectedTraits
        : catData.trait,
      story: entry.displayDescription
        || (lastRecord && lastRecord.catDescription)
        || catData.story,
    };
    const bestEncounter = catScoring.getBestEncounter(records);
    const bestLevel = catScoring.getLevelMeta(bestEncounter ? bestEncounter.levelCode : 'C');
    const encounterCount = entry.photoCount || records.length;

    this.setData({
      catData: displayCatData,
      records,
      featuredRecordId: featuredRecord ? featuredRecord.recordId : '',
      featuredPhoto: featuredRecord
        ? storage.getRecordDisplayPath(featuredRecord)
        : '',
      bestLevelCode: bestLevel.code,
      bestLevelLabel: bestLevel.label,
      bestLevelShortLabel: bestLevel.shortLabel,
      bestOverallScore: bestEncounter ? bestEncounter.overallScore : null,
      bestOverallScoreText: bestEncounter && bestEncounter.overallScore !== null
        ? String(bestEncounter.overallScore)
        : '--',
      bestScoreItems: bestEncounter ? bestEncounter.scoreItems : [],
      bestPawReward: bestEncounter ? bestEncounter.pawReward : null,
      bestPointReward: bestEncounter ? bestEncounter.pointReward : null,
      bestScorePending: bestEncounter ? bestEncounter.scorePending : true,
      encounterCount,
      encounterCountText: String(encounterCount).padStart(2, '0'),
      encounterCountLabel: encounterCount > 0 ? `第 ${encounterCount} 次遇见` : '尚未相遇',
      archiveCode: this._formatArchiveCode(catId),
      fieldNoteText: displayCatData.story || '这次相遇，已经被轻轻收进档案里。',
      fieldNoteDate: lastRecord ? this._formatDate(lastRecord.createdAt) : '--',
      fieldNoteEncounterTitle: lastRecord ? lastRecord.encounterTitle : '相遇手记',
      firstSeenText: firstRecord ? this._formatDate(firstRecord.createdAt) : '--',
      lastSeenText: lastRecord ? this._formatDate(lastRecord.createdAt) : '--',
    });
    this._refreshPhotoURLs(records, featuredRecord ? featuredRecord.recordId : '');
  },

  async _refreshPhotoURLs(records, featuredRecordId) {
    await Promise.all(records.map(async (record, index) => {
      if (!record.cutoutFileID && !record.originalFileID) return;

      try {
        const fileIDs = [record.cutoutFileID, record.originalFileID].filter(Boolean);
        let photoPath = '';
        for (const fileID of fileIDs) {
          try {
            photoPath = await cloudFiles.getTempFileURL(fileID);
            if (photoPath) break;
          } catch (error) {
            // 主体图失效时继续尝试安全校验后的原图 fileID。
          }
        }
        if (!photoPath) throw new Error('云存储文件地址不可用');
        const patch = {};
        patch[`records[${index}].photoPath`] = photoPath;
        if (record.recordId === featuredRecordId) patch.featuredPhoto = photoPath;
        this.setData(patch);
      } catch (error) {
        const patch = {};
        patch[`records[${index}].photoPath`] = record.originalPhotoPath || '';
        if (record.recordId === featuredRecordId) {
          patch.featuredPhoto = record.originalPhotoPath || '';
        }
        this.setData(patch);
        console.warn('[CardDetail] 获取图像地址失败:', error);
      }
    }));
  },

  _formatDate(timestamp) {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  },

  _formatShortDate(timestamp) {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  },

  _formatArchiveCode(catId) {
    const matched = String(catId || '').match(/\d+/);
    return matched ? String(Number(matched[0])).padStart(4, '0') : '0000';
  },

  goCollection() {
    wx.switchTab({ url: '/pages/collection/collection' });
  },

  openDeleteConfirm() {
    if (!this.catId || !this.data.catData || this.data.deleteBusy) return;
    this.setData({ showDeleteConfirm: true, deleteError: '' });
  },

  stopDeletePropagation() {},

  cancelDelete() {
    if (this.data.deleteBusy) return;
    this.setData({ showDeleteConfirm: false, deleteError: '' });
  },

  confirmDelete() {
    if (this.data.deleteBusy || !this.catId) return;

    this.setData({ deleteBusy: true, deleteError: '' });
    try {
      storage.removeCatArchive(this.catId);
      this.setData({ showDeleteConfirm: false, deleteBusy: false });
      wx.switchTab({ url: '/pages/collection/collection' });
    } catch (error) {
      console.error('[CardDetail] 删除档案失败:', error);
      this.setData({
        deleteBusy: false,
        deleteError: '档案暂时没有删掉，请稍后再试。',
      });
    }
  },

  setFeatured(event) {
    const recordId = event.currentTarget.dataset.recordId;
    if (!this.catId || !recordId) return;
    storage.setFeaturedRecord(this.catId, recordId);
    this._loadCatData(this.catId);
    wx.showToast({ title: '主图已更新', icon: 'success', duration: 1200 });
  },
});

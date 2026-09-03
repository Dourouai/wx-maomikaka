// pages/card-detail/card-detail.js
const storage = require('../../utils/storage');
const { getCatById } = require('../../utils/catData');
const cloudFiles = require('../../utils/cloudFiles');
const catScoring = require('../../utils/catScoring');

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
    bestScoreItems: [],
    bestPawReward: null,
    bestPointReward: null,
    bestScorePending: true,
    encounterCount: 0,
    firstSeenText: '--',
    lastSeenText: '--',
  },

  onLoad(options) {
    this.catId = options.catId || '';
    if (this.catId) this._loadCatData(this.catId);
  },

  onShow() {
    if (this.catId) this._loadCatData(this.catId);
  },

  _loadCatData(catId) {
    const catData = getCatById(catId);
    if (!catData) return;

    const collection = storage.getCollection();
    const entry = collection[catId] || {};
    const records = storage.getRecordsForCat(catId).map(record => {
      const encounter = catScoring.getStoredEncounter(record);
      return {
        ...record,
        ...encounter,
        photoPath: storage.getRecordDisplayPath(record),
        originalPhotoPath: record.photoPath || record.photo || '',
        timeText: this._formatDate(record.createdAt),
      };
    });
    const featuredRecord = entry.featuredRecordId
      ? records.find(record => record.recordId === entry.featuredRecordId)
      : records[0];
    const firstRecord = records[records.length - 1];
    const lastRecord = records[0];
    const bestEncounter = catScoring.getBestEncounter(records);
    const bestLevel = catScoring.getLevelMeta(bestEncounter ? bestEncounter.levelCode : 'C');

    this.setData({
      catData,
      records,
      featuredRecordId: featuredRecord ? featuredRecord.recordId : '',
      featuredPhoto: featuredRecord
        ? storage.getRecordDisplayPath(featuredRecord)
        : '',
      bestLevelCode: bestLevel.code,
      bestLevelLabel: bestLevel.label,
      bestLevelShortLabel: bestLevel.shortLabel,
      bestOverallScore: bestEncounter ? bestEncounter.overallScore : null,
      bestScoreItems: bestEncounter ? bestEncounter.scoreItems : [],
      bestPawReward: bestEncounter ? bestEncounter.pawReward : null,
      bestPointReward: bestEncounter ? bestEncounter.pointReward : null,
      bestScorePending: bestEncounter ? bestEncounter.scorePending : true,
      encounterCount: entry.photoCount || records.length,
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

  setFeatured(event) {
    const recordId = event.currentTarget.dataset.recordId;
    if (!this.catId || !recordId) return;
    storage.setFeaturedRecord(this.catId, recordId);
    this._loadCatData(this.catId);
    wx.showToast({ title: '主图已更新', icon: 'success', duration: 1200 });
  },
});

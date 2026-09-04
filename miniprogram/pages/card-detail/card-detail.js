// pages/card-detail/card-detail.js
const storage = require('../../utils/storage');
const userData = require('../../utils/userData');
const catShare = require('../../utils/catShare');
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
    shareId: '',
    isSharedArchive: false,
    shareLoading: false,
    shareError: '',
    currentLevelCode: 'C',
    currentLevelLabel: '街角',
    currentLevelShortLabel: '街角常客',
    currentOverallScore: null,
    currentOverallScoreText: '--',
    currentScoreItems: [],
    currentPawReward: null,
    currentPointReward: null,
    currentScorePending: true,
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

  onLoad(options = {}) {
    this._syncDeviceLayout();
    this.catId = options.catId || '';
    const rawShareId = String(options.shareId || '');
    try {
      this.shareId = rawShareId ? decodeURIComponent(rawShareId) : '';
    } catch (error) {
      this.shareId = '';
    }
    this.isSharedArchive = Boolean(this.shareId);
    if (this.shareId) {
      this.setData({
        shareId: this.shareId,
        isSharedArchive: true,
        shareLoading: true,
      });
      this._loadSharedArchive(this.shareId);
    } else if (this.catId) {
      this._loadCatData(this.catId);
    }
  },

  onShow() {
    this._syncDeviceLayout();
    if (!this.isSharedArchive && this.catId) this._loadCatData(this.catId);
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
    this._applyArchiveView({
      catId,
      rawRecords: storedRecords,
      featuredRecordId: entry.featuredRecordId || '',
      profile: {
        name: entry.displayName,
        description: entry.displayDescription,
      },
      isShared: false,
      shareId: storage.getShareId(catId),
    });
    this._prepareShare(catId, storedRecords, entry.featuredRecordId || '');
  },

  async _loadSharedArchive(shareId) {
    try {
      const result = await this._getSharedArchiveWithRetry(shareId);
      const archive = result && result.archive ? result.archive : {};
      const catalogCatId = archive.catalogCatId || archive.catId || '';
      const records = Array.isArray(archive.records)
        ? archive.records.map(record => this._mapSharedRecord(record, catalogCatId))
        : [];
      this.catId = catalogCatId;
      this._applyArchiveView({
        catId: catalogCatId,
        rawRecords: records,
        featuredRecordId: archive.featuredRecordId || '',
        profile: archive.profile || {},
        isShared: true,
        shareId,
      });
    } catch (error) {
      if (error && error.code === 'SHARE_NOT_FOUND') {
        console.warn('[CardDetail] 公开猫档案已失效');
      } else {
        console.error('[CardDetail] 公开猫档案加载失败:', error);
      }
      this.setData({
        shareLoading: false,
        shareError: error && error.code === 'SHARE_NOT_FOUND'
          ? '这份猫咪档案已失效'
          : '猫咪档案暂时打不开',
      });
    }
  },

  async _getSharedArchiveWithRetry(shareId) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await catShare.get(shareId);
      } catch (error) {
        lastError = error;
        const canRetry = error && error.code === 'SHARE_NOT_FOUND' && attempt < 2;
        if (!canRetry) throw error;
        await new Promise(resolve => setTimeout(resolve, 180 * (attempt + 1)));
      }
    }
    throw lastError || new Error('分享档案暂时打不开');
  },

  _mapSharedRecord(source, fallbackCatId) {
    const item = source && typeof source === 'object' ? source : {};
    const display = item.display && typeof item.display === 'object' ? item.display : {};
    const media = item.media && typeof item.media === 'object' ? item.media : {};
    const observation = item.observation && typeof item.observation === 'object'
      ? item.observation
      : {};
    const score = item.score && typeof item.score === 'object' ? item.score : {};
    const recordId = item.localRecordId
      || item.clientRecordId
      || item.encounterId
      || `shared_${Date.now()}`;
    const cutoutTempURL = media.cutoutTempURL || item.cutoutTempURL || '';
    const originalTempURL = media.originalTempURL || item.originalTempURL || '';

    return {
      recordId,
      clientRecordId: item.localRecordId || item.clientRecordId || recordId,
      catId: item.catalogCatId || fallbackCatId,
      catName: display.name || item.catName || '',
      catDescription: display.description || item.catDescription || '',
      copyVersion: display.copyVersion || item.copyVersion || '',
      photoPath: cutoutTempURL || originalTempURL,
      photo: originalTempURL,
      originalPhotoPath: originalTempURL,
      cutoutPhotoPath: cutoutTempURL,
      originalFileID: media.originalFileID || item.originalFileID || '',
      cutoutFileID: media.cutoutFileID || item.cutoutFileID || '',
      originalTempURL,
      cutoutTempURL,
      cutoutContentType: media.cutoutContentType || item.cutoutContentType || '',
      cutoutProvider: media.cutoutProvider || item.cutoutProvider || '',
      cutoutOperation: media.cutoutOperation || item.cutoutOperation || '',
      cutoutRequestId: media.cutoutRequestId || item.cutoutRequestId || '',
      cutoutCheckerboardRemoved: media.cutoutCheckerboardRemoved === true,
      levelCode: score.levelCode || item.levelCode || null,
      levelLabel: score.levelLabel || item.levelLabel || null,
      levelShortLabel: score.levelShortLabel || item.levelShortLabel || null,
      charmScore: score.charmScore,
      clevernessScore: score.clevernessScore,
      auraScore: score.auraScore,
      rarityScore: score.rarityScore,
      fateScore: score.fateScore,
      overallScore: score.overallScore,
      pawReward: score.pawReward,
      pointReward: score.pointReward,
      scorePending: score.scorePending === true,
      scoreSource: score.scoreSource || '',
      scoreVersion: score.scoreVersion || '',
      scoreEvidence: score.scoreEvidence || null,
      scoreCoverage: score.scoreCoverage || null,
      detectedBreed: observation.breed || item.detectedBreed || '',
      breedConfidence: observation.breedConfidence,
      detectedTraits: Array.isArray(observation.traits) ? observation.traits : [],
      catCount: observation.catCount || 1,
      detectionSource: observation.source || '',
      createdAt: item.createdAt || item.capturedAt || Date.now(),
      capturedAt: item.capturedAt || item.createdAt || '',
    };
  },

  _applyArchiveView({
    catId,
    rawRecords = [],
    featuredRecordId = '',
    profile = {},
    isShared = false,
    shareId = '',
  }) {
    const catData = getCatById(catId);
    if (!catData) throw new Error('无效的猫咪档案');

    const totalRecords = rawRecords.length;
    const records = rawRecords.map((record, index) => {
      const encounter = catScoring.getStoredEncounter(record);
      const encounterNumber = totalRecords - index;
      return {
        ...record,
        ...encounter,
        photoPath: storage.getRecordDisplayPath(record) || record.photoPath || '',
        originalPhotoPath: record.originalPhotoPath || record.photoPath || record.photo || '',
        timeText: this._formatDate(record.createdAt),
        timeShort: this._formatShortDate(record.createdAt),
        encounterNumber,
        encounterIndex: String(encounterNumber).padStart(2, '0'),
        encounterTitle: encounterNumber === 1 ? '第一次遇见' : `第 ${encounterNumber} 次相遇`,
      };
    });
    const featuredRecord = featuredRecordId
      ? records.find(record => record.recordId === featuredRecordId)
      : records[0];
    const firstRecord = records[records.length - 1];
    const lastRecord = records[0];
    const profileTraits = Array.isArray(profile.traits) && profile.traits.length
      ? profile.traits
      : null;
    const displayCatData = {
      ...catData,
      name: profile.name || (lastRecord && lastRecord.catName) || catData.name,
      breed: profile.breed || (lastRecord && lastRecord.detectedBreed) || catData.breed,
      trait: profileTraits
        || (lastRecord && Array.isArray(lastRecord.detectedTraits) && lastRecord.detectedTraits.length
          ? lastRecord.detectedTraits
          : catData.trait),
      story: profile.description
        || (lastRecord && lastRecord.catDescription)
        || catData.story,
    };
    const encounterCount = records.length;
    // 详情页展示当前猫咪最近一次相遇的评分，不把历史最高分误标为历史最佳。
    const currentEncounter = lastRecord ? catScoring.getStoredEncounter(lastRecord) : null;
    const currentLevel = catScoring.getLevelMeta(currentEncounter ? currentEncounter.levelCode : 'C');

    this.catId = catId;
    this.isSharedArchive = isShared === true;
    this.shareId = isShared
      ? (shareId || this.shareId || '')
      : storage.getShareId(catId);
    this.setData({
      catData: displayCatData,
      records,
      featuredRecordId: featuredRecord ? featuredRecord.recordId : '',
      featuredPhoto: featuredRecord
        ? storage.getRecordDisplayPath(featuredRecord)
        : '',
      shareId: this.shareId,
      isSharedArchive: this.isSharedArchive,
      shareLoading: false,
      shareError: '',
      currentLevelCode: currentLevel.code,
      currentLevelLabel: currentLevel.label,
      currentLevelShortLabel: currentLevel.shortLabel,
      currentOverallScore: currentEncounter ? currentEncounter.overallScore : null,
      currentOverallScoreText: currentEncounter && currentEncounter.overallScore !== null
        ? String(currentEncounter.overallScore)
        : '--',
      currentScoreItems: currentEncounter ? currentEncounter.scoreItems : [],
      currentPawReward: currentEncounter ? currentEncounter.pawReward : null,
      currentPointReward: currentEncounter ? currentEncounter.pointReward : null,
      currentScorePending: currentEncounter ? currentEncounter.scorePending : true,
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

  _buildShareArchive(catId, rawRecords, featuredRecordId) {
    const catData = getCatById(catId) || {};
    const currentCatData = this.data.catData || {};
    const latest = rawRecords[0] || {};
    const traits = Array.isArray(latest.detectedTraits) && latest.detectedTraits.length
      ? latest.detectedTraits
      : (Array.isArray(catData.trait) ? catData.trait : []);

    return {
      catalogCatId: catId,
      featuredRecordId: featuredRecordId || (latest.recordId || latest.clientRecordId || ''),
      profile: {
        name: currentCatData.name || latest.catName || catData.name || '',
        description: currentCatData.story || latest.catDescription || catData.story || '',
        breed: currentCatData.breed || latest.detectedBreed || catData.breed || '',
        traits: Array.isArray(currentCatData.trait) && currentCatData.trait.length
          ? currentCatData.trait
          : traits,
      },
      records: rawRecords.slice(0, 50).map(record => ({
        clientRecordId: record.clientRecordId || record.recordId,
        catalogCatId: catId,
        display: {
          name: record.catName || '',
          description: record.catDescription || '',
          copyVersion: record.copyVersion || '',
        },
        media: {
          originalFileID: record.originalFileID || '',
          cutoutFileID: record.cutoutFileID || '',
          cutoutContentType: record.cutoutContentType || '',
          cutoutProvider: record.cutoutProvider || '',
          cutoutOperation: record.cutoutOperation || '',
          cutoutRequestId: record.cutoutRequestId || '',
          cutoutCheckerboardRemoved: record.cutoutCheckerboardRemoved === true,
        },
        observation: {
          breed: record.detectedBreed || '',
          breedConfidence: record.breedConfidence,
          traits: Array.isArray(record.detectedTraits) ? record.detectedTraits : [],
          catCount: record.catCount || 1,
          source: record.detectionSource || '',
        },
        score: {
          levelCode: record.levelCode || '',
          levelLabel: record.levelLabel || '',
          levelShortLabel: record.levelShortLabel || '',
          charmScore: record.charmScore,
          clevernessScore: record.clevernessScore,
          auraScore: record.auraScore,
          rarityScore: record.rarityScore,
          fateScore: record.fateScore,
          overallScore: record.overallScore,
          pawReward: record.pawReward,
          pointReward: record.pointReward,
          scorePending: record.scorePending === true,
          scoreSource: record.scoreSource || '',
          scoreVersion: record.scoreVersion || '',
          scoreEvidence: record.scoreEvidence || null,
          scoreCoverage: record.scoreCoverage || null,
        },
        createdAt: record.createdAt || record.capturedAt || Date.now(),
        capturedAt: record.capturedAt || record.createdAt || '',
      })),
    };
  },

  _prepareShare(catId, rawRecords, featuredRecordId) {
    if (this.isSharedArchive || !Array.isArray(rawRecords) || !rawRecords.length) return;

    const shareId = storage.getShareId(catId) || storage.getOrCreateShareId(catId);
    this.shareId = shareId;
    this.setData({ shareId });
    const archive = this._buildShareArchive(catId, rawRecords, featuredRecordId);
    const fingerprint = JSON.stringify(archive);
    if (this._sharePreparing && this._shareFingerprint === fingerprint) return;
    if (this._shareReady && this._shareFingerprint === fingerprint) return;

    this._shareFingerprint = fingerprint;
    this._shareReady = false;
    this._sharePreparing = catShare.create(shareId, archive)
      .then(result => {
        const returnedShareId = result && result.shareId ? result.shareId : shareId;
        this.shareId = returnedShareId;
        storage.setShareId(catId, returnedShareId);
        this._shareReady = true;
      })
      .catch(error => {
        this._shareFingerprint = '';
        console.warn('[CardDetail] 公开分享链接准备失败:', error);
      })
      .finally(() => {
        this._sharePreparing = null;
      });
  },

  async _refreshPhotoURLs(records, featuredRecordId) {
    await Promise.all(records.map(async (record, index) => {
      const directURLs = [record.cutoutTempURL, record.originalTempURL].filter(Boolean);
      if (!directURLs.length && !record.cutoutFileID && !record.originalFileID) return;

      try {
        let photoPath = directURLs[0] || '';
        if (!photoPath) {
          const fileIDs = [record.cutoutFileID, record.originalFileID].filter(Boolean);
          for (const fileID of fileIDs) {
            try {
              photoPath = await cloudFiles.getTempFileURL(fileID);
              if (photoPath) break;
            } catch (error) {
              // 主体图失效时继续尝试安全校验后的原图 fileID。
            }
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
    if (this.isSharedArchive || !this.catId || !this.data.catData || this.data.deleteBusy) return;
    this.setData({ showDeleteConfirm: true, deleteError: '' });
  },

  stopDeletePropagation() {},

  cancelDelete() {
    if (this.data.deleteBusy) return;
    this.setData({ showDeleteConfirm: false, deleteError: '' });
  },

  async confirmDelete() {
    if (this.isSharedArchive || this.data.deleteBusy || !this.catId) return;

    this.setData({ deleteBusy: true, deleteError: '' });
    try {
      // 已绑定用户先同步云端软删除，云端失败时保留本地档案，避免两端状态分叉。
      if (userData.isUserBound()) {
        await userData.deleteCatalogArchive(this.catId);
      }
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
    if (this.isSharedArchive || !this.catId || !recordId) return;
    storage.setFeaturedRecord(this.catId, recordId);
    this._loadCatData(this.catId);
    wx.showToast({ title: '主图已更新', icon: 'success', duration: 1200 });
  },

  onShareAppMessage() {
    const name = this.data.catData && this.data.catData.name
      ? this.data.catData.name
      : '一只猫';
    const shareId = this.isSharedArchive
      ? this.shareId
      : (this.catId && (storage.getShareId(this.catId) || storage.getOrCreateShareId(this.catId)));
    if (!this.isSharedArchive && this.catId && !this._shareReady) {
      this._prepareShare(this.catId, storage.getRecordsForCat(this.catId), this.data.featuredRecordId);
    }
    return {
      title: `我在街角遇见了「${name}」｜猫咪咔咔`,
      path: shareId
        ? `/pages/card-detail/card-detail?shareId=${encodeURIComponent(shareId)}`
        : `/pages/card-detail/card-detail?catId=${encodeURIComponent(this.catId || '')}&from=share`,
    };
  },

  onShareTimeline() {
    const name = this.data.catData && this.data.catData.name
      ? this.data.catData.name
      : '一只猫';
    const shareId = this.isSharedArchive
      ? this.shareId
      : (this.catId && (storage.getShareId(this.catId) || storage.getOrCreateShareId(this.catId)));
    if (!this.isSharedArchive && this.catId && !this._shareReady) {
      this._prepareShare(this.catId, storage.getRecordsForCat(this.catId), this.data.featuredRecordId);
    }
    return {
      title: `街角遇见「${name}」｜猫咪咔咔`,
      query: shareId
        ? `shareId=${encodeURIComponent(shareId)}`
        : `catId=${encodeURIComponent(this.catId || '')}&from=timeline`,
    };
  },
});

// pages/card-detail/card-detail.js
const storage = require('../../utils/storage');
const userData = require('../../utils/userData');
const catShare = require('../../utils/catShare');
const { getCatById } = require('../../utils/catData');
const cloudFiles = require('../../utils/cloudFiles');
const catScoring = require('../../utils/catScoring');
const deviceLayout = require('../../utils/deviceLayout');
const archiveIds = require('../../utils/archiveCode');

function formatSourceType(value) {
  return storage.normalizeSourceType(value).toUpperCase();
}

function callPublicCatDetail(publicCatId) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(new Error('云端服务暂时不可用'));
  }

  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'cat-friends',
      data: {
        action: 'detail',
        publicCatId,
      },
      success(response) {
        const result = response && response.result ? response.result : response;
        if (!result || result.ok !== true) {
          const error = new Error(result && result.message || '猫咪档案暂时打不开');
          error.code = result && result.code || 'CAT_FRIEND_DETAIL_FAILED';
          reject(error);
          return;
        }
        resolve(result);
      },
      fail: reject,
    });
  });
}

Page({
  data: {
    catData: null,
    featuredPhoto: '',
    featuredRecordId: '',
    currentRecordId: '',
    shareId: '',
    isSharedArchive: false,
    isPublicGalleryArchive: false,
    shareLoading: false,
    shareError: '',
    currentLevelCode: 'C',
    currentSourceType: 'PHOTO',
    currentLevelLabel: '街角',
    currentLevelShortLabel: '街角常客',
    currentOverallScore: null,
    currentOverallScoreText: '--',
    currentScoreItems: [],
    currentPawReward: null,
    currentPointReward: null,
    currentScorePending: true,
    currentOriginalFileID: '',
    scoreRepairBusy: false,
    scoreRepairError: '',
    posterEligible: false,
    posterUnavailableReason: '评分尚未完成，完成评分后才能生成海报',
    archiveCode: '',
    fieldNoteText: '',
    fieldNoteDate: '--',
    firstSeenText: '--',
    lastSeenText: '--',
    locationText: '',
    hasLocation: false,
    showDeleteConfirm: false,
    deleteBusy: false,
    deleteError: '',
    publicVisibility: 'public',
    visibilityPublic: true,
    visibilityBusy: false,
    visibilityError: '',
    returnLabel: '返回猫卡',
    returnAriaLabel: '返回猫卡',
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
    const rawPublicCatId = String(options.publicCatId || '');
    try {
      this.publicCatId = rawPublicCatId ? decodeURIComponent(rawPublicCatId).trim() : '';
    } catch (error) {
      this.publicCatId = '';
    }
    this.returnToFriends = Boolean(this.publicCatId && !this.shareId);
    this.isPublicGalleryArchive = this.returnToFriends;
    this.setData({
      returnLabel: this.returnToFriends ? '返回猫友列表' : '返回猫卡',
      returnAriaLabel: this.returnToFriends ? '返回猫友列表' : '返回猫卡',
    });
    this.isSharedArchive = Boolean(this.shareId || this.publicCatId);
    this._skipInitialShowRefresh = false;
    if (this.shareId) {
      this.setData({
        shareId: this.shareId,
        isSharedArchive: true,
        shareLoading: true,
      });
      this._loadSharedArchive(this.shareId);
    } else if (this.publicCatId) {
      this.setData({
        isSharedArchive: true,
        isPublicGalleryArchive: true,
        shareLoading: true,
      });
      this._loadPublicGalleryArchive(this.publicCatId);
    } else if (this.catId) {
      // onLoad 后紧接着会触发第一次 onShow，首次展示不再重复读取和组装档案。
      this._skipInitialShowRefresh = true;
      this._loadCatData(this.catId);
    }
  },

  onShow() {
    this._syncDeviceLayout();
    if (this.isSharedArchive || !this.catId) return;
    if (this._skipInitialShowRefresh) {
      this._skipInitialShowRefresh = false;
      return;
    }
    this._loadCatData(this.catId);
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

  _formatLocation(location, locationStatus) {
    const source = location && typeof location === 'object' ? location : null;
    const status = String(locationStatus || (source ? 'captured' : 'unavailable'));
    if (!source || status !== 'captured') return '';

    const locationText = String(source.locationText || source.label || source.name || '').trim();
    if (locationText) return locationText.slice(0, 20);

    const latitude = Number(source.latitude);
    const longitude = Number(source.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
    return `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°`;
  },

  goBack() {
    if (this.returnToFriends) {
      wx.navigateBack({
        delta: 1,
        fail: () => wx.navigateTo({ url: '/pages/cat-friends/cat-friends' }),
      });
      return;
    }
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/collection/collection' }),
    });
  },

  openPoster() {
    if (this.isPublicGalleryArchive) return;
    if (!this.catId && !this.shareId) return;
    if (!this.data.posterEligible) {
      wx.showToast({
        title: this.data.posterUnavailableReason || '海报暂不可用',
        icon: 'none',
        duration: 1800,
      });
      return;
    }

    const query = [];
    if (this.isSharedArchive && this.shareId) {
      query.push(`shareId=${encodeURIComponent(this.shareId)}`);
    } else if (this.catId) {
      query.push(`catId=${encodeURIComponent(this.catId)}`);
    }
    if (this.data.currentRecordId) {
      query.push(`recordId=${encodeURIComponent(this.data.currentRecordId)}`);
    }
    wx.navigateTo({
      url: `/pages/poster-loading/poster-loading?${query.join('&')}`,
    });
  },

  async repairCurrentScore() {
    if (
      this.isSharedArchive
      || !this.data.currentRecordId
      || !this.data.currentOriginalFileID
      || this.data.scoreRepairBusy
    ) return;

    this.setData({ scoreRepairBusy: true, scoreRepairError: '' });
    try {
      const result = await userData.repairRecordScore(this.data.currentRecordId);
      if (result && result.skipped) {
        const message = result.reason === 'SCORE_SOURCE_UNAVAILABLE'
          ? '原始照片已不可用，请重新上传'
          : '这次评分已经完成';
        this.setData({ scoreRepairError: message });
        wx.showToast({ title: message, icon: 'none', duration: 1800 });
        return;
      }

      this._loadCatData(this.catId);
      wx.showToast({ title: '评分已补回', icon: 'success' });
    } catch (error) {
      console.error('[CardDetail] 补评分失败:', error);
      const message = error && error.code === 'SCORE_INCOMPLETE'
        ? '这张照片暂时无法完成评分'
        : '补评分失败，请稍后再试';
      this.setData({ scoreRepairError: message });
      wx.showToast({ title: message, icon: 'none', duration: 1800 });
    } finally {
      this.setData({ scoreRepairBusy: false });
    }
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
        posterCopy: entry.posterCopy,
        visibility: storage.getCatVisibility(catId),
      },
      isShared: false,
      shareId: storage.getShareId(catId),
    });
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
        displayArchiveCode: archive.archiveCode || '',
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

  async _loadPublicGalleryArchive(publicCatId) {
    try {
      const result = await callPublicCatDetail(publicCatId);
      const archive = result && result.archive ? result.archive : {};
      const catalogCatId = archive.catalogCatId || archive.catId || '';
      const records = Array.isArray(archive.records)
        ? archive.records.map(record => this._mapSharedRecord(record, catalogCatId))
        : [];
      if (!catalogCatId || !records.length) throw new Error('这只猫咪暂时没有公开档案');

      this.catId = catalogCatId;
      this._applyArchiveView({
        catId: catalogCatId,
        rawRecords: records,
        featuredRecordId: archive.featuredRecordId || '',
        profile: archive.profile || {},
        displayArchiveCode: archive.archiveCode || '',
        isShared: true,
        shareId: '',
      });
      this.setData({ isPublicGalleryArchive: true });
    } catch (error) {
      if (error && error.code === 'CAT_FRIEND_NOT_FOUND') {
        console.warn('[CardDetail] 猫友公开档案不存在或已设为私密');
      } else {
        console.error('[CardDetail] 猫友公开档案加载失败:', error);
      }
      this.setData({
        shareLoading: false,
        shareError: error && error.code === 'CAT_FRIEND_NOT_FOUND'
          ? '这只猫咪已设为私密或暂时不可用'
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
    const coverTempURL = media.coverTempURL || item.coverTempURL || '';
    const location = item.location && typeof item.location === 'object'
      ? item.location
      : null;

    return {
      recordId,
      clientRecordId: item.localRecordId || item.clientRecordId || recordId,
      catId: item.catalogCatId || fallbackCatId,
      archiveCode: archiveIds.normalizeArchiveCode(item.archiveCode),
      catName: display.name || item.catName || '',
      catDescription: display.description || item.catDescription || '',
      posterCopy: display.posterCopy || item.posterCopy || '',
      copyVersion: display.copyVersion || item.copyVersion || '',
      // 档案详情只展示透明猫咪主体；原图和生图封面由其他业务入口单独使用。
      photoPath: cutoutTempURL,
      photo: originalTempURL,
      originalPhotoPath: originalTempURL,
      cutoutPhotoPath: cutoutTempURL,
      coverPhotoPath: coverTempURL,
      coverTempURL,
      originalFileID: media.originalFileID || item.originalFileID || '',
      cutoutFileID: media.cutoutFileID || item.cutoutFileID || '',
      coverFileID: media.coverFileID || item.coverFileID || '',
      coverStatus: media.coverStatus || item.coverStatus || '',
      posterResult: media.posterResult || item.posterResult || null,
      originalTempURL,
      cutoutTempURL,
      cutoutContentType: media.cutoutContentType || item.cutoutContentType || '',
      cutoutProvider: media.cutoutProvider || item.cutoutProvider || '',
      cutoutOperation: media.cutoutOperation || item.cutoutOperation || '',
      cutoutRequestId: media.cutoutRequestId || item.cutoutRequestId || '',
      cutoutCheckerboardRemoved: media.cutoutCheckerboardRemoved === true,
      sourceType: storage.normalizeSourceType(
        item.sourceType || item.captureSource || item.inputSource,
      ),
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
      location,
      locationStatus: item.locationStatus || (location ? 'captured' : 'unavailable'),
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
    displayArchiveCode = '',
    isShared = false,
    shareId = '',
  }) {
    const catData = getCatById(catId);
    if (!catData) throw new Error('无效的猫咪档案');

    const sourceRecords = Array.isArray(rawRecords) ? rawRecords : [];
    const requestedFeaturedIndex = featuredRecordId
      ? sourceRecords.findIndex(record => (
        (record.recordId || record.clientRecordId) === featuredRecordId
      ))
      : 0;
    const featuredIndex = requestedFeaturedIndex >= 0 ? requestedFeaturedIndex : 0;
    const featuredRecord = sourceRecords[featuredIndex] || null;
    const featuredRecordCode = archiveIds.normalizeArchiveCode(
      featuredRecord && featuredRecord.archiveCode,
    );
    const featuredRecordKey = featuredRecord
      ? (featuredRecord.recordId || featuredRecord.clientRecordId || '')
      : '';
    const archiveCode = featuredRecordCode
      || archiveIds.normalizeArchiveCode(displayArchiveCode)
      || (sourceRecords.length
        ? archiveIds.getOrCreateArchiveCode(
          `record:${catId}:${featuredRecordKey || 'latest'}`,
          featuredRecord && (featuredRecord.createdAt || featuredRecord.capturedAt)
            ? new Date(featuredRecord.createdAt || featuredRecord.capturedAt)
            : new Date(),
        )
        : '');
    const firstRecord = sourceRecords[sourceRecords.length - 1];
    const lastRecord = sourceRecords[0];
    const latestLocatedRecord = sourceRecords.find(record => (
      record
      && record.location
      && (!record.locationStatus || record.locationStatus === 'captured')
    ));
    const locationText = this._formatLocation(
      latestLocatedRecord && latestLocatedRecord.location,
      latestLocatedRecord && latestLocatedRecord.locationStatus,
    );
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
      posterCopy: profile.posterCopy
        || (lastRecord && lastRecord.posterCopy)
        || catData.posterCopy
        || '',
    };
    // 详情页展示当前猫咪最近一次相遇的评分，不把历史最高分误标为历史最佳。
    const currentEncounter = lastRecord ? catScoring.getStoredEncounter(lastRecord) : null;
    const currentLevel = catScoring.getLevelMeta(currentEncounter ? currentEncounter.levelCode : 'C');
    // 海报生成仍可使用原图或封面作为输入；这里只决定海报按钮是否可用，
    // 不参与档案主图的展示优先级。
    const hasAnyImage = sourceRecords.some(record => Boolean(
      record
      && (storage.getRecordDisplayPath(record)
        || record.photoPath
        || record.photo
        || record.originalPhotoPath
        || record.originalFileID
        || record.cutoutFileID)
    ));
    const posterEligible = Boolean(sourceRecords.length && hasAnyImage);
    const posterUnavailableReason = !sourceRecords.length
      ? '还没有可生成的相遇记录'
      : !hasAnyImage
        ? '还没有可用的猫咪照片'
        : '';
    const visibility = isShared
      ? 'public'
      : storage.normalizeVisibility(profile.visibility || storage.getCatVisibility(catId));

    this.catId = catId;
    this.isSharedArchive = isShared === true;
    this.shareId = isShared
      ? (shareId || this.shareId || '')
      : storage.getShareId(catId);
    this.setData({
      catData: displayCatData,
      featuredRecordId: featuredRecord
        ? (featuredRecord.recordId || featuredRecord.clientRecordId || '')
        : '',
      currentRecordId: lastRecord
        ? (lastRecord.recordId || lastRecord.clientRecordId || '')
        : '',
      featuredPhoto: featuredRecord
        ? storage.getRecordSubjectPath(featuredRecord)
        : '',
      shareId: this.shareId,
      isSharedArchive: this.isSharedArchive,
      shareLoading: false,
      shareError: '',
      currentLevelCode: currentLevel.code,
      currentSourceType: formatSourceType(featuredRecord && featuredRecord.sourceType),
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
      currentOriginalFileID: lastRecord && lastRecord.originalFileID
        ? lastRecord.originalFileID
        : '',
      scoreRepairError: '',
      posterEligible,
      posterUnavailableReason,
      archiveCode,
      fieldNoteText: displayCatData.story || '这次相遇，已经被轻轻收进档案里。',
      fieldNoteDate: lastRecord ? this._formatDate(lastRecord.createdAt) : '--',
      firstSeenText: firstRecord ? this._formatDate(firstRecord.createdAt) : '--',
      lastSeenText: lastRecord ? this._formatDate(lastRecord.createdAt) : '--',
      locationText,
      hasLocation: Boolean(locationText),
      publicVisibility: visibility,
      visibilityPublic: visibility === 'public',
      visibilityBusy: false,
      visibilityError: '',
    });
    this._refreshPhotoURL(featuredRecord);
  },

  _buildShareArchive(catId, rawRecords, featuredRecordId) {
    const catData = getCatById(catId) || {};
    const currentCatData = this.data.catData || {};
    const latest = rawRecords[0] || {};
    const featuredRecord = rawRecords.find(record => (
      (record.recordId || record.clientRecordId) === featuredRecordId
    )) || latest;
    const featuredRecordKey = featuredRecord.recordId || featuredRecord.clientRecordId || 'latest';
    const featuredArchiveCode = archiveIds.normalizeArchiveCode(featuredRecord.archiveCode)
      || archiveIds.getOrCreateArchiveCode(
        `record:${catId}:${featuredRecordKey}`,
        featuredRecord.createdAt || featuredRecord.capturedAt
          ? new Date(featuredRecord.createdAt || featuredRecord.capturedAt)
          : new Date(),
      );
    const traits = Array.isArray(latest.detectedTraits) && latest.detectedTraits.length
      ? latest.detectedTraits
      : (Array.isArray(catData.trait) ? catData.trait : []);

    return {
      catalogCatId: catId,
      featuredRecordId: featuredRecordId || (latest.recordId || latest.clientRecordId || ''),
      archiveCode: featuredArchiveCode,
      profile: {
        name: currentCatData.name || latest.catName || catData.name || '',
        description: currentCatData.story || latest.catDescription || catData.story || '',
        posterCopy: currentCatData.posterCopy || latest.posterCopy || '',
        breed: currentCatData.breed || latest.detectedBreed || catData.breed || '',
        traits: Array.isArray(currentCatData.trait) && currentCatData.trait.length
          ? currentCatData.trait
          : traits,
      },
      records: rawRecords.slice(0, 50).map(record => ({
        clientRecordId: record.clientRecordId || record.recordId,
        catalogCatId: catId,
        sourceType: storage.normalizeSourceType(record.sourceType),
        archiveCode: archiveIds.normalizeArchiveCode(record.archiveCode)
          || archiveIds.getOrCreateArchiveCode(
            `record:${catId}:${record.recordId || record.clientRecordId || 'latest'}`,
            record.createdAt || record.capturedAt
              ? new Date(record.createdAt || record.capturedAt)
              : new Date(),
          ),
        display: {
          name: record.catName || '',
          description: record.catDescription || '',
          posterCopy: record.posterCopy || '',
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

  async _refreshPhotoURL(record) {
    if (!record) return;

    // 本地拍摄记录通常已经有临时地址，不必再次请求云存储；共享记录也优先使用已有地址。
    const existingPath = storage.getRecordSubjectPath(record);
    if (existingPath) {
      if (this.data.featuredPhoto !== existingPath) this.setData({ featuredPhoto: existingPath });
      this._queueShareThumbnail(existingPath);
      return;
    }

    const fileIDs = [storage.getRecordSubjectFileID(record)].filter(Boolean);
    if (!fileIDs.length) return;

    try {
      let photoPath = '';
      for (const fileID of fileIDs) {
        try {
          photoPath = await cloudFiles.getTempFileURL(fileID);
          if (photoPath) break;
        } catch (error) {
          // 档案页不回退到原图或生图封面，避免把非透明图片当作猫咪主体。
        }
      }
      if (!photoPath) throw new Error('云存储文件地址不可用');
      this.setData({ featuredPhoto: photoPath });
      this._queueShareThumbnail(photoPath);
    } catch (error) {
      const fallback = storage.getRecordSubjectPath(record);
      this.setData({ featuredPhoto: fallback || '' });
      if (fallback) {
        this._queueShareThumbnail(fallback);
      }
      console.warn('[CardDetail] 获取主图地址失败:', error);
    }
  },

  _queueShareThumbnail(sourcePath) {
    if (!sourcePath || this._shareThumbnailSource === sourcePath) return;
    if (this._shareThumbnailTimer) clearTimeout(this._shareThumbnailTimer);
    this._shareThumbnailPath = '';
    this._shareThumbnailSource = '';
    this._shareThumbnailTimer = setTimeout(() => {
      this._shareThumbnailTimer = null;
      this._createShareThumbnail(sourcePath);
    }, 800);
  },

  _resolveShareImage(sourcePath) {
    if (!wx.getImageInfo) return Promise.resolve({ path: sourcePath, width: 1, height: 1 });
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: sourcePath,
        success: result => resolve({
          path: result.path || sourcePath,
          width: Number(result.width) || 1,
          height: Number(result.height) || 1,
        }),
        fail: reject,
      });
    });
  },

  _createShareThumbnail(sourcePath) {
    if (!sourcePath || typeof wx.createOffscreenCanvas !== 'function'
      || typeof wx.canvasToTempFilePath !== 'function') return;
    if (this._shareThumbnailPreparing === sourcePath) return;

    this._shareThumbnailPreparing = sourcePath;
    this._resolveShareImage(sourcePath)
      .then(imageInfo => new Promise((resolve, reject) => {
        let canvas;
        try {
          canvas = wx.createOffscreenCanvas({ type: '2d', width: 600, height: 480 });
        } catch (error) {
          reject(error);
          return;
        }

        const image = canvas.createImage();
        image.onload = () => {
          try {
            const context = canvas.getContext('2d');
            context.fillStyle = '#f8f1e7';
            context.fillRect(0, 0, 600, 480);
            context.fillStyle = '#fffdf8';
            context.fillRect(20, 58, 560, 332);
            context.strokeStyle = '#d7c5b3';
            context.lineWidth = 2;
            context.strokeRect(20, 58, 560, 332);

            context.fillStyle = '#9b442a';
            context.font = '700 18px sans-serif';
            context.fillText('猫咪咔咔', 32, 34);
            context.fillStyle = '#8c7569';
            context.font = '12px monospace';
            context.fillText('CITY CAT ARCHIVE', 32, 49);

            const sourceWidth = imageInfo.width || image.width || 1;
            const sourceHeight = imageInfo.height || image.height || 1;
            const scale = Math.min(360 / sourceWidth, 292 / sourceHeight);
            const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
            const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
            const drawX = Math.round((600 - drawWidth) / 2);
            const drawY = 76 + Math.round((292 - drawHeight) / 2);
            context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

            context.fillStyle = '#332824';
            context.font = '700 24px serif';
            context.fillText(
              String((this.data.catData && this.data.catData.name) || '一只猫').slice(0, 12),
              32,
              430,
            );
            context.fillStyle = '#9b442a';
            context.font = '12px monospace';
            context.fillText('CAT ARCHIVE · SHARE', 32, 456);
          } catch (error) {
            reject(error);
            return;
          }

          setTimeout(() => {
            wx.canvasToTempFilePath({
              canvas,
              x: 0,
              y: 0,
              width: 600,
              height: 480,
              destWidth: 600,
              destHeight: 480,
              fileType: 'jpg',
              quality: 0.86,
              success: result => resolve(result.tempFilePath),
              fail: reject,
            });
          }, 0);
        };
        image.onerror = reject;
        image.src = imageInfo.path;
      }))
      .then(thumbnailPath => {
        if (!thumbnailPath) return;
        this._shareThumbnailPath = thumbnailPath;
        this._shareThumbnailSource = sourcePath;
      })
      .catch(error => {
        console.warn('[CardDetail] 分享缩略图生成失败，使用主图兜底:', error);
      })
      .finally(() => {
        if (this._shareThumbnailPreparing === sourcePath) this._shareThumbnailPreparing = null;
      });
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

  goCollection() {
    if (this.returnToFriends) {
      wx.navigateBack({
        delta: 1,
        fail: () => wx.navigateTo({ url: '/pages/cat-friends/cat-friends' }),
      });
      return;
    }
    wx.switchTab({ url: '/pages/collection/collection' });
  },

  openDeleteConfirm() {
    if (this.isSharedArchive || !this.catId || !this.data.catData || this.data.deleteBusy) return;
    this.setData({ showDeleteConfirm: true, deleteError: '' });
  },

  async onVisibilityChange(event) {
    if (this.isSharedArchive || !this.catId || this.data.visibilityBusy) return;

    const nextVisibility = event && event.detail && event.detail.value === true
      ? 'public'
      : 'private';
    this.setData({ visibilityBusy: true, visibilityError: '' });
    try {
      await userData.setCatVisibility(this.catId, nextVisibility);
      this.setData({
        publicVisibility: nextVisibility,
        visibilityPublic: nextVisibility === 'public',
        visibilityBusy: false,
      });
      wx.showToast({
        title: nextVisibility === 'public' ? '已去猫友图鉴串门' : '已回自己的小窝',
        icon: 'success',
        duration: 1500,
      });
    } catch (error) {
      console.error('[CardDetail] 猫卡公开状态更新失败:', error);
      this.setData({
        visibilityBusy: false,
        visibilityError: '公开状态更新失败，请稍后再试。',
      });
      wx.showToast({ title: '公开状态更新失败', icon: 'none', duration: 1800 });
    }
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
        deleteError: '放归失败，请稍后再试。',
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

  _getShareImageUrl() {
    if (this._shareThumbnailPath) return this._shareThumbnailPath;
    if (this.data.featuredPhoto) return this.data.featuredPhoto;
    if (!this.catId) return '';

    const records = storage.getRecordsForCat(this.catId);
    const collection = storage.getCollection();
    const entry = collection[this.catId] || {};
    const featuredRecord = entry.featuredRecordId
      ? storage.getRecordById(entry.featuredRecordId)
      : records[0];
    return storage.getRecordSubjectPath(featuredRecord) || '';
  },

  onShareAppMessage() {
    const name = this.data.catData && this.data.catData.name
      ? this.data.catData.name
      : '一只猫';
    const shareId = this.isSharedArchive
      ? this.shareId
      : (this.catId && (storage.getShareId(this.catId) || storage.getOrCreateShareId(this.catId)));
    const publicCatId = this.isPublicGalleryArchive ? this.publicCatId : '';
    if (!this.isSharedArchive && this.catId && !this._shareReady) {
      this._prepareShare(this.catId, storage.getRecordsForCat(this.catId), this.data.featuredRecordId);
    }
    const share = {
      title: `我在街角遇见了「${name}」｜猫咪咔咔`,
      path: publicCatId
        ? `/pages/card-detail/card-detail?publicCatId=${encodeURIComponent(publicCatId)}`
        : shareId
        ? `/pages/card-detail/card-detail?shareId=${encodeURIComponent(shareId)}`
        : `/pages/card-detail/card-detail?catId=${encodeURIComponent(this.catId || '')}&from=share`,
    };
    const imageUrl = this._getShareImageUrl();
    if (imageUrl) share.imageUrl = imageUrl;
    return share;
  },

  onShareTimeline() {
    const name = this.data.catData && this.data.catData.name
      ? this.data.catData.name
      : '一只猫';
    const shareId = this.isSharedArchive
      ? this.shareId
      : (this.catId && (storage.getShareId(this.catId) || storage.getOrCreateShareId(this.catId)));
    const publicCatId = this.isPublicGalleryArchive ? this.publicCatId : '';
    if (!this.isSharedArchive && this.catId && !this._shareReady) {
      this._prepareShare(this.catId, storage.getRecordsForCat(this.catId), this.data.featuredRecordId);
    }
    const share = {
      title: `街角遇见「${name}」｜猫咪咔咔`,
      query: publicCatId
        ? `publicCatId=${encodeURIComponent(publicCatId)}`
        : shareId
        ? `shareId=${encodeURIComponent(shareId)}`
        : `catId=${encodeURIComponent(this.catId || '')}&from=timeline`,
    };
    const imageUrl = this._getShareImageUrl();
    if (imageUrl) share.imageUrl = imageUrl;
    return share;
  },
});

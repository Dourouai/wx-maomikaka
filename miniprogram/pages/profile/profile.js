// 个人主页：自己的主页与他人公开主页共用一套视觉，数据权限在视角层区分。
const storage = require('../../utils/storage');
const cloudFiles = require('../../utils/cloudFiles');
const profileSocial = require('../../utils/profileSocial');
const catScoring = require('../../utils/catScoring');
const memberLevel = require('../../utils/memberLevel');
const deviceLayout = require('../../utils/deviceLayout');
const { ALL_CATS } = require('../../utils/catData');
const APP_SHARE_IMAGE = '/assets/maomi-kaka-logo-square-144.png';

function toScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
}

function trimText(value, fallback, maxLength = 80) {
  const text = String(value || '').trim().slice(0, maxLength);
  return text || fallback;
}

function getLocalAvatarPath(value) {
  const path = String(value || '').trim();
  // 微信资料头像外链需要先换成云存储临时地址，不能直接交给 image 组件。
  return path && !/^https?:\/\//i.test(path) ? path : '';
}

function getTimestamp(value) {
  if (value && typeof value === 'object') {
    if (value.$date !== undefined) return getTimestamp(value.$date);
    if (value.value !== undefined) return getTimestamp(value.value);
    if (value.seconds !== undefined) return Number(value.seconds) * 1000;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getProfileMedia(record) {
  const value = record && typeof record === 'object' ? record : {};
  const posterResult = value.posterResult && typeof value.posterResult === 'object'
    ? value.posterResult
    : {};
  const coverImage = posterResult.coverImage && typeof posterResult.coverImage === 'object'
    ? posterResult.coverImage
    : {};
  const sourceImage = posterResult.sourceImage && typeof posterResult.sourceImage === 'object'
    ? posterResult.sourceImage
    : {};
  const coverPath = storage.getRecordPosterSourcePath(value);
  const coverFileID = storage.getRecordPosterSourceFileID(value);
  const coverStatus = String(
    value.coverStatus || posterResult.coverStatus || coverImage.status
      || (coverFileID ? 'ready' : ''),
  ).trim().toLowerCase();
  const subjectPath = storage.getRecordSubjectPath(value);
  const subjectFileID = storage.getRecordSubjectFileID(value);
  const originalPath = storage.getRecordOriginalPath(value);
  const originalFileID = String(
    value.originalFileID || sourceImage.originalFileID || '',
  ).trim();

  if (coverStatus === 'ready' && (coverPath || coverFileID)) {
    return {
      role: 'cover',
      path: coverPath,
      fileID: coverFileID,
      fallbackFileIDs: [subjectFileID, originalFileID].filter(Boolean),
      fallbackPaths: [subjectPath, originalPath].filter(Boolean),
    };
  }
  if (subjectPath || subjectFileID) {
    return {
      role: 'cutout',
      path: subjectPath,
      fileID: subjectFileID,
      fallbackFileIDs: [originalFileID].filter(Boolean),
      fallbackPaths: [originalPath].filter(Boolean),
    };
  }
  return {
    role: 'original',
    path: originalPath,
    fileID: originalFileID,
    fallbackFileIDs: [],
    fallbackPaths: [],
  };
}

Page({
  data: {
    isSelf: true,
    isPreview: false,
    isLoggedIn: false,
    profileName: '猫咪观察员',
    profileAvatar: '',
    profileRole: '街角漫游者 · 记录生活里的猫',
    profileBio: '记录生活里的猫',
    profileShareId: '',
    shareReady: false,
    shareBusy: false,
    isFollowing: false,
    followBusy: false,
    catList: [],
    catCount: 0,
    recordCount: 0,
    followerCount: 0,
    followingCount: 0,
    loading: false,
    loadError: '',
    emptyTitle: '这里还没有猫卡',
    emptySubtitle: '去相遇，留下第一张档案',
    pageHeaderTop: 48,
    headerRightInset: 0,
  },

  onLoad(options = {}) {
    this._syncDeviceLayout();
    const rawShareId = String(options.shareId || '').trim();
    try {
      this.profileShareId = rawShareId ? decodeURIComponent(rawShareId) : '';
    } catch (error) {
      this.profileShareId = '';
    }
    this.previewOther = String(options.preview || '').toLowerCase() === 'other';
    this.isSelf = !this.profileShareId && !this.previewOther;
    this.setData({
      isSelf: this.isSelf,
      isPreview: this.previewOther,
      profileShareId: this.profileShareId,
    });
  },

  onShow() {
    this._syncDeviceLayout();
    if (this.isSelf) {
      this._refreshSelf();
      return;
    }
    if (this.previewOther) {
      this._refreshPreviewOther();
      return;
    }
    this._loadPublicProfile();
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

  onAvatarError() {
    // 头像不存在或临时地址失效时，回退到猫咪咔咔 Logo。
    if (this.data.profileAvatar) this.setData({ profileAvatar: '' });
  },

  _refreshSelf() {
    const state = storage.getSyncState();
    const profile = storage.getUserProfile();
    const stats = storage.getUserStats();
    const membership = memberLevel.getMemberLevel(stats.pawGrowth);
    // 个人主页的列表规则是 cover → cutout → original；完整海报永远不进入列表。
    const catList = this._buildLocalCats();
    const isLoggedIn = state.userBound === true;
    const activeShareId = isLoggedIn ? String(this.profileShareId || '').trim() : '';
    this.profileShareId = activeShareId;

    this.setData({
      isSelf: true,
      isLoggedIn,
      profileName: trimText(profile.nickName, '猫咪观察员', 40),
      profileAvatar: profile.avatarFileID ? '' : getLocalAvatarPath(profile.avatarUrl),
      profileRole: '街角漫游者 · 记录生活里的猫',
      profileBio: membership.name ? `Lv.${membership.level} · ${membership.name}` : '记录生活里的猫',
      profileShareId: activeShareId,
      shareReady: Boolean(activeShareId),
      shareBusy: false,
      isFollowing: false,
      catList,
      catCount: catList.length,
      recordCount: storage.getAllRecords().length,
      followerCount: 0,
      followingCount: 0,
      loading: false,
      loadError: '',
      emptyTitle: isLoggedIn ? '这里还没有猫卡' : '登录后开启个人主页',
      emptySubtitle: isLoggedIn ? '去相遇，留下第一张档案' : '本机记录不会自动公开，先绑定当前微信账号',
    });
    if (isLoggedIn && !activeShareId) this._prepareShareInBackground();
    this._refreshAvatarURL(profile.avatarFileID, profile.avatarUrl);
    this._refreshPhotoURLs(catList);
  },

  _buildLocalCats() {
    const collection = storage.getCollection();
    const records = storage.getAllRecords();
    const recordsByCat = records.reduce((map, record) => {
      if (!record || !record.catId) return map;
      if (!map[record.catId]) map[record.catId] = [];
      map[record.catId].push(record);
      return map;
    }, {});

    return ALL_CATS.map(cat => {
      const entry = collection[cat.id] || {};
      const catRecords = (recordsByCat[cat.id] || [])
        .slice()
        .sort((left, right) => getTimestamp(right.createdAt) - getTimestamp(left.createdAt));
      if (!catRecords.length) return null;

      // 图片、评分、猫名和等级必须来自同一条当前记录，当前记录取最新一次相遇。
      const currentRecord = catRecords[0];
      const currentEncounter = catScoring.getStoredEncounter(currentRecord);
      const level = catScoring.getLevelMeta(
        currentEncounter && currentEncounter.levelCode ? currentEncounter.levelCode : 'C',
      );
      const media = getProfileMedia(currentRecord);
      const description = trimText(
        entry.displayDescription || (currentRecord && currentRecord.catDescription) || cat.story,
        cat.story,
        120,
      );

      return {
        id: cat.id,
        displayName: trimText(entry.displayName || (currentRecord && currentRecord.catName) || cat.name, cat.name, 40),
        levelCode: level.code,
        levelLabel: level.label,
        overallScore: toScore(currentEncounter && currentEncounter.overallScore),
        recordCount: catRecords.length,
        posterCopy: trimText(
          (currentRecord && currentRecord.posterCopy) || entry.posterCopy || description,
          description,
          52,
        ),
        description,
        archiveCode: trimText(currentRecord && currentRecord.archiveCode, '', 32),
        photoPath: media.path,
        photoFileID: media.fileID,
        photoRole: media.role,
        fallbackPhotoFileIDs: media.fallbackFileIDs,
        fallbackPhotoPaths: media.fallbackPaths,
      };
    }).filter(Boolean);
  },

  _refreshPreviewOther() {
    const catList = this._buildLocalCats();
    this.setData({
      isSelf: false,
      isPreview: true,
      isLoggedIn: true,
      profileName: '街角朋友',
      profileAvatar: '',
      profileRole: 'CITY CAT ARCHIVE · PUBLIC',
      profileBio: '分享一段和猫相遇的记录',
      profileShareId: '',
      shareReady: false,
      catList,
      catCount: catList.length,
      recordCount: storage.getAllRecords().length,
      followerCount: 12,
      followingCount: 8,
      isFollowing: false,
      loading: false,
      loadError: '',
      emptyTitle: '对方还没有公开猫卡',
      emptySubtitle: '等他记录下一次街角相遇',
    });
    this._refreshPhotoURLs(catList);
  },

  async _loadPublicProfile() {
    if (!this.profileShareId || this._publicLoading) return;
    this._publicLoading = true;
    const loadToken = Date.now();
    this._publicLoadToken = loadToken;
    this.setData({
      isSelf: false,
      isPreview: false,
      loading: true,
      loadError: '',
    });

    try {
      const result = await profileSocial.get(this.profileShareId);
      if (this._publicLoadToken !== loadToken) return;
      const profile = result && result.profile ? result.profile : {};
      const stats = result && result.stats ? result.stats : {};
      const catList = Array.isArray(result && result.cats)
        ? result.cats.map(item => this._normalizePublicCat(item)).filter(Boolean)
        : [];
      this.setData({
        isSelf: false,
        isLoggedIn: storage.getSyncState().userBound === true,
        profileName: trimText(profile.name, '街角观察员', 40),
        profileAvatar: profile.avatarTempURL || '',
        profileRole: 'CITY CAT ARCHIVE · PUBLIC',
        profileBio: '分享一段和猫相遇的记录',
        catList,
        catCount: Number(stats.catCount) || catList.length,
        recordCount: Number(stats.recordCount) || 0,
        followerCount: Number(stats.followerCount) || 0,
        followingCount: Number(stats.followingCount) || 0,
        isFollowing: stats.isFollowing === true,
        loading: false,
        loadError: '',
        emptyTitle: '对方还没有公开猫卡',
        emptySubtitle: '等他记录下一次街角相遇',
      });
      this._refreshPhotoURLs(catList);
    } catch (error) {
      if (this._publicLoadToken !== loadToken) return;
      this.setData({
        loading: false,
        loadError: this._getPublicErrorMessage(error),
        catList: [],
        catCount: 0,
        recordCount: 0,
        followerCount: 0,
        followingCount: 0,
      });
    } finally {
      this._publicLoading = false;
    }
  },

  _normalizePublicCat(item) {
    if (!item || !item.catalogCatId) return null;
    const levelCode = ['C', 'U', 'R', 'SR', 'UR'].includes(item.levelCode)
      ? item.levelCode
      : 'C';
    const level = catScoring.getLevelMeta(levelCode);
    return {
      id: item.catalogCatId,
      displayName: trimText(item.displayName, '未命名猫卡', 40),
      levelCode,
      levelLabel: trimText(item.levelLabel, level.label, 40),
      overallScore: toScore(item.overallScore),
      recordCount: Math.max(0, Number(item.recordCount) || 0),
      posterCopy: trimText(item.posterCopy, '在街角，留下这次安静的相遇。', 52),
      description: trimText(item.description, item.posterCopy || '在街角，留下这次安静的相遇。', 120),
      archiveCode: trimText(item.archiveCode, '', 32),
      photoPath: item.photoTempURL || '',
      photoFileID: String(item.photoFileID || '').trim(),
      originalPhotoPath: '',
    };
  },

  async _refreshAvatarURL(fileID, currentPath) {
    const localPath = getLocalAvatarPath(currentPath);
    if (!fileID) {
      if (localPath) {
        this.setData({ profileAvatar: localPath });
      }
      return;
    }

    try {
      const avatarUrl = await cloudFiles.getTempFileURL(fileID);
      if (avatarUrl) this.setData({ profileAvatar: avatarUrl });
    } catch (error) {
      // 头像临时地址失效时保留默认头像，不影响主页和猫卡列表。
    }
  },

  async _refreshPhotoURLs(catList) {
    await Promise.all((catList || []).map(async cat => {
      if (!cat || !cat.photoFileID) return;
      try {
        let photoPath = '';
        const fallbackFileIDs = Array.isArray(cat.fallbackPhotoFileIDs)
          ? cat.fallbackPhotoFileIDs
          : [cat.fallbackPhotoFileID];
        for (const fileID of [cat.photoFileID, ...fallbackFileIDs].filter(Boolean)) {
          try {
            photoPath = await cloudFiles.getTempFileURL(fileID);
            if (photoPath) break;
          } catch (error) {
            // 当前角色的地址失效时，按同一条记录的角色顺序回退，不回退到完整海报。
          }
        }
        if (!photoPath) {
          const fallbackPaths = Array.isArray(cat.fallbackPhotoPaths)
            ? cat.fallbackPhotoPaths
            : [];
          const fallbackPath = fallbackPaths.find(Boolean) || cat.photoPath || '';
          if (fallbackPath && fallbackPath !== cat.photoPath) {
            const index = this.data.catList.findIndex(item => item.id === cat.id);
            if (index >= 0) this.setData({ [`catList[${index}].photoPath`]: fallbackPath });
          }
          return;
        }
        const index = this.data.catList.findIndex(item => item.id === cat.id);
        if (index >= 0) this.setData({ [`catList[${index}].photoPath`]: photoPath });
      } catch (error) {
        const index = this.data.catList.findIndex(item => item.id === cat.id);
        const fallbackPaths = Array.isArray(cat.fallbackPhotoPaths)
          ? cat.fallbackPhotoPaths
          : [];
        const fallbackPath = fallbackPaths.find(Boolean) || cat.photoPath || '';
        if (index >= 0 && fallbackPath) {
          this.setData({
            [`catList[${index}].photoPath`]: fallbackPath,
          });
        }
      }
    }));
  },

  _prepareShareInBackground() {
    if (!this.isSelf || !this.data.isLoggedIn || this._sharePreparing || this.profileShareId) return;
    this._sharePreparing = true;
    this.setData({ shareBusy: true });
    profileSocial.create().then(result => {
      const shareId = String(result && (result.profileShareId || result.shareId) || '').trim();
      if (!shareId) throw new Error('PROFILE_SHARE_ID_EMPTY');
      this.profileShareId = shareId;
      this.setData({
        profileShareId: shareId,
        shareReady: true,
      });
    }).catch(error => {
      // 分享按钮直接走微信面板；服务未就绪时只记录日志，不再弹出“生成链接失败”。
      console.warn('[Profile] 公开主页分享参数准备失败:', error);
      this.setData({ shareReady: false });
    }).finally(() => {
      this._sharePreparing = false;
      this.setData({ shareBusy: false });
    });
  },

  async toggleFollow() {
    if (this.data.isSelf || this.data.followBusy || !this.profileShareId) return;
    if (storage.getSyncState().userBound !== true) {
      wx.showToast({ title: '先到“我的”绑定微信账号', icon: 'none', duration: 2200 });
      return;
    }
    this.setData({ followBusy: true });
    const nextFollowing = !this.data.isFollowing;
    try {
      const result = nextFollowing
        ? await profileSocial.follow(this.profileShareId)
        : await profileSocial.unfollow(this.profileShareId);
      this.setData({
        isFollowing: result && result.isFollowing === true,
        followerCount: Math.max(0, Number(this.data.followerCount) + (nextFollowing ? 1 : -1)),
      });
    } catch (error) {
      wx.showToast({ title: this._getPublicErrorMessage(error), icon: 'none', duration: 2200 });
    } finally {
      this.setData({ followBusy: false });
    }
  },

  openCat(event) {
    if (!this.data.isSelf) {
      const catId = String(event && event.currentTarget && event.currentTarget.dataset.catId || '');
      const cat = this.data.catList.find(item => String(item.id) === catId);
      if (cat && cat.photoPath) wx.previewImage({ current: cat.photoPath, urls: [cat.photoPath] });
      return;
    }
    const catId = String(event && event.currentTarget && event.currentTarget.dataset.catId || '').trim();
    if (catId) wx.navigateTo({ url: `/pages/card-detail/card-detail?catId=${encodeURIComponent(catId)}` });
  },

  goMy() {
    wx.switchTab({ url: '/pages/my/my' });
  },

  goCollection() {
    wx.switchTab({ url: '/pages/collection/collection' });
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: this.isSelf ? '/pages/my/my' : '/pages/collection/collection' }),
    });
  },

  retryLoad() {
    if (this.isSelf) {
      this._refreshSelf();
    } else if (this.previewOther) {
      this._refreshPreviewOther();
    } else {
      this._loadPublicProfile();
    }
  },

  _getPublicErrorMessage(error) {
    const code = String(error && (error.code || error.errCode) || '');
    const detail = String(error && (error.errMsg || error.message) || '').toLowerCase();
    if (code === 'CLOUD_NOT_READY' || code === 'FUNCTION_NOT_FOUND'
      || (detail.includes('function') && (detail.includes('not found') || detail.includes('不存在')))) {
      return '主页分享服务还在准备中';
    }
    if (code === 'PROFILE_SOCIAL_NOT_CONFIGURED') return '主页分享服务还在准备中';
    if (code === 'PROFILE_NOT_FOUND' || code === 'PROFILE_SHARE_ID_REQUIRED') return '这份个人主页已失效';
    if (code === 'CANNOT_FOLLOW_SELF') return '不能关注自己';
    if (code === 'IDENTITY_UNAVAILABLE') return '请先登录后再操作';
    if (code === 'PROFILE_SHARE_ID_EMPTY') return '分享码没有生成，请稍后再试';
    return '操作没有完成，请稍后再试';
  },

  onShareAppMessage() {
    const shareId = this.profileShareId || this.data.profileShareId;
    if (!shareId) {
      // 分享面板必须同步返回配置；后台参数尚未准备好时，保证分享路径仍然有效。
      this._prepareShareInBackground();
    }
    return {
      title: this.isSelf
        ? '我的猫咪咔咔个人主页'
        : `${this.data.profileName || '街角朋友'}的猫咪主页`,
      path: shareId
        ? `/pages/profile/profile?shareId=${encodeURIComponent(shareId)}`
        : '/pages/profile/profile',
      imageUrl: APP_SHARE_IMAGE,
    };
  },

  onShareTimeline() {
    const shareId = this.profileShareId || this.data.profileShareId;
    if (!shareId) this._prepareShareInBackground();
    return {
      title: `${this.data.profileName || '街角朋友'}的猫咪主页`,
      query: shareId ? `shareId=${encodeURIComponent(shareId)}` : '',
      imageUrl: APP_SHARE_IMAGE,
    };
  },
});

// 猫咪咔咔｜9:16 猫档案海报 Canvas 渲染器
// 这里是预览和最终导出共用的唯一排版入口；Canvas 绘制固定顺序的图标、属性名称和分数。
const posterData = require('./posterData');

const CANVAS_WIDTH = 750;
const CANVAS_HEIGHT = 1334;
const EXPORT_WIDTH = 1500;
const EXPORT_HEIGHT = 2668;
// 文案区域继续向右扩展，尽量贴近 MIKA 列，同时保留不重叠的安全边界。
const COPY_TEXT_WIDTH = 600;
const COPY_FONT_SIZE = 22;

const PAPER = '#F7F4EA';
const SURFACE = '#FFFDF8';
const INK = '#354438';
const MUTED = '#72806F';
const LINE = '#B9C7AE';
const LEVEL_TOKENS = {
  C: { border: '#8FA783', edge: '#A9B99F', edgeStart: '#D5DFCC', edgeEnd: '#91A786', wash: '#F8F8F3' },
  U: { border: '#9A8AA9', edge: '#B7A9C2', edgeStart: '#E0D7E7', edgeEnd: '#A696B2', wash: '#FBF9FC' },
  R: { border: '#B78445', edge: '#C9A269', edgeStart: '#E8C894', edgeEnd: '#BA8747', wash: '#FFFCF7' },
  SR: { border: '#B96B65', edge: '#D6A19A', edgeStart: '#EBC1BC', edgeEnd: '#C27A72', wash: '#FFFAF8' },
  UR: { border: '#665378', edge: '#8A789A', edgeStart: '#C4B6CF', edgeEnd: '#756483', wash: '#F9F7FB' },
};
const METRIC_LAYOUT = [
  { iconX: 76, labelX: 120, scoreX: 176 },
  { iconX: 316, labelX: 369, scoreX: 424 },
  { iconX: 548, labelX: 595, scoreX: 650 },
];

function createError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function tokenFor(levelCode) {
  return LEVEL_TOKENS[levelCode] || LEVEL_TOKENS.C;
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle, lineWidth = 1) {
  roundRectPath(ctx, x, y, width, height, radius);
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawText(ctx, text, x, y, options = {}) {
  ctx.save();
  ctx.fillStyle = options.color || INK;
  ctx.font = options.font || '24px sans-serif';
  ctx.textAlign = options.align || 'left';
  ctx.textBaseline = options.baseline || 'alphabetic';
  const value = text === null || text === undefined ? '' : text;
  ctx.fillText(String(value), x, y);
  ctx.restore();
}

function normalizeCanvasScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function wrapText(ctx, text, maxWidth, maxLines = 2, options = {}) {
  const characters = Array.from(String(text || ''));
  const lines = [];
  let line = '';
  characters.forEach(character => {
    const next = line + character;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = character;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  // 海报文案固定占两行：在可用宽度内优先按中间位置均衡分行，避免
  // 自然换行把第一行撑到 MIKA 分数附近，或出现“一长一短”的断行。
  if (options.forceTwoLines && characters.length > 1) {
    const preferred = Math.ceil(characters.length / 2);
    const punctuation = /[，。！？；、,:：!?;]/;
    const candidates = [];
    for (let index = 1; index < characters.length; index += 1) {
      const firstLine = characters.slice(0, index).join('');
      const secondLine = characters.slice(index).join('');
      if (ctx.measureText(firstLine).width > maxWidth
        || ctx.measureText(secondLine).width > maxWidth) {
        continue;
      }
      candidates.push({
        index,
        punctuation: punctuation.test(characters[index - 1]),
        distance: Math.abs(index - preferred),
      });
    }
    candidates.sort((left, right) => (
      left.distance - right.distance
      || Number(right.punctuation) - Number(left.punctuation)
    ));
    if (candidates.length) {
      const splitAt = candidates[0].index;
      return [
        characters.slice(0, splitAt).join(''),
        characters.slice(splitAt).join(''),
      ];
    }
  }
  if (lines.length <= maxLines) return lines;
  const lastIndex = maxLines - 1;
  let lastLine = lines.slice(lastIndex).join('');
  while (lastLine.length > 1 && ctx.measureText(`${lastLine}…`).width > maxWidth) {
    lastLine = lastLine.slice(0, -1);
  }
  lines.length = maxLines;
  lines[lastIndex] = `${lastLine}…`;
  return lines;
}

function drawCoverImage(ctx, image, sourceWidth, sourceHeight, rect) {
  const width = Math.max(1, sourceWidth || image.width || 1);
  const height = Math.max(1, sourceHeight || image.height || 1);
  const scale = Math.max(rect.width / width, rect.height / height);
  const cropWidth = rect.width / scale;
  const cropHeight = rect.height / scale;
  // 画面主体默认取中间略偏下的位置，避免把猫脚和落脚点裁掉。
  const sourceX = Math.max(0, (width - cropWidth) / 2);
  const sourceY = Math.max(0, Math.min(height - cropHeight, (height - cropHeight) * 0.42));
  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  );
}

function drawContainImage(ctx, image, sourceWidth, sourceHeight, rect) {
  const width = Math.max(1, sourceWidth || image.width || 1);
  const height = Math.max(1, sourceHeight || image.height || 1);
  const scale = Math.min(rect.width / width, rect.height / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  const drawX = rect.x + (rect.width - drawWidth) / 2;
  const drawY = rect.y + (rect.height - drawHeight) / 2;
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function drawCatIcon(ctx, centerX, centerY, size, color) {
  const half = size / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.moveTo(centerX - half * 0.78, centerY - half * 0.46);
  ctx.lineTo(centerX - half * 0.45, centerY - half * 0.9);
  ctx.lineTo(centerX - half * 0.08, centerY - half * 0.6);
  ctx.lineTo(centerX + half * 0.38, centerY - half * 0.9);
  ctx.lineTo(centerX + half * 0.78, centerY - half * 0.46);
  ctx.lineTo(centerX + half * 0.72, centerY + half * 0.42);
  ctx.quadraticCurveTo(centerX, centerY + half * 0.92, centerX - half * 0.72, centerY + half * 0.42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX - half * 0.28, centerY - half * 0.1, half * 0.06, 0, Math.PI * 2);
  ctx.arc(centerX + half * 0.28, centerY - half * 0.1, half * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(centerX, centerY + half * 0.06);
  ctx.lineTo(centerX - half * 0.08, centerY + half * 0.18);
  ctx.lineTo(centerX + half * 0.08, centerY + half * 0.18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centerX - half * 0.84, centerY + half * 0.02);
  ctx.lineTo(centerX - half * 1.02, centerY - half * 0.04);
  ctx.moveTo(centerX - half * 0.84, centerY + half * 0.24);
  ctx.lineTo(centerX - half * 1.04, centerY + half * 0.3);
  ctx.moveTo(centerX + half * 0.84, centerY + half * 0.02);
  ctx.lineTo(centerX + half * 1.02, centerY - half * 0.04);
  ctx.moveTo(centerX + half * 0.84, centerY + half * 0.24);
  ctx.lineTo(centerX + half * 1.04, centerY + half * 0.3);
  ctx.stroke();
  ctx.restore();
}

function drawEyeIcon(ctx, centerX, centerY, size, color) {
  const half = size / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(centerX - half, centerY);
  ctx.quadraticCurveTo(centerX, centerY - half * 0.75, centerX + half, centerY);
  ctx.quadraticCurveTo(centerX, centerY + half * 0.75, centerX - half, centerY);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX, centerY, half * 0.32, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centerX - half * 0.68, centerY - half * 0.94);
  ctx.lineTo(centerX - half * 0.82, centerY - half * 1.2);
  ctx.moveTo(centerX - half * 0.35, centerY - half * 1.04);
  ctx.lineTo(centerX - half * 0.4, centerY - half * 1.32);
  ctx.moveTo(centerX + half * 0.35, centerY - half * 1.04);
  ctx.lineTo(centerX + half * 0.4, centerY - half * 1.32);
  ctx.moveTo(centerX + half * 0.68, centerY - half * 0.94);
  ctx.lineTo(centerX + half * 0.82, centerY - half * 1.2);
  ctx.stroke();
  ctx.restore();
}

function drawMoonIcon(ctx, centerX, centerY, size, color) {
  const half = size / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(centerX, centerY, half * 0.76, Math.PI * 0.32, Math.PI * 1.72);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX + half * 0.3, centerY - half * 0.12, half * 0.78, Math.PI * 0.72, Math.PI * 1.34);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX + half * 0.86, centerY - half * 0.66, half * 0.08, 0, Math.PI * 2);
  ctx.arc(centerX + half * 0.92, centerY + half * 0.38, half * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawMetricIcon(ctx, key, x, y, color) {
  if (key === 'charm') return drawCatIcon(ctx, x, y, 44, color);
  if (key === 'cleverness') return drawEyeIcon(ctx, x, y, 44, color);
  return drawMoonIcon(ctx, x, y, 44, color);
}

function drawPoster(ctx, image, data) {
  const token = tokenFor(data.levelCode);
  const outerRect = { x: 16, y: 16, width: 718, height: CANVAS_HEIGHT - 32 };
  const imageRect = { x: 16, y: 16, width: 718, height: 1074 };
  const footerRect = { x: 16, y: 1090, width: 718, height: 228 };

  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  const scores = data && data.scores && typeof data.scores === 'object' ? data.scores : {};
  // 参考稿的外沿就是等级识别色；渐变只在外沿区域，不能进入照片或文字区。
  let edgeFill = token.edge;
  if (typeof ctx.createLinearGradient === 'function') {
    const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    gradient.addColorStop(0, token.edgeStart || token.edge);
    gradient.addColorStop(1, token.edgeEnd || token.edge);
    edgeFill = gradient;
  }
  ctx.fillStyle = edgeFill;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = SURFACE;
  ctx.fillRect(outerRect.x, outerRect.y, outerRect.width, outerRect.height);

  ctx.save();
  roundRectPath(ctx, imageRect.x, imageRect.y, imageRect.width, imageRect.height, 12);
  ctx.clip();
  ctx.fillStyle = token.wash;
  ctx.fillRect(imageRect.x, imageRect.y, imageRect.width, imageRect.height);
  if (data.sourceImage.kind === 'cutout') {
    drawContainImage(ctx, image, data.sourceImage.width, data.sourceImage.height, {
      x: imageRect.x + 24,
      y: imageRect.y + 24,
      width: imageRect.width - 48,
      height: imageRect.height - 48,
    });
  } else {
    drawCoverImage(ctx, image, data.sourceImage.width, data.sourceImage.height, imageRect);
  }
  ctx.restore();
  // 左上等级字母使用小型白底方标，避免标签侵入照片主体。
  fillRoundRect(ctx, 36, 36, 72, 72, 0, SURFACE, token.border, 1.5);
  drawText(ctx, data.levelCode, 72, 87, {
    color: INK,
    font: '38px serif',
    align: 'center',
  });

  const archiveText = String(data.archiveCode || '').trim();
  if (archiveText) {
    drawText(ctx, `No. ${archiveText}`, 704, 66, {
      color: SURFACE,
      font: '18px serif',
      align: 'right',
    });
  }

  // 白色信息区与照片直接相接，不再叠加旧版多重卡框和底部装饰线。
  ctx.fillStyle = SURFACE;
  ctx.fillRect(footerRect.x, footerRect.y, footerRect.width, footerRect.height);
  drawText(ctx, data.name, 54, 1149, {
    color: INK,
    font: '700 40px sans-serif',
  });

  drawText(ctx, 'MIKA', 650, 1147, {
    color: INK,
    font: '700 18px sans-serif',
    align: 'center',
  });
  drawText(ctx, normalizeCanvasScore(scores.mika), 650, 1194, {
    color: INK,
    font: '700 50px serif',
    align: 'center',
  });

  // 文案永远占两行的固定高度；短文案也固定分成两行，不能把评分区往上推。
  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = `${COPY_FONT_SIZE}px sans-serif`;
  const copyLines = wrapText(ctx, data.copy, COPY_TEXT_WIDTH, 2, { forceTwoLines: true });
  for (let index = 0; index < 2; index += 1) {
    if (copyLines[index]) ctx.fillText(copyLines[index], 54, 1201 + index * 30);
  }
  ctx.restore();

  posterData.METRIC_ORDER.forEach((metric, index) => {
    // 三组使用固定锚点，保证图标、属性文字、数值的左右间距不会溢出。
    const layout = METRIC_LAYOUT[index];
    drawMetricIcon(ctx, metric.key, layout.iconX, 1280, token.border);
    drawText(ctx, metric.label, layout.labelX, 1288, {
      color: INK,
      font: '16px sans-serif',
    });
    drawText(ctx, normalizeCanvasScore(scores[metric.key]), layout.scoreX, 1288, {
      color: INK,
      font: '18px serif',
    });
  });

  // 最后一笔描边收在画布内部，避免出现底部溢出或多余横线。
  ctx.save();
  ctx.strokeStyle = token.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(17, 17, 716, CANVAS_HEIGHT - 34);
  ctx.restore();
}

function loadCanvasImage(canvas, sourceImage) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = error => reject(error || createError('POSTER_IMAGE_LOAD_FAILED', '猫咪照片加载失败'));
    image.src = sourceImage.path;
  });
}

function exportCanvas(canvas) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        destWidth: EXPORT_WIDTH,
        destHeight: EXPORT_HEIGHT,
        fileType: 'png',
        quality: 1,
        success: result => {
          if (!result || !result.tempFilePath) {
            reject(createError('POSTER_EXPORT_EMPTY', '海报导出结果为空'));
            return;
          }
          resolve(result.tempFilePath);
        },
        fail: reject,
      });
    }, 0);
  });
}

async function renderPoster(data) {
  if (!data || data.eligible !== true) {
    throw createError('POSTER_NOT_READY', (data && data.unavailableReason) || '海报暂不可用');
  }
  if (!data.sourceImage || !data.sourceImage.path) {
    throw createError('POSTER_IMAGE_UNAVAILABLE', '还没有可用的猫咪照片');
  }
  if (typeof wx.createOffscreenCanvas !== 'function' || typeof wx.canvasToTempFilePath !== 'function') {
    throw createError('POSTER_CANVAS_UNSUPPORTED', '当前基础库不支持海报绘制');
  }

  let canvas;
  try {
    canvas = wx.createOffscreenCanvas({
      type: '2d',
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });
  } catch (error) {
    throw createError('POSTER_CANVAS_CREATE_FAILED', '海报画布创建失败');
  }

  const image = await loadCanvasImage(canvas, data.sourceImage);
  const context = canvas.getContext('2d');
  if (!context) throw createError('POSTER_CONTEXT_UNAVAILABLE', '海报画布暂时不可用');
  drawPoster(context, image, data);
  const tempFilePath = await exportCanvas(canvas);

  return {
    tempFilePath,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    ratio: '9:16',
    templateVersion: data.templateVersion,
  };
}

module.exports = {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  EXPORT_WIDTH,
  EXPORT_HEIGHT,
  renderPoster,
};

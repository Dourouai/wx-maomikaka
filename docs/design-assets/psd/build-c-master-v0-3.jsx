#target photoshop

// 猫咪咔咔 C 卡母版 v0.3。
// 目标：固定底纸在底部，L2/L3 为可替换图片，L4 为按组件分组的固定前景，
// L5 为顶部唯一的动态文字与数据智能对象。所有保留的固定图形同时登记为可编辑路径。

app.displayDialogs = DialogModes.NO;

var baseRoot = "/Volumes/LaCie/vipe-workspace/01-projects/maomi-kaka/docs/design-assets/psd/rarity-masters-v0-2/C/";
var vectorSpecsPath = baseRoot + "editable-vector-paths/vector-path-specs.jsxinc";
var doc;

var CORE_L4 = [
  "L4-01-frame-primary-line-C.png", "L4-02-frame-gold-line-C.png", "L4-04-frame-highlight-line-C.png",
  "L4-07-photo-recess-deep-C.png", "L4-10-photo-aperture-primary-C.png",
  "L4-20-number-fill-C.png", "L4-21-number-primary-line-C.png", "L4-22-number-inner-gold-line-C.png",
  "L4-26-score-fill-C.png", "L4-27-score-primary-line-C.png", "L4-28-score-gold-line-C.png",
  "L4-32-name-divider-C.png", "L4-34-flower-name-left-C.png", "L4-34-flower-name-right-C.png",
  "L4-41-metric-module-fill-C.png", "L4-42-metric-cell-1-fill-C.png", "L4-43-metric-cell-2-fill-C.png",
  "L4-44-metric-cell-3-fill-C.png", "L4-45-metric-module-primary-line-C.png", "L4-46-metric-module-gold-line-C.png",
  "L4-57-metric-divider-1-deep-C.png", "L4-60-metric-divider-2-deep-C.png",
  "L4-64-icon-charm-C.png", "L4-65-icon-clever-C.png", "L4-66-icon-aura-C.png"
];
var CORE_L4A = [
  "L4A-01-label-shadow-C.png", "L4A-02-label-fill-C.png",
  "L4A-03-label-primary-line-C.png", "L4A-04-label-inner-highlight-C.png"
];

function addGroup(name, parent) {
  var group = parent ? parent.layerSets.add() : doc.layerSets.add();
  group.name = name;
  return group;
}

function importRaster(path, name, parent, visible) {
  var file = new File(path);
  if (!file.exists) throw new Error("找不到素材：" + path);
  var source = app.open(file);
  var sourceLayer = source.activeLayer;
  var copied = sourceLayer.duplicate(doc, ElementPlacement.PLACEATBEGINNING);
  source.close(SaveOptions.DONOTSAVECHANGES);
  copied.name = name;
  copied.visible = visible !== false;
  copied.move(parent, ElementPlacement.PLACEATEND);
  return copied;
}

function contains(list, value) {
  for (var i = 0; i < list.length; i++) if (list[i] === value) return true;
  return false;
}

function sortedPngs(prefix, excludes) {
  var folder = new Folder(baseRoot);
  var files = folder.getFiles(function(item) {
    if (!(item instanceof File)) return false;
    if (!/\.png$/i.test(item.name)) return false;
    if (item.name.indexOf(prefix) !== 0) return false;
    for (var i = 0; i < excludes.length; i++) {
      if (item.name.indexOf(excludes[i]) >= 0) return false;
    }
    return true;
  });
  files.sort(function(a, b) {
    var aa = a.name.toLowerCase();
    var bb = b.name.toLowerCase();
    return aa < bb ? -1 : (aa > bb ? 1 : 0);
  });
  return files;
}

function importReverse(files, parent, displayPrefix) {
  // Component PNGs are registered bottom-to-top. Import in reverse so the
  // last registered treatment remains the uppermost Photoshop layer.
  for (var i = files.length - 1; i >= 0; i--) {
    var file = files[i];
    var layerName = displayPrefix + "｜" + file.name.replace(/\.png$/i, "");
    importRaster(file.fsName, layerName, parent, arguments.length < 4 ? true : arguments[3]);
  }
}

function rangePngs(minNumber, maxNumber, coreOnly) {
  var files = sortedPngs("L4-", ["composite", "rarity-label", "standalone", "L4-24-number-prefix", "L4-31-score-title"]);
  var result = [];
  for (var i = 0; i < files.length; i++) {
    var match = files[i].name.match(/^L4-(\d+)-/);
    if (!match) continue;
    var number = parseInt(match[1], 10);
    var isCore = contains(CORE_L4, files[i].name);
    if (number >= minNumber && number <= maxNumber && (coreOnly === null || isCore === coreOnly)) {
      result.push(files[i]);
    }
  }
  return result;
}

function rgb(hex) {
  var color = new SolidColor();
  color.rgb.hexValue = hex;
  return color;
}

function addText(name, value, x, y, size, color, parent, fontName, centered) {
  var layer = doc.artLayers.add();
  layer.name = name;
  layer.kind = LayerKind.TEXT;
  layer.textItem.contents = value;
  layer.textItem.size = new UnitValue(size, "px");
  layer.textItem.color = rgb(color);
  if (fontName) {
    try { layer.textItem.font = fontName; } catch (fontError) {}
  }
  if (centered) {
    try { layer.textItem.justification = Justification.CENTERJUSTIFIED; } catch (justifyError) {}
  }
  layer.textItem.position = [new UnitValue(x, "px"), new UnitValue(y, "px")];
  layer.move(parent, ElementPlacement.PLACEATBEGINNING);
  return layer;
}

function addParagraphText(name, value, x, y, width, height, size, color, parent, fontName) {
  var layer = doc.artLayers.add();
  layer.name = name;
  layer.kind = LayerKind.TEXT;
  layer.textItem.kind = TextType.PARAGRAPHTEXT;
  layer.textItem.position = [new UnitValue(x, "px"), new UnitValue(y, "px")];
  layer.textItem.width = new UnitValue(width, "px");
  layer.textItem.height = new UnitValue(height, "px");
  layer.textItem.contents = value;
  layer.textItem.size = new UnitValue(size, "px");
  layer.textItem.color = rgb(color);
  if (fontName) {
    try { layer.textItem.font = fontName; } catch (fontError) {}
  }
  layer.move(parent, ElementPlacement.PLACEATBEGINNING);
  return layer;
}

function loadVectorSpecs(path) {
  var file = new File(path);
  if (!file.exists) throw new Error("找不到路径源：" + path);
  file.open("r");
  var source = file.read();
  file.close();
  eval(source);
  if (typeof VECTOR_PATH_SPECS === "undefined") throw new Error("路径源没有 VECTOR_PATH_SPECS");
  return VECTOR_PATH_SPECS;
}

function addPathItem(name, points, closed) {
  var pathPoints = [];
  for (var i = 0; i < points.length; i++) {
    var point = new PathPointInfo();
    point.kind = PointKind.CORNERPOINT;
    point.anchor = [points[i][0], points[i][1]];
    point.leftDirection = [points[i][0], points[i][1]];
    point.rightDirection = [points[i][0], points[i][1]];
    pathPoints.push(point);
  }
  var subPath = new SubPathInfo();
  subPath.closed = closed;
  subPath.operation = ShapeOperation.SHAPEADD;
  subPath.entireSubPath = pathPoints;
  return doc.pathItems.add(name, [subPath]);
}

function addEditablePaths(specs) {
  var paths = specs["C"];
  for (var i = 0; i < paths.length; i++) {
    // v0.3 removes the old top-left plate entirely. Do not leave its
    // obsolete construction paths in the editable Paths panel either.
    if (paths[i].name.indexOf("label") >= 0) continue;
    addPathItem("可编辑路径｜" + paths[i].name, paths[i].points, paths[i].closed);
  }
}

function tryConvertGroupToSmartObject(group) {
  doc.activeLayer = group;
  try {
    executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
    return doc.activeLayer;
  } catch (error) {
    return null;
  }
}

function addDynamicTextSource() {
  var source = addGroup("L5_SOURCE｜双击编辑内容");
  var ink = "3D5241";
  var chineseFont = "STSong-Light";
  var latinFont = "Baskerville";

  addText("编号值｜MK-260903-000013", "MK-260903-000013", 444, 131, 20, ink, source, latinFont, false);
  addText("宠物名｜最多5字｜左对齐", "桃桃晒太阳", 104, 1000, 42, ink, source, chineseFont, false);
  addParagraphText("相遇文案｜最多50字｜左对齐", "午后的阳光刚刚好，\n遇见一只安静的猫。", 104, 1080, 415, 99, 22, ink, source, chineseFont);
  addText("咪咔分数｜0-100｜占位100", "100", 579, 1040, 42, ink, source, latinFont, true);
  addText("魅力分数｜0-100｜占位100", "100", 176, 1295, 30, ink, source, latinFont, true);
  addText("机灵分数｜0-100｜占位100", "100", 379, 1295, 30, ink, source, latinFont, true);
  addText("灵气分数｜0-100｜占位100", "100", 582, 1295, 30, ink, source, latinFont, true);

  var smart = tryConvertGroupToSmartObject(source);
  if (smart) {
    smart.name = "L5｜示例文字与数据｜智能对象｜顶部唯一动态层";
    return smart;
  }

  // Conversion is unavailable in some Photoshop builds. Keep the source
  // editable and put the single transparent Canvas render above it instead.
  source.name = "L5｜示例文字与数据｜编辑源（兼容模式）";
  source.visible = false;
  var raster = importRaster(baseRoot + "L5-demo-fields-100-placeholder-C-single-layer-v0-2.png", "L5｜示例文字与数据｜Canvas 单层｜顶部", doc, true);
  return raster;
}

function buildCMaster() {
  doc = app.documents.add(720, 1420, 72, "C-master-v0-3-editable", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);

  var ref = addGroup("00｜参考与辅助线｜隐藏不导出");
  ref.visible = false;

  // Groups are added bottom-to-top. Photoshop adds each new group at the top.
  var l1 = addGroup("L1｜母版底纸｜固定｜底部");
  importReverse(sortedPngs("L1-", ["composite"]), l1, "L1｜固定底纸");

  var l2 = addGroup("L2｜背景图｜可替换｜统一主图窗口");
  importRaster(baseRoot + "L2-background-replaceable-C.png", "L2｜示例背景｜可替换", l2, true);

  var l3 = addGroup("L3｜猫主体｜可替换｜透明 PNG");
  importRaster(baseRoot + "L3-cat-slot-placeholder-C.png", "L3｜猫主体占位｜可替换透明 PNG", l3, true);

  var l4 = addGroup("L4｜母版前景组件｜固定｜分色分线");
  var frame = addGroup("01｜外框｜主轮廓与高光", l4);
  var photo = addGroup("02｜主图窗口｜凹槽与内轮廓", l4);
  // These modules stay independent so they can be toggled/exported without
  // changing the surrounding frame.
  var number = addGroup("03｜编号牌｜独立组件｜底色、描边、固定 No.", l4);
  var score = addGroup("04｜咪咔圆章｜独立组件｜底色、描边、固定 MIKA", l4);
  var nameArea = addGroup("05｜名称区与装饰｜分隔线与叶片", l4);
  var metrics = addGroup("06｜指标模块｜独立组件｜三格与分隔线", l4);
  var metricFrame = addGroup("06-01｜指标容器｜底色与分隔线", metrics);
  var charmIcon = addGroup("06-02｜魅力图标｜独立图层", metrics);
  var cleverIcon = addGroup("06-03｜机灵图标｜独立图层", metrics);
  var auraIcon = addGroup("06-04｜灵气图标｜独立图层", metrics);
  var optional = addGroup("99｜可选高光细节｜默认隐藏", l4);

  importReverse(rangePngs(1, 6, true), frame, "外框核心");
  importReverse(rangePngs(7, 18, true), photo, "主图窗口核心");
  importReverse(rangePngs(19, 24, true), number, "编号牌核心");
  importReverse(rangePngs(25, 31, true), score, "咪咔圆章核心");
  importReverse(rangePngs(32, 39, true), nameArea, "名称区核心");
  importReverse(rangePngs(40, 63, true), metricFrame, "指标容器核心");
  importReverse(rangePngs(64, 64, true), charmIcon, "魅力图标核心");
  importReverse(rangePngs(65, 65, true), cleverIcon, "机灵图标核心");
  importReverse(rangePngs(66, 66, true), auraIcon, "灵气图标核心");
  importReverse(rangePngs(1, 66, false), optional, "可选细节", false);

  addText("固定文字｜No.", "No.", 398, 131, 18, "3D5241", number, "Baskerville", false);
  addText("固定文字｜MIKA", "MIKA", 578, 990, 16, "3D5241", score, "Baskerville", true);

  // v0.3: remove the plate/tag. The rarity is now a fixed, direct letter
  // sitting over the photo header, with no badge background or badge outline.
  var level = addGroup("L4A｜等级字母 C｜直接文字｜固定", l4);
  addText("固定文字｜等级字母 C｜轻微阴影", "C", 81, 154, 58, "3D5241", level, "Baskerville", false);
  addText("固定文字｜等级字母 C｜直接展示", "C", 78, 151, 58, "F9FDEF", level, "Baskerville", false);

  var l5 = addDynamicTextSource();

  addEditablePaths(loadVectorSpecs(vectorSpecsPath));

  var options = new PhotoshopSaveOptions();
  options.layers = true;
  options.embedColorProfile = true;
  doc.saveAs(new File(baseRoot + "cat-card-c-master-v0-3-editable.psd"), options, true, Extension.LOWERCASE);
  var previewOptions = new ExportOptionsSaveForWeb();
  previewOptions.format = SaveDocumentType.PNG;
  previewOptions.PNG8 = false;
  previewOptions.transparency = true;
  previewOptions.interlaced = false;
  previewOptions.quality = 100;
  doc.exportDocument(new File(baseRoot + "C-master-preview-v0-3-direct-letter.png"), ExportType.SAVEFORWEB, previewOptions);
  app.activeDocument = doc;
}

try {
  buildCMaster();
} catch (buildError) {
  var errorFile = new File(baseRoot + "build-c-master-v0-2-error.log");
  errorFile.encoding = "UTF8";
  errorFile.open("w");
  errorFile.write("C master build failed\n" + buildError.toString() + "\nline=" + buildError.line);
  errorFile.close();
  try { app.displayDialogs = DialogModes.ALL; } catch (dialogError) {}
  alert("C 母版构建失败：" + buildError.toString() + "（已写入 build-c-master-v0-2-error.log）");
}

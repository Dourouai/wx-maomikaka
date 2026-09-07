#target photoshop

// 猫咪咔咔 R / C / U / SR / UR 第一版母版（可编辑路径版 v0.7）。
// 五套 PSD 共用同一组坐标与图层结构，只替换对应等级的颜色皮肤和字母牌。
// 固定绘制元素的几何路径从 vector-path-specs.jsxinc 写入 Photoshop Paths 面板；
// L2/L3 仍是可替换 PNG，L5 仍是可编辑文字层。

app.displayDialogs = DialogModes.NO;

var baseRoot = "/Volumes/LaCie/vipe-workspace/01-projects/maomi-kaka/docs/design-assets/psd/rarity-masters-v0-7/";
var referencePath = "/Volumes/LaCie/vipe-workspace/01-projects/maomi-kaka/docs/design-assets/card-template-v5/reference/r-card-master-crop.png";
var vectorSpecsPath = baseRoot + "editable-vector-paths/vector-path-specs.jsxinc";
var codes = ["R", "C", "U", "SR", "UR"];
var doc;

function loadVectorSpecs(path) {
  var file = new File(path);
  if (!file.exists) {
    throw new Error("找不到可编辑路径源文件：" + path);
  }
  file.open("r");
  var source = file.read();
  file.close();
  eval(source);
  if (typeof VECTOR_PATH_SPECS === "undefined") {
    throw new Error("路径源文件没有导出 VECTOR_PATH_SPECS：" + path);
  }
  return VECTOR_PATH_SPECS;
}

function addPathItem(name, points, closed) {
  var pathPoints = [];
  for (var i = 0; i < points.length; i++) {
    var pathPoint = new PathPointInfo();
    pathPoint.kind = PointKind.CORNERPOINT;
    pathPoint.anchor = [points[i][0], points[i][1]];
    pathPoint.leftDirection = [points[i][0], points[i][1]];
    pathPoint.rightDirection = [points[i][0], points[i][1]];
    pathPoints.push(pathPoint);
  }
  var subPath = new SubPathInfo();
  subPath.closed = closed;
  subPath.operation = ShapeOperation.SHAPEADD;
  subPath.entireSubPath = pathPoints;
  return doc.pathItems.add(name, [subPath]);
}

function addEditablePaths(code, specs) {
  if (!specs) {
    throw new Error("没有找到 " + code + " 的固定图形路径定义");
  }
  for (var i = 0; i < specs.length; i++) {
    var item = specs[i];
    addPathItem("编辑路径｜" + item.name, item.points, item.closed);
  }
}

function addGroup(name) {
  var group = doc.layerSets.add();
  group.name = name;
  return group;
}

function importRaster(path, name, group, visible) {
  var source = app.open(new File(path));
  var sourceLayer = source.activeLayer;
  var copied = sourceLayer.duplicate(doc, ElementPlacement.PLACEATBEGINNING);
  source.close(SaveOptions.DONOTSAVECHANGES);
  copied.name = name;
  copied.visible = visible;
  copied.move(group, ElementPlacement.INSIDE);
  return copied;
}

function rgb(hex) {
  var c = new SolidColor();
  c.rgb.hexValue = hex;
  return c;
}

function addEditableText(name, value, x, y, size, color, group) {
  var layer = doc.artLayers.add();
  layer.name = name;
  layer.kind = LayerKind.TEXT;
  var ti = layer.textItem;
  ti.contents = value;
  ti.size = new UnitValue(size, "px");
  ti.color = rgb(color);
  ti.position = [new UnitValue(x, "px"), new UnitValue(y, "px")];
  layer.visible = false;
  layer.move(group, ElementPlacement.INSIDE);
  return layer;
}

function buildVariant(code) {
  var root = baseRoot + code + "/";
  var prefix = code + "-master-v0-7-editable-paths";
  var outputPath = baseRoot + "cat-card-" + code.toLowerCase() + "-master-v0-7-editable-paths.psd";
  doc = app.documents.add(720, 1420, 72, prefix, NewDocumentMode.RGB, DocumentFill.TRANSPARENT);

  // 参考层只用于对照，不参与最终合成。
  var refGroup = addGroup("00｜参考图｜R布局确认稿（不导出）");
  importRaster(referencePath, "确认稿｜R卡布局原图｜隐藏", refGroup, false);

  // 五组生产图层：几何完全固定，适配后续 Canvas 合成。
  var l1 = addGroup("L1｜固定相框｜" + code + "皮肤");
  var l2 = addGroup("L2｜背景图｜示例，可替换");
  var l3 = addGroup("L3｜猫主体｜占位，可替换为透明 PNG");
  var labelGroup = addGroup("L4A｜等级标签｜" + code + "独立素材｜位置锁定");
  var l4 = addGroup("L4｜固定装饰｜" + code + "边框／编号牌／咪咔底／指标图标");
  var l5 = addGroup("L5｜动态字段｜示例值 100（Canvas 可替换）");

  importRaster(root + "L1-fixed-frame-" + code + ".png", "绘制｜" + code + "相框底色与信息面板｜纸张高光", l1, true);
  importRaster(root + "L2-demo-background-replaceable-" + code + ".png", "示例｜街角背景图｜默认隐藏，替换此层", l2, false);
  importRaster(root + "L3-cat-slot-placeholder-replaceable-" + code + ".png", "占位｜猫主体插槽｜默认隐藏，替换此层", l3, false);
  importRaster(root + "L4-rarity-label-" + code + ".png", "独立绘制｜" + code + "等级标签｜固定位置与尺寸｜可单独替换", labelGroup, true);
  importRaster(root + "L4-fixed-decor-" + code + ".png", "绘制｜边框线／编号底／分数底／指标格与图标｜高光与浮雕阴影", l4, true);
  importRaster(root + "L5-demo-fields-100-placeholder-" + code + ".png", "示例字段｜桃桃晒太阳／编号／咪咔100／三项100", l5, true);

  // 真正可编辑的动态字段默认隐藏，避免与示例字段重复显示。
  addEditableText("字段｜编号主体｜MK-260903-000013（No. 固定在 L4）", "MK-260903-000013", 455, 117, 17, "713911", l5);
  addEditableText("字段｜宠物名｜最多5字｜左对齐", "桃桃晒太阳", 104, 978, 32, "713911", l5);
  addEditableText("字段｜咪咔总分｜0-100", "100", 579, 1030, 33, "713911", l5);
  addEditableText("字段｜文案｜不超过50字｜左对齐", "午后的阳光刚刚好，遇见一只安静的猫。", 104, 1110, 18, "713911", l5);
  addEditableText("字段｜魅力｜0-100", "100", 176, 1295, 23, "713911", l5);
  addEditableText("字段｜机灵｜0-100", "100", 379, 1295, 23, "713911", l5);
  addEditableText("字段｜灵气｜0-100", "100", 582, 1295, 23, "713911", l5);

  // 固定绘制元素的原始几何路径：在 Photoshop 的 Paths 面板中逐条可选、移动和编辑。
  // 路径不替代 L1/L4 的像素显示层，因此不会改变当前已确认的视觉效果。
  addEditablePaths(code, vectorSpecs[code]);

  doc.saveAs(new File(outputPath), new PhotoshopSaveOptions(), true, Extension.LOWERCASE);
  app.activeDocument = doc;
}

var vectorSpecs = loadVectorSpecs(vectorSpecsPath);

for (var i = 0; i < codes.length; i++) {
  buildVariant(codes[i]);
}

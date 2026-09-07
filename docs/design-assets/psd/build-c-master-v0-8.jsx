#target photoshop

// 猫咪咔咔 C 卡优化原型（v0.8）。
// 本脚本只生成 C，待规则确认后再将同一结构反推到其他等级。

app.displayDialogs = DialogModes.NO;

var baseRoot = "/Volumes/LaCie/vipe-workspace/01-projects/maomi-kaka/docs/design-assets/psd/rarity-masters-v0-8/C/";
var referencePath = "/Volumes/LaCie/vipe-workspace/01-projects/maomi-kaka/docs/design-assets/card-template-v5/reference/r-card-master-crop.png";
var vectorSpecsPath = baseRoot + "editable-vector-paths/vector-path-specs.jsxinc";
var doc;

function loadVectorSpecs(path) {
  var file = new File(path);
  if (!file.exists) throw new Error("找不到可编辑路径源文件：" + path);
  file.open("r");
  var source = file.read();
  file.close();
  eval(source);
  if (typeof VECTOR_PATH_SPECS === "undefined") throw new Error("路径源文件没有导出 VECTOR_PATH_SPECS");
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
  for (var i = 0; i < specs.length; i++) {
    addPathItem("编辑路径｜" + specs[i].name, specs[i].points, specs[i].closed);
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
  var color = new SolidColor();
  color.rgb.hexValue = hex;
  return color;
}

function addEditableText(name, value, x, y, size, color, group) {
  var layer = doc.artLayers.add();
  layer.name = name;
  layer.kind = LayerKind.TEXT;
  layer.textItem.contents = value;
  layer.textItem.size = new UnitValue(size, "px");
  layer.textItem.color = rgb(color);
  layer.textItem.position = [new UnitValue(x, "px"), new UnitValue(y, "px")];
  layer.visible = false;
  layer.move(group, ElementPlacement.INSIDE);
  return layer;
}

function buildC() {
  var root = baseRoot;
  doc = app.documents.add(720, 1420, 72, "C-master-v0-8-editable-paths", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);

  var refGroup = addGroup("00｜参考图｜R布局确认稿（不导出）");
  importRaster(referencePath, "确认稿｜R卡布局原图｜隐藏", refGroup, false);

  var l1 = addGroup("L1｜固定相框｜C皮肤");
  var l2 = addGroup("L2｜背景图｜示例，可替换");
  var l3 = addGroup("L3｜猫主体｜占位，可替换为透明 PNG");
  var labelGroup = addGroup("L4A｜等级标签｜C独立素材｜位置锁定");
  var l4 = addGroup("L4｜固定装饰｜C边框／编号牌／咪咔底／指标图标");
  var l5 = addGroup("L5｜动态字段｜示例值 100（Canvas 可替换）");

  importRaster(root + "L1-fixed-frame-C.png", "绘制｜C相框底色与信息面板｜纸张高光", l1, true);
  importRaster(root + "L2-demo-background-replaceable-C.png", "示例｜街角背景图｜默认隐藏，替换此层", l2, false);
  importRaster(root + "L3-cat-slot-placeholder-replaceable-C.png", "占位｜猫主体插槽｜默认隐藏，替换此层", l3, false);
  importRaster(root + "L4-rarity-label-C.png", "独立绘制｜C等级标签｜固定位置与尺寸｜可单独替换", labelGroup, true);
  importRaster(root + "L4-fixed-decor-C.png", "绘制｜边框线／编号底／分数底／指标格与图标｜高光与浮雕阴影", l4, true);
  importRaster(root + "L5-demo-fields-100-placeholder-C.png", "示例字段｜桃桃晒太阳／编号／咪咔100／三项100", l5, true);

  addEditableText("字段｜宠物名｜最多5字｜左对齐", "桃桃晒太阳", 104, 978, 32, "3D5241", l5);
  addEditableText("字段｜文案｜不超过50字｜左对齐", "午后的阳光刚刚好，遇见一只安静的猫。", 104, 1110, 18, "3D5241", l5);
  addEditableText("字段｜咪咔总分｜0-100", "100", 579, 1030, 33, "3D5241", l5);
  addEditableText("字段｜魅力｜0-100", "100", 176, 1295, 23, "3D5241", l5);
  addEditableText("字段｜机灵｜0-100", "100", 379, 1295, 23, "3D5241", l5);
  addEditableText("字段｜灵气｜0-100", "100", 582, 1295, 23, "3D5241", l5);

  addEditablePaths("C", vectorSpecs["C"]);
  doc.saveAs(new File(baseRoot + "cat-card-c-master-v0-8-editable-paths.psd"), new PhotoshopSaveOptions(), true, Extension.LOWERCASE);
  app.activeDocument = doc;
}

var vectorSpecs = loadVectorSpecs(vectorSpecsPath);
buildC();

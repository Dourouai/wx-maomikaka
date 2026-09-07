#target photoshop

// 猫咪咔咔 C 卡分色分线母版（v0.9）。
// 图层顺序：L1 底纸 → L2 背景 → L3 猫 → L4 固定装饰 → L4A 等级标签 → L5 动态字段。

app.displayDialogs = DialogModes.NO;

var baseRoot = "/Volumes/LaCie/vipe-workspace/01-projects/maomi-kaka/docs/design-assets/psd/rarity-masters-v0-9/C/";
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
  copied.move(group, ElementPlacement.PLACEATEND);
  return copied;
}

function rgb(hex) {
  var color = new SolidColor();
  color.rgb.hexValue = hex;
  return color;
}

function addText(name, value, x, y, size, color, group, visible) {
  var layer = doc.artLayers.add();
  layer.name = name;
  layer.kind = LayerKind.TEXT;
  layer.textItem.contents = value;
  layer.textItem.size = new UnitValue(size, "px");
  layer.textItem.color = rgb(color);
  layer.textItem.position = [new UnitValue(x, "px"), new UnitValue(y, "px")];
  layer.visible = visible;
  layer.move(group, ElementPlacement.PLACEATBEGINNING);
  return layer;
}

function importPlan(group, plan) {
  // plan is top-to-bottom; PLACEATEND preserves that visible order.
  for (var i = 0; i < plan.length; i++) {
    importRaster(baseRoot + plan[i][0], plan[i][1], group, true);
  }
}

function buildC() {
  doc = app.documents.add(720, 1420, 72, "C-master-v0-9-layered-editable-paths", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);

  var refGroup = addGroup("00｜参考图｜R布局确认稿（不导出）");
  refGroup.visible = false;
  importRaster(referencePath, "参考｜R卡布局原图｜隐藏", refGroup, false);

  var l1 = addGroup("L1｜固定相框｜C皮肤｜分色底纸与高光");
  var l2 = addGroup("L2｜背景图｜可替换｜照片窗口裁切");
  var l3 = addGroup("L3｜猫主体｜可替换｜透明 PNG");
  var l4 = addGroup("L4｜固定装饰｜分色与分线｜位置锁定");
  var labelGroup = addGroup("L4A｜等级标签｜C独立素材｜分色与分线｜位置锁定");
  var l5 = addGroup("L5｜动态字段｜分字段｜Canvas 可替换");

  importPlan(l1, [
    ["L1-07-paper-highlight-C.png", "L1-07｜纸张高光与纹理｜颜色层"],
    ["L1-06-photo-shadow-C.png", "L1-06｜主图槽位阴影｜颜色层"],
    ["L1-05-panel-inner-C.png", "L1-05｜信息区内底色｜颜色层"],
    ["L1-04-panel-C.png", "L1-04｜信息区底色｜颜色层"],
    ["L1-03-surface-C.png", "L1-03｜内侧纸面底色｜颜色层"],
    ["L1-02-shell-inner-C.png", "L1-02｜内壳底色｜颜色层"],
    ["L1-01-outer-gradient-C.png", "L1-01｜外框渐变底色｜颜色层"],
  ]);

  importPlan(l2, [
    ["L2-background-replaceable-C.png", "L2｜背景图｜示例，可替换"],
  ]);
  importPlan(l3, [
    ["L3-cat-slot-placeholder-C.png", "L3｜猫主体占位｜示例，可替换透明 PNG"],
  ]);

  importPlan(l4, [
    ["L4-13-score-title-C.png", "L4-13｜固定文字 MIKA｜颜色层"],
    ["L4-12-number-prefix-C.png", "L4-12｜固定文字 No.｜颜色层"],
    ["L4-11-icons-C.png", "L4-11｜三项指标图标线｜线稿层"],
    ["L4-10-decor-color-C.png", "L4-10｜叶片装饰色｜颜色层"],
    ["L4-09-gold-corner-points-C.png", "L4-09｜窗口金色定位点｜颜色层"],
    ["L4-08-highlight-lines-C.png", "L4-08｜高光线｜线稿层"],
    ["L4-07-deep-lines-C.png", "L4-07｜内侧深线｜线稿层"],
    ["L4-06-gold-lines-C.png", "L4-06｜金色线与铆点｜线稿层"],
    ["L4-05-primary-lines-C.png", "L4-05｜主边线｜线稿层"],
    ["L4-04-metric-fill-C.png", "L4-04｜指标模块底色｜颜色层"],
    ["L4-03-score-fill-C.png", "L4-03｜咪咔徽章底色｜颜色层"],
    ["L4-02-number-fill-C.png", "L4-02｜编号牌底色｜颜色层"],
    ["L4-01-shadows-C.png", "L4-01｜浮雕阴影色｜颜色层"],
  ]);

  importPlan(labelGroup, [
    ["L4A-06-label-letter-C.png", "L4A-06｜等级字母 C｜独立颜色层"],
    ["L4A-05-label-gold-detail-C.png", "L4A-05｜等级标签金色细节｜线稿层"],
    ["L4A-04-label-highlight-line-C.png", "L4A-04｜等级标签内高光线｜线稿层"],
    ["L4A-03-label-primary-line-C.png", "L4A-03｜等级标签主边线｜线稿层"],
    ["L4A-02-label-fill-C.png", "L4A-02｜等级标签底色渐变｜颜色层"],
    ["L4A-01-label-shadow-C.png", "L4A-01｜等级标签阴影色｜颜色层"],
  ]);

  importPlan(l5, [
    ["L5-08-aura-C.png", "L5-08｜动态灵气分数｜画面层"],
    ["L5-07-clever-C.png", "L5-07｜动态机灵分数｜画面层"],
    ["L5-06-charm-C.png", "L5-06｜动态魅力分数｜画面层"],
    ["L5-05-score-C.png", "L5-05｜动态咪咔分数｜画面层"],
    ["L5-04-copy-line-two-C.png", "L5-04｜动态文案第二行｜画面层｜左对齐"],
    ["L5-03-copy-line-one-C.png", "L5-03｜动态文案第一行｜画面层｜左对齐"],
    ["L5-02-pet-name-C.png", "L5-02｜动态宠物名｜画面层｜最多5字｜左对齐"],
    ["L5-01-number-value-C.png", "L5-01｜动态编号值｜画面层｜Canvas 替换"],
  ]);

  // Dynamic fields stay as hidden editable text layers beside their exact
  // raster field layers. Canvas can replace the raster layers at export time;
  // designers can turn on these text layers for quick edits in Photoshop.
  addText("字段｜灵气｜0-100｜可编辑文字", "100", 582, 1295, 23, "3D5241", l5, false);
  addText("字段｜机灵｜0-100｜可编辑文字", "100", 379, 1295, 23, "3D5241", l5, false);
  addText("字段｜魅力｜0-100｜可编辑文字", "100", 176, 1295, 23, "3D5241", l5, false);
  addText("字段｜咪咔总分｜0-100｜可编辑文字", "100", 579, 1030, 33, "3D5241", l5, false);
  addText("字段｜文案第二行｜不超过50字｜左对齐", "遇见一只安静的猫。", 104, 1136, 18, "3D5241", l5, false);
  addText("字段｜文案第一行｜不超过50字｜左对齐", "午后的阳光刚刚好，", 104, 1097, 18, "3D5241", l5, false);
  addText("字段｜宠物名｜最多5字｜左对齐", "桃桃晒太阳", 104, 978, 32, "3D5241", l5, false);
  addText("字段｜编号｜唯一编号值｜可编辑文字", "MK-260903-000013", 493, 119, 23, "3D5241", l5, false);

  addText("固定文字｜等级字母 C｜可编辑文字", "C", 92, 151, 64, "3D5241", labelGroup, false);
  addText("固定文字｜编号前缀 No.｜可编辑文字", "No.", 398, 131, 18, "3D5241", l4, false);
  addText("固定文字｜咪咔标题 MIKA｜可编辑文字", "MIKA", 578, 990, 16, "3D5241", l4, false);

  // Photoshop creates new groups at the top. Move them explicitly to the
  // required bottom-to-top order so the layer stack cannot depend on defaults.
  var stack = [refGroup, l1, l2, l3, l4, labelGroup, l5];
  for (var s = 0; s < stack.length; s++) {
    stack[s].move(doc, ElementPlacement.PLACEATEND);
  }

  addEditablePaths("C", vectorSpecs["C"]);
  doc.saveAs(new File(baseRoot + "cat-card-c-master-v0-9-layered-editable-paths.psd"), new PhotoshopSaveOptions(), true, Extension.LOWERCASE);
  app.activeDocument = doc;
}

var vectorSpecs = loadVectorSpecs(vectorSpecsPath);
buildC();

#target photoshop

// 猫咪咔咔 R 卡：透明主图窗口优化版 PSD。
// 每个视觉模块来自独立透明 PNG，文字同时保留为可编辑字段（默认隐藏，便于后续接 Canvas 数据）。

app.displayDialogs = DialogModes.NO;

var root = "/Volumes/LaCie/vipe-workspace/01-projects/maomi-kaka/docs/design-assets/psd/r-master-layers-v0-8/";
var outputPath = "/Volumes/LaCie/vipe-workspace/01-projects/maomi-kaka/docs/design-assets/psd/cat-card-r-master-v0-8.psd";
var referencePath = "/Volumes/LaCie/vipe-workspace/01-projects/maomi-kaka/docs/design-assets/card-template-v5/reference/r-card-master-crop.png";

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

var doc = app.documents.add(720, 1420, 72, "cat-card-r-master-v0-8", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);

// 参考层只用于对照，不参与最终合成。
var refGroup = addGroup("00｜参考图｜确认稿（不导出）");
var refLayer = importRaster(referencePath, "确认稿｜R卡原图｜隐藏", refGroup, false);

// 真实绘制的五个生产图层。
var l1 = addGroup("L1｜固定相框｜R皮肤");
var l2 = addGroup("L2｜背景图｜示例，可替换");
var l3 = addGroup("L3｜猫主体｜占位，可替换为透明 PNG");
var l4 = addGroup("L4｜固定装饰｜R字母牌／编号牌／咪咔底／指标图标");
var l5 = addGroup("L5｜动态字段｜示例值 100（Canvas 可替换）");

importRaster(root + "L1-fixed-frame-R.png", "绘制｜R相框底色与信息面板｜纸张高光", l1, true);
importRaster(root + "L2-demo-background-replaceable.png", "示例｜街角背景图｜默认隐藏，替换此层", l2, false);
importRaster(root + "L3-cat-slot-placeholder-replaceable.png", "占位｜猫主体插槽｜默认隐藏，替换此层", l3, false);
importRaster(root + "L4-fixed-decor-R.png", "绘制｜边框线／R字母牌／编号底／分数底／指标格与图标｜金属高光与浮雕阴影", l4, true);
importRaster(root + "L5-demo-fields-100-placeholder.png", "示例字段｜桃桃晒太阳／编号／咪咔100／三项100", l5, true);

// 真正可编辑的动态字段，先隐藏，避免和示例字段重复显示。
addEditableText("字段｜编号主体｜MK-260903-000013（No. 固定在 L4）", "MK-260903-000013", 455, 117, 17, "713911", l5);
addEditableText("字段｜宠物名｜最多5字", "桃桃晒太阳", 200, 978, 32, "713911", l5);
addEditableText("字段｜咪咔总分｜0-100", "100", 579, 1030, 33, "713911", l5);
addEditableText("字段｜文案｜不超过50字", "午后的阳光刚刚好，遇见一只安静的猫。", 187, 1110, 18, "713911", l5);
addEditableText("字段｜魅力｜0-100", "100", 176, 1295, 23, "713911", l5);
addEditableText("字段｜机灵｜0-100", "100", 379, 1295, 23, "713911", l5);
addEditableText("字段｜灵气｜0-100", "100", 582, 1295, 23, "713911", l5);

doc.saveAs(new File(outputPath), new PhotoshopSaveOptions(), true, Extension.LOWERCASE);
app.activeDocument = doc;

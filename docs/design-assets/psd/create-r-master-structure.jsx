#target photoshop

// 猫咪咔咔 R 卡母版：只创建 PSD 结构，不修改小程序代码。
// 参考图是底部锁定参考层；上方五层才是后续真正导出的图层。

app.displayDialogs = DialogModes.NO;

var canvasW = 720;
var canvasH = 1420;
var outputPath = "/Volumes/LaCie/vipe-workspace/01-projects/maomi-kaka/docs/design-assets/psd/cat-card-r-master-structure-v0-1.psd";
var referencePath = "/Volumes/LaCie/vipe-workspace/01-projects/maomi-kaka/docs/design-assets/card-template-v5/reference/r-card-master-crop.png";

function placeEmbedded(path) {
  var idPlace = charIDToTypeID("Plc ");
  var desc = new ActionDescriptor();
  desc.putPath(charIDToTypeID("null"), new File(path));
  desc.putEnumerated(charIDToTypeID("FTcs"), charIDToTypeID("QCSt"), charIDToTypeID("Qcsa"));
  executeAction(idPlace, desc, DialogModes.NO);
  return app.activeDocument.activeLayer;
}

function addNamedLayer(name) {
  var layer = app.activeDocument.artLayers.add();
  layer.name = name;
  return layer;
}

var doc = app.documents.add(
  canvasW,
  canvasH,
  72,
  "cat-card-r-master-structure",
  NewDocumentMode.RGB,
  DocumentFill.TRANSPARENT
);

// 参考图保持可见，方便在 Photoshop 中对照；开发导出时隐藏这一层。
var reference = placeEmbedded(referencePath);
reference.name = "参考图｜R卡确认稿｜锁定不导出";
reference.opacity = 100;

// 五个固定的开发图层，从底到顶排列。
addNamedLayer("L1｜固定相框｜R皮肤");
addNamedLayer("L2｜背景图｜仅填充图片窗口");
addNamedLayer("L3｜猫主体｜透明PNG");
addNamedLayer("L4｜固定装饰｜字母牌／编号牌／咪咔底／指标图标");
addNamedLayer("L5｜动态文字与数值｜Canvas字段");

// 统一安全线：背景和猫只允许落在图片窗口；文字使用下半区安全区。
var guideX = [56, 663, 155, 545];
var guideY = [81, 914, 945, 1202, 1212, 1384];
for (var i = 0; i < guideX.length; i++) {
  doc.guides.add(Direction.VERTICAL, new UnitValue(guideX[i], "px"));
}
for (var j = 0; j < guideY.length; j++) {
  doc.guides.add(Direction.HORIZONTAL, new UnitValue(guideY[j], "px"));
}

// 参考层在创建五个图层之前已位于底部；不再调用 move，避免不同 Photoshop 版本
// 对图层集合索引的兼容性问题。

doc.saveAs(new File(outputPath), new PhotoshopSaveOptions(), true, Extension.LOWERCASE);
app.activeDocument = doc;

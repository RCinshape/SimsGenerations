// Read only: private metadata belongs to the authenticated actor.
function linkedTreeAction_(me) {
  var sn = safe_(me);
  if (!sn) return res_(200, {tree:null});
  var tree = readJson_('linked-tree__' + sn + '.json', null);
  var valid = tree && typeof tree.label === 'string' && tree.label.trim().length > 0 && tree.label.length <= 80 && !/[\x00-\x1f\x7f]/.test(tree.label) &&
    typeof tree.url === 'string' && tree.url.length <= 300 && !/[\x00-\x20\x7f]/.test(tree.url) &&
    /^https:\/\/app\.thesimstree\.com\/(?:crafted\/pages\/dynasty\/tree\/[0-9]+|public\/tree\/[A-Za-z0-9_-]+)$/.test(tree.url);
  return res_(200, {tree:valid ? {label:tree.label.trim(), url:tree.url} : null});
}

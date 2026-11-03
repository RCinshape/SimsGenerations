// Read-only metadata for a visible player in the authenticated group.
function linkedTreeAction_(me, body) {
  body = body && typeof body === 'object' ? body : {};
  var owner = Object.prototype.hasOwnProperty.call(body, 'owner') ? body.owner : me;
  var sn = typeof owner === 'string' ? safe_(owner) : '', roster = roster_();
  if (!sn || !Object.prototype.hasOwnProperty.call(roster, sn) || !sameActor_(roster[sn], owner) || (!isTester_(me) && isTester_(sn))) return res_(404, {error:'not_found'});
  var tree = readJson_('linked-tree__' + sn + '.json', null);
  var valid = tree && typeof tree.label === 'string' && tree.label.trim().length > 0 && tree.label.length <= 80 && !/[\x00-\x1f\x7f]/.test(tree.label) &&
    typeof tree.url === 'string' && tree.url.length <= 300 && !/[\x00-\x20\x7f]/.test(tree.url) &&
    /^https:\/\/app\.thesimstree\.com\/(?:crafted\/pages\/dynasty\/tree\/[0-9]+|public\/tree\/[A-Za-z0-9_-]+)$/.test(tree.url);
  return res_(200, {tree:valid ? {label:tree.label.trim(), url:tree.url} : null});
}

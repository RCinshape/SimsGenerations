const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const previous=JSON.parse(fs.readFileSync(path.join(root,'updates/mod-update-v7.json'),'utf8'));
const update=JSON.parse(fs.readFileSync(path.join(root,'updates/mod-update-v8.json'),'utf8'));
const n=/\$PubN\s*=\s*'([a-f0-9]+)'/.exec(fs.readFileSync(path.join(root,'sync/LegacySync.ps1'),'utf8'))[1];
const key=crypto.createPublicKey({format:'jwk',key:{kty:'RSA',n:Buffer.from(n,'hex').toString('base64url'),e:'AQAB'}});
function canonical(u){return 'TGUPD1\n'+u.v+'\n'+Object.keys(u.files).sort().map(name=>name+'\n'+crypto.createHash('sha256').update(Buffer.from(u.files[name],'base64')).digest('hex')+'\n').join('');}
const verify=u=>crypto.verify('sha256',Buffer.from(canonical(u)),key,Buffer.from(u.sig,'base64'));
test('life collector update uses the existing trusted signature and complete payload',()=>{
 assert.equal(update.v,8);assert.ok(verify(previous));assert.ok(verify(update));
 for(const name of Object.keys(previous.files))assert.ok(name in update.files);
 assert.ok('twentygen_life.pyc' in update.files);
 assert.deepEqual(Object.keys(update.files).filter(name=>update.files[name]!==previous.files[name]).sort(),['twentygen_life.pyc','twentygen_sync.pyc']);
 assert.equal(Buffer.from(update.files['twentygen_life.pyc'],'base64').readUInt16LE(0),3394);
});
test('the existing key rejects changed or incomplete life-update payloads',()=>{
 const changed=JSON.parse(JSON.stringify(update));changed.files['twentygen_life.pyc']=Buffer.from('changed').toString('base64');
 assert.equal(verify(changed),false);
 const incomplete=JSON.parse(JSON.stringify(update));delete incomplete.files['twentygen_sync.pyc'];
 assert.equal(verify(incomplete),false);
 assert.ok(!canonical(update).includes('\r'));
});

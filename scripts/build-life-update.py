"""Build an UNSIGNED candidate with the existing game bytecode and new read-only addon.

Run with Python 3.7. This does not publish, sign, create a key, or change installed mods.
The existing v6 collector is preserved and gains only a final import of the addon.
"""
import base64
import dis
import hashlib
import json
import marshal
import pathlib
import py_compile
import sys
import types

COLLECTOR_SHA = 'a6b43a638508e1c842ac4237caa5dfa64cb01a3800b8ffac932ef62b7391e7ed'


def extend_collector(raw):
    if sys.version_info[:2] != (3,7):raise RuntimeError('use Python 3.7 to preserve game bytecode')
    if hashlib.sha256(raw).hexdigest()!=COLLECTOR_SHA:raise ValueError('collector baseline changed; review before building')
    code=marshal.loads(raw[16:])
    if code.co_code[-2:]!=bytes((dis.opmap['RETURN_VALUE'],0)):raise ValueError('unexpected module return')
    last=code.co_code[-4:]
    if last[0]!=dis.opmap['LOAD_CONST'] or code.co_consts[last[1]] is not None:raise ValueError('unexpected module tail')
    if any(i.argval>=len(code.co_code)-2 for i in dis.get_instructions(code) if i.opcode in dis.hasjabs):raise ValueError('jump targets module return')
    names=list(code.co_names);consts=list(code.co_consts)
    name_index=len(names);names.append('twentygen_life')
    zero=len(consts);consts.append(0)
    none=last[1]
    def instruction(op,arg=0):
        if arg>255:raise ValueError('extended argument requires explicit review')
        return bytes((dis.opmap[op],arg))
    tail=b''.join([instruction('LOAD_CONST',zero),instruction('LOAD_CONST',none),instruction('IMPORT_NAME',name_index),
                   instruction('STORE_NAME',name_index),instruction('LOAD_CONST',none),instruction('RETURN_VALUE')])
    patched=types.CodeType(code.co_argcount,code.co_kwonlyargcount,code.co_nlocals,max(code.co_stacksize,2),code.co_flags,
        code.co_code[:-4]+tail,tuple(consts),tuple(names),code.co_varnames,code.co_filename,code.co_name,
        code.co_firstlineno,code.co_lnotab,code.co_freevars,code.co_cellvars)
    assert patched.co_code[:-len(tail)]==code.co_code[:-4]
    assert patched.co_consts[:-1]==code.co_consts
    return raw[:16]+marshal.dumps(patched)


def build(original, destination):
    root=pathlib.Path(__file__).resolve().parent.parent
    bundle=json.loads(pathlib.Path(original).read_text(encoding='utf8'))
    if bundle.get('v')!=7:raise ValueError('expected the reviewed v7 update baseline')
    files=dict(bundle['files'])
    files['twentygen_sync.pyc']=base64.b64encode(extend_collector(base64.b64decode(files['twentygen_sync.pyc']))).decode('ascii')
    destination=pathlib.Path(destination);destination.mkdir(parents=True,exist_ok=True)
    pyc=destination/'twentygen_life.pyc'
    py_compile.compile(str(root/'sync/mod/twentygen_life.py'),cfile=str(pyc),dfile='twentygen_life.py',doraise=True)
    files['twentygen_life.pyc']=base64.b64encode(pyc.read_bytes()).decode('ascii')
    candidate={'v':8,'files':files}
    (destination/'mod-update-v8.UNSIGNED.json').write_text(json.dumps(candidate,separators=(',',':')),encoding='utf8')
    manifest='TGUPD1\n8\n'+''.join(n+'\n'+hashlib.sha256(base64.b64decode(files[n])).hexdigest()+'\n' for n in sorted(files))
    (destination/'signing-manifest.txt').write_bytes(manifest.encode('utf8'))
    print(json.dumps({'version':8,'signed':False,'files':sorted(files),'manifestSha256':hashlib.sha256(manifest.encode()).hexdigest()}))


if __name__=='__main__':
    if len(sys.argv)!=3:raise SystemExit('usage: python3.7 build-life-update.py BASELINE_V7.json OUTPUT_DIRECTORY')
    build(*sys.argv[1:])

"""Build an unsigned v9 candidate from the reviewed signed v8 bundle (Python 3.7)."""
import base64
import hashlib
import json
import pathlib
import py_compile
import sys

V8_SHA256 = '059ce3c85713a09556bf1a373598eaf76a2696fc4becacf36adc4209381dc2a8'

def build(baseline, destination):
    if sys.version_info[:2] != (3, 7):
        raise RuntimeError('use Python 3.7 for the game runtime')
    raw = pathlib.Path(baseline).read_bytes()
    if hashlib.sha256(raw).hexdigest() != V8_SHA256:
        raise ValueError('signed v8 baseline changed; review before building')
    bundle = json.loads(raw.decode('utf8'))
    if bundle.get('v') != 8 or 'twentygen_life.pyc' not in bundle['files']:
        raise ValueError('unexpected baseline')
    root = pathlib.Path(__file__).resolve().parent.parent
    destination = pathlib.Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    pyc = destination / 'twentygen_life.pyc'
    py_compile.compile(str(root / 'sync/mod/twentygen_life.py'), cfile=str(pyc),
                       dfile='twentygen_life.py', doraise=True)
    files = dict(bundle['files'])
    files['twentygen_life.pyc'] = base64.b64encode(pyc.read_bytes()).decode('ascii')
    candidate = {'v': 9, 'files': files}
    (destination / 'mod-update-v9.UNSIGNED.json').write_text(json.dumps(candidate, separators=(',', ':')), encoding='utf8')
    manifest = 'TGUPD1\n9\n' + ''.join(n + '\n' + hashlib.sha256(base64.b64decode(files[n])).hexdigest() + '\n' for n in sorted(files))
    (destination / 'signing-manifest.txt').write_bytes(manifest.encode('utf8'))
    print(json.dumps({'version': 9, 'signed': False, 'files': sorted(files)}))

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: python3.7 build-family-update.py SIGNED_V8.json OUTPUT_DIRECTORY')
    build(*sys.argv[1:])

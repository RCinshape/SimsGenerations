# Twenty-Gen Legacy - sender module.
# Sends the game file and the newest log lines to the group's Google relay, from inside the game.
# No other program runs: no PowerShell, no scheduled task, no curl.
#
# It tries two ways to make a secure (HTTPS) connection and keeps the first one that works:
#   "python"  - the game's own Python (ssl + urllib), if the game ships them
#   "windows" - Windows' own HTTPS (WinHTTP), called through ctypes, inside the game process
# All network work runs on one background thread, so the game never waits for it.
#
# Settings come from config.json inside this .ts4script (the app builds one file per player),
# or else from %LOCALAPPDATA%\TwentyGenSync\config.json (the optional PC helper writes that one).

import hashlib
import json
import os
import sys
import threading
import time

import twentygen_log as L

VERSION = 6
SIGN_N = "__SIGN_N__"      # public key (hex) for signed updates; the build fills it in. Unfilled = no updates.
UA = "TwentyGenSync/%d" % VERSION
MIN_GAP = 45               # seconds between two sends of a new game file
LOG_GAP = 300              # seconds between two sends that carry only log lines
BACKOFF = (60, 300, 900)   # wait after 1, 2, 3+ failed sends

_cfg = None
_cfg_from = ""
_lock = threading.Lock()
_wake = threading.Event()
_thread = None
_st = {
    "snap": None, "snap_hash": None, "sent_hash": None, "reason": "",
    "transport": None, "tried": {}, "fails": 0, "next_try": 0.0,
    "last_send": 0.0, "last_snap": 0.0, "last_ok": 0.0, "last_err": "", "hello": False, "stopped": "",
    "sims": "", "env": None, "upd_tried": 0, "upd_ready": 0,
}


# ---------------------------------------------------------------- settings

def _archive():
    ld = globals().get("__loader__")
    return getattr(ld, "archive", None)


def _valid(c):
    if not isinstance(c, dict):
        return False
    u, n, k = c.get("u"), c.get("n"), c.get("k")
    if not (isinstance(u, str) and isinstance(n, str) and isinstance(k, str) and n and k):
        return False
    if u.startswith("https://"):
        return True
    return u.startswith("http://localhost:") or u.startswith("http://127.0.0.1:")   # tests only


def load_config():
    global _cfg, _cfg_from
    arch = _archive()
    if arch:
        try:
            c = json.loads(__loader__.get_data(os.path.join(arch, "config.json")).decode("utf-8"))
            if _valid(c):
                _cfg, _cfg_from = c, "file"
                return _cfg
            L.log("config.json in this mod file is not valid", "warn")
        except (OSError, IOError, KeyError):
            pass
        except Exception as e:
            L.error("config.json in this mod file can't be read", e)
    lad = os.environ.get("LOCALAPPDATA")
    if lad:
        p = os.path.join(lad, "TwentyGenSync", "config.json")
        try:
            with open(p, "r", encoding="utf-8-sig") as f:
                c = json.load(f)
            if _valid(c):
                _cfg, _cfg_from = c, "pc-helper"
                return _cfg
        except (OSError, IOError):
            pass
        except Exception as e:
            L.error("PC helper config can't be read", e)
    _cfg, _cfg_from = None, ""
    return None


# ---------------------------------------------------------------- facts for the Health page

def _windows():
    try:
        v = sys.getwindowsversion()
        name = "Windows 11" if (v.major == 10 and v.build >= 22000) else ("Windows %d" % v.major if v.major != 6 else "Windows %d.%d" % (v.major, v.minor))
        return "%s (build %d)" % (name, v.build)
    except Exception:
        return sys.platform


def _game_version(sims_folder):
    import re
    try:
        with open(os.path.join(sims_folder, "GameVersion.txt"), "rb") as f:
            m = re.search(rb"\d+\.\d+\.\d+\.\d+", f.read(200))
        return m.group(0).decode() if m else ""
    except Exception:
        return ""


def _copies(sims_folder):
    """Every Twenty-Gen mod file in Mods (the game loads only one copy, so two is a problem)."""
    out = []
    mods = os.path.join(sims_folder, "Mods")
    try:
        for e in os.scandir(mods):
            if e.is_file() and e.name.lower().endswith(".ts4script") and "twentygen" in e.name.lower().replace("-", "").replace("_", ""):
                out.append(e.name)
            elif e.is_dir():
                try:
                    for e2 in os.scandir(e.path):
                        if e2.is_file() and e2.name.lower().endswith(".ts4script") and "twentygen" in e2.name.lower().replace("-", "").replace("_", ""):
                            out.append(e.name + "/" + e2.name)
                except Exception:
                    pass
    except Exception:
        pass
    return sorted(out)[:10]


def _has(mod):
    try:
        __import__(mod)
        return True
    except Exception:
        return False


def environment(sims_folder):
    arch = _archive()
    e = {
        "mod": VERSION, "py": sys.version.split()[0], "os": _windows(),
        "game": _game_version(sims_folder), "file": os.path.basename(arch) if arch else "",
        "copies": _copies(sims_folder), "ssl": _has("ssl"), "ctypes": _has("ctypes"),
        "cfg": _cfg_from, "transport": _st["transport"], "updReady": _st["upd_ready"],
    }
    return e


# ---------------------------------------------------------------- the two ways to send

def _post_python(url, body, timeout):
    import ssl
    import urllib.request
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": UA})
    ctx = ssl.create_default_context() if url.startswith("https://") else None
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:   # follows Google's 302 with a GET
        return r.getcode(), r.read()


def _winhttp():
    import ctypes
    from ctypes import wintypes
    w = ctypes.WinDLL("winhttp", use_last_error=True)
    H, DW, LP, B = ctypes.c_void_p, wintypes.DWORD, wintypes.LPCWSTR, wintypes.BOOL
    for name, res, args in (
            ("WinHttpOpen", H, [LP, DW, LP, LP, DW]),
            ("WinHttpConnect", H, [H, LP, wintypes.WORD, DW]),
            ("WinHttpOpenRequest", H, [H, LP, LP, LP, LP, ctypes.c_void_p, DW]),
            ("WinHttpSetTimeouts", B, [H, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]),
            ("WinHttpSetOption", B, [H, DW, ctypes.c_void_p, DW]),
            ("WinHttpSendRequest", B, [H, LP, DW, ctypes.c_void_p, DW, DW, ctypes.c_size_t]),
            ("WinHttpReceiveResponse", B, [H, ctypes.c_void_p]),
            ("WinHttpQueryHeaders", B, [H, DW, LP, ctypes.c_void_p, ctypes.POINTER(DW), ctypes.POINTER(DW)]),
            ("WinHttpQueryDataAvailable", B, [H, ctypes.POINTER(DW)]),
            ("WinHttpReadData", B, [H, ctypes.c_void_p, DW, ctypes.POINTER(DW)]),
            ("WinHttpCloseHandle", B, [H])):
        f = getattr(w, name)
        f.restype, f.argtypes = res, args
    return w


def _winhttp_once(w, session, method, url, body):
    """One request, redirects NOT followed (we follow them ourselves). Returns (status, data, location)."""
    import ctypes
    from ctypes import wintypes
    from urllib.parse import urlsplit
    DW = wintypes.DWORD

    def fail(step):
        raise OSError("WinHTTP %s failed (Windows error %d)" % (step, ctypes.get_last_error()))

    p = urlsplit(url)
    secure = p.scheme == "https"
    handles = []
    try:
        c = w.WinHttpConnect(session, p.hostname, p.port or (443 if secure else 80), 0)
        if not c:
            fail("connect")
        handles.append(c)
        path = (p.path or "/") + ("?" + p.query if p.query else "")
        r = w.WinHttpOpenRequest(c, method, path, None, None, None, 0x00800000 if secure else 0)   # 0x00800000 = secure (HTTPS)
        if not r:
            fail("request")
        handles.append(r)
        off = DW(2)                                        # WINHTTP_OPTION_DISABLE_FEATURE: WINHTTP_DISABLE_REDIRECTS
        w.WinHttpSetOption(r, 63, ctypes.byref(off), 4)
        if body:
            buf = ctypes.create_string_buffer(body, len(body))
            ok = w.WinHttpSendRequest(r, "Content-Type: application/json; charset=utf-8\r\n", 0xFFFFFFFF, buf, len(body), len(body), 0)
        else:
            ok = w.WinHttpSendRequest(r, None, 0, None, 0, 0, 0)
        if not ok:
            fail("send")
        if not w.WinHttpReceiveResponse(r, None):
            fail("receive")
        status, size = DW(0), DW(4)
        if not w.WinHttpQueryHeaders(r, 19 | 0x20000000, None, ctypes.byref(status), ctypes.byref(size), None):   # status code as a number
            fail("status")
        location = None
        if status.value in (301, 302, 303, 307, 308):
            size = DW(0)
            w.WinHttpQueryHeaders(r, 33, None, None, ctypes.byref(size), None)                  # 33 = Location: ask for the size first
            if size.value:
                loc = ctypes.create_unicode_buffer(size.value // 2 + 1)
                if w.WinHttpQueryHeaders(r, 33, None, loc, ctypes.byref(size), None):
                    location = loc.value
            if location:
                return status.value, b"", location           # the body of a redirect is not needed
        out = b""
        while True:
            avail = DW(0)
            if not w.WinHttpQueryDataAvailable(r, ctypes.byref(avail)):
                fail("read")
            if avail.value == 0:
                break
            chunk = ctypes.create_string_buffer(avail.value)
            got = DW(0)
            if not w.WinHttpReadData(r, chunk, avail.value, ctypes.byref(got)):
                fail("read")
            out += chunk.raw[:got.value]
            if len(out) > 1000000:
                break
        return status.value, out, location
    finally:
        for h in reversed(handles):
            w.WinHttpCloseHandle(h)


def _post_windows(url, body, timeout):
    """Windows' own HTTPS. Follows Google's redirect itself: POST, then GET the answer page."""
    from urllib.parse import urljoin
    w = _winhttp()
    s = w.WinHttpOpen(UA, 4, None, None, 0)          # 4 = automatic proxy (Windows 8.1 and later)
    if not s:
        s = w.WinHttpOpen(UA, 0, None, None, 0)      # 0 = the PC's default proxy setting
    if not s:
        import ctypes
        raise OSError("WinHTTP open failed (Windows error %d)" % ctypes.get_last_error())
    try:
        ms = int(timeout * 1000)
        w.WinHttpSetTimeouts(s, ms, ms, ms, ms)
        method, data = "POST", body
        for _ in range(6):
            status, out, location = _winhttp_once(w, s, method, url, data)
            if not location:
                return status, out
            nxt = urljoin(url, location)
            if url.startswith("https://") and not nxt.startswith("https://"):
                raise OSError("refused a redirect from HTTPS to HTTP")
            url = nxt
            if status in (301, 302, 303):
                method, data = "GET", None
        raise OSError("too many redirects")
    finally:
        w.WinHttpCloseHandle(s)


TRANSPORTS = (("python", _post_python), ("windows", _post_windows))


def post(url, payload, timeout=40):
    """Send with the way that worked last time, else try each way. Returns (answer dict, way)."""
    order = sorted(TRANSPORTS, key=lambda t: 0 if t[0] == _st["transport"] else 1)
    errors = []
    for name, fn in order:
        try:
            if isinstance(payload.get("e"), dict):
                payload["e"]["transport"] = name          # the way used for THIS send
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            code, data = fn(url, body, timeout)
            if code != 200:
                raise OSError("HTTP %s" % code)
            ans = json.loads(data.decode("utf-8", "replace"))
            if not isinstance(ans, dict):
                raise ValueError("answer is not an object")
            if _st["transport"] != name:
                L.log("sending works with the %s way" % name)
            _st["transport"] = name
            _st["tried"][name] = "ok"
            return ans, name
        except Exception as e:
            msg = "%s: %s" % (type(e).__name__, str(e)[:160])
            if _st["tried"].get(name) != msg:
                L.log("the %s way did not work: %s" % (name, msg), "warn")
            _st["tried"][name] = msg
            errors.append(name + ": " + msg)
    raise OSError("no way to send worked (" + "; ".join(errors) + ")")


# ---------------------------------------------------------------- what the game calls

def queue_snapshot(text, reason):
    h = hashlib.sha256(text.encode("utf-8")).hexdigest()
    with _lock:
        _st["snap"], _st["snap_hash"], _st["reason"] = text, h, reason
    _wake.set()


def send_now():
    with _lock:
        _st["next_try"] = 0.0
        _st["last_send"] = 0.0
        _st["last_snap"] = 0.0
        _st["force"] = True
    _wake.set()


def status():
    if _cfg is None:
        return "no settings found: download your game file from the app again"
    if _st["stopped"]:
        return "stopped: " + _st["stopped"]
    if _st["last_ok"]:
        s = "last sent %s via %s" % (time.strftime("%H:%M", time.localtime(_st["last_ok"])), _st["transport"])
    else:
        s = "nothing sent yet"
    if _st["last_err"]:
        s += "; last problem: " + _st["last_err"]
    return s


def _due(now):
    if _st["stopped"] or now < _st["next_try"]:
        return None
    force = _st.pop("force", False)
    new_snap = _st["snap"] is not None and _st["snap_hash"] != _st["sent_hash"]
    if new_snap and (force or now - _st["last_snap"] >= MIN_GAP):
        return "snap"
    lines, _ = L.take()
    if lines and (force or not _st["hello"] or L.has_errors() and now - _st["last_send"] >= 60 or now - _st["last_send"] >= LOG_GAP):
        return "log"
    if not _st["hello"]:
        return "log"
    return None


def _once(sims_folder):
    now = time.time()
    with _lock:
        what = _due(now)
        snap, snap_hash = (_st["snap"], _st["snap_hash"]) if what == "snap" else (None, None)
    if not what:
        return False
    lines, mark = L.take()
    env = environment(sims_folder)
    payload = {"v": VERSION, "n": _cfg["n"], "k": _cfg["k"], "l": lines, "e": env,
               "m": {"up": VERSION, "found": True, "mod": True, "via": "game"}}
    if snap is not None:
        payload["s"] = snap
        _st["last_snap"] = now
    _st["last_send"] = now
    try:
        ans, way = post(_cfg["u"], payload)
    except Exception as e:
        _st["fails"] += 1
        _st["last_err"] = str(e)[:300]
        wait = BACKOFF[min(_st["fails"], len(BACKOFF)) - 1]
        _st["next_try"] = time.time() + wait
        L.log("send failed (%d in a row), next try in %d min: %s" % (_st["fails"], wait // 60, _st["last_err"]), "error")
        return True
    if ans.get("ok"):
        L.ack(mark)
        _st["fails"], _st["last_err"], _st["hello"], _st["last_ok"] = 0, "", True, time.time()
        if snap_hash:
            _st["sent_hash"] = snap_hash
        if snap is not None:
            L.log("game file sent (%d KB, %s)%s" % (len(snap) // 1024 + 1, _st["reason"], " - no change" if ans.get("same") else ""))
        try:
            v = int(ans.get("upd") or 0)
            if v > VERSION and v > _st["upd_tried"] and v > _st["upd_ready"]:
                _st["upd_tried"] = v
                _update(v)
        except Exception as e:
            L.error("update failed", e)
        return True
    err = str(ans.get("error") or "refused")
    _st["last_err"] = err
    if err == "wrong_code":
        _st["stopped"] = "this game file's key was replaced. Download your game file from the app again and replace this one."
        L.log(_st["stopped"], "error")
    elif err == "slow_down":
        _st["next_try"] = time.time() + 600
        L.log("the relay asked to slow down; waiting 10 min", "warn")
    else:
        _st["fails"] += 1
        _st["next_try"] = time.time() + BACKOFF[min(_st["fails"], len(BACKOFF)) - 1]
        L.log("relay refused the send: " + err, "error")
    return True


# ---------------------------------------------------------------- signed updates

def verify_update(u):
    """The new game parts if the signature is right (made with the host's private key), else None."""
    import base64
    import re
    if not (SIGN_N and not SIGN_N.startswith("__")):
        return None
    files = u.get("files") or {}
    names = sorted(files)
    if not names or any(not re.match(r"^(twentygen_[a-z]+\.pyc|uploader\.ps1)$", n) for n in names):
        return None
    if "twentygen_sync.pyc" not in files or "twentygen_net.pyc" not in files:
        return None                                     # never install a partial update
    blobs, text = {}, "TGUPD1\n%d\n" % int(u["v"])
    for n in names:
        b = base64.b64decode(files[n])
        blobs[n] = b
        text += n + "\n" + hashlib.sha256(b).hexdigest() + "\n"
    N = int(SIGN_N, 16)
    k = (N.bit_length() + 7) // 8
    s = int.from_bytes(base64.b64decode(u.get("sig") or ""), "big")
    if not 0 < s < N:
        return None
    em = pow(s, 65537, N).to_bytes(k, "big")
    tail = b"\x00" + bytes.fromhex("3031300d060960864801650304020105000420") + hashlib.sha256(text.encode("utf-8")).digest()
    want = b"\x00\x01" + b"\xff" * (k - 3 - len(tail) + 1) + tail
    return blobs if em == want else None


def _update(v):
    import zipfile
    L.log("a newer game file (v%d) is waiting; getting it" % v)
    ans, _ = post(_cfg["u"], {"v": VERSION, "n": _cfg["n"], "k": _cfg["k"], "want": "update"})
    u = ans.get("update")
    if not u or int(u.get("v") or 0) != v:
        L.log("the update was not there", "warn")
        return
    blobs = verify_update(u)
    if blobs is None:
        L.log("update v%d REFUSED: the signature is not right. Nothing was changed." % v, "error")
        return
    arch = _archive()
    if not arch or not os.path.isfile(arch):
        L.log("update v%d is signed and fine, but this mod is not a .ts4script file; run the installer again" % v, "warn")
        return
    cfg = None
    try:
        cfg = __loader__.get_data(os.path.join(arch, "config.json"))
    except Exception:
        pass
    d = os.path.dirname(arch)
    while d and os.path.basename(d).lower() != "mods" and os.path.dirname(d) != d:
        d = os.path.dirname(d)
    folder = os.path.join(os.path.dirname(d), "LegacySync")
    tmp = arch + ".new"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
        for n in sorted(blobs):
            z.writestr(n, blobs[n])
        if cfg:
            z.writestr("config.json", cfg)
    try:
        import shutil
        if os.path.isdir(folder):
            shutil.copyfile(arch, os.path.join(folder, "backup-v%d.ts4script.bak" % VERSION))
    except Exception:
        pass
    try:
        os.replace(tmp, arch)
    except Exception as e:
        try:
            os.remove(tmp)
        except Exception:
            pass
        L.error("update v%d could not replace the game file (run the installer again to get it)" % v, e)
        return
    _st["upd_ready"] = v
    L.log("updated to v%d. Restart The Sims 4 to use it." % v)


def _loop(sims_folder):
    while True:
        try:
            _wake.wait(30)
            _wake.clear()
            while _once(sims_folder):
                time.sleep(1)
        except Exception as e:      # never let the thread die
            try:
                L.error("sender problem", e)
            except Exception:
                pass
            time.sleep(30)


def start(sims_folder):
    global _thread
    if _thread is not None:
        return True
    if load_config() is None:
        L.log("no settings found, so nothing is sent. The game file is still written on this PC. "
              "Download your own game file from the app (it has your settings inside).", "warn")
        return False
    L.log("settings found (%s) for %s; ssl=%s ctypes=%s; %s" % (_cfg_from, _cfg["n"], _has("ssl"), _has("ctypes"), _windows()))
    if not _has("ssl") and not _has("ctypes"):
        # The Sims 4's own Python has no HTTPS tools (seen on game 1.129). The PC sync (set up by the installer)
        # sends snapshot.json and this log instead. So: no thread, no error lines.
        L.log("this game can't send by itself; the PC sync sends your game file (every 5 minutes)")
        return False
    _thread = threading.Thread(target=_loop, args=(sims_folder,), name="TwentyGenSync", daemon=True)
    _thread.start()
    _wake.set()
    return True

# Twenty-Gen Legacy - log module.
# Writes <The Sims 4>/LegacySync/mod.log on this PC, and keeps the newest lines in memory
# so the sender can pass them on to the group's relay (the host sees them on the Health page).
# Needs nothing else. If the folder can't be written, it only keeps lines in memory.

import os
import threading
import time
import traceback

MAX_PENDING = 150          # lines kept for sending
MAX_LINE = 300             # characters per line
MAX_FILE = 256 * 1024      # mod.log is renamed to mod.old.log above this size

_lock = threading.Lock()
_pending = []              # [(seq, line)]
_seq = 0
_path = None
_home = os.path.expanduser("~")


def setup(folder):
    global _path
    try:
        if not os.path.isdir(folder):
            os.makedirs(folder)
        _path = os.path.join(folder, "mod.log")
    except Exception:
        _path = None


def _clean(msg):
    s = str(msg).replace("\r", " ").replace("\n", " | ")
    if _home and len(_home) > 3:
        s = s.replace(_home, "~").replace(_home.replace("\\", "/"), "~")
    return s[:MAX_LINE]


def log(msg, level="info"):
    global _seq
    line = "%s %-4s %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), level.upper()[:4], _clean(msg))
    with _lock:
        _seq += 1
        _pending.append((_seq, line))
        if len(_pending) > MAX_PENDING:
            del _pending[:len(_pending) - MAX_PENDING]
        if _path:
            try:
                if os.path.exists(_path) and os.path.getsize(_path) > MAX_FILE:
                    old = _path[:-4] + ".old.log"
                    if os.path.exists(old):
                        os.remove(old)
                    os.rename(_path, old)
                with open(_path, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
            except Exception:
                pass
    return line


def error(msg, exc=None):
    if exc is not None:
        tb = traceback.format_exception_only(type(exc), exc)[-1].strip()
        msg = "%s: %s" % (msg, tb)
    return log(msg, "error")


def take():
    """Lines not sent yet, and a mark to pass to ack() after a successful send."""
    with _lock:
        return [l for _, l in _pending], (_pending[-1][0] if _pending else 0)


def ack(mark):
    with _lock:
        while _pending and _pending[0][0] <= mark:
            _pending.pop(0)


def has_errors():
    with _lock:
        return any(" ERRO " in l for _, l in _pending)

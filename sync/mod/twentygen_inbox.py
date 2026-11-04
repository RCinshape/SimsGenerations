"""Twenty-Gen Legacy: messages from the group inside the game.

The PC sync writes Documents/Electronic Arts/The Sims 4/LegacySync/inbox.json (new posts, reactions, vote results,
chaos button events). This part shows them as normal Sims notifications, once each.
Chaos events: ONLY the fixed list below does anything. "gift" adds §1,000, "tax" takes §500 (never below §0);
everything else is just a message. Anything not on the list is shown as text or ignored.
"""
import json
import os
import functools

try:
    import twentygen_log as L
except Exception:
    L = None

ALLOWED = {"gift": 1000, "tax": -500, "dare": 0, "compliment": 0, "gossip": 0}
MAX_PER_CHECK = 3


def _log(t):
    try:
        if L is not None:
            L.log("inbox: " + t)
    except Exception:
        pass


def _folder():
    try:
        import twentygen_sync as S
        return S._folder()
    except Exception:
        return os.path.join(os.path.expanduser("~"), "Documents", "Electronic Arts", "The Sims 4", "LegacySync")


def _read(name, dflt):
    try:
        with open(os.path.join(_folder(), name), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return dflt


def _write(name, obj):
    try:
        p = os.path.join(_folder(), name)
        with open(p + ".tmp", "w", encoding="utf-8") as f:
            json.dump(obj, f)
        os.replace(p + ".tmp", p)
    except Exception as e:
        _log("could not save %s: %r" % (name, e))


def notify(title, text):
    """A normal Sims notification (top right). Returns True if it was shown."""
    try:
        import services
        from ui.ui_dialog_notification import UiDialogNotification
        from sims4.localization import LocalizationHelperTuning
        client = services.client_manager().get_first_client()
        owner = client.active_sim if client is not None else None
        dlg = UiDialogNotification.TunableFactory().default(
            owner,
            text=lambda *a, **k: LocalizationHelperTuning.get_raw_text(text),
            title=lambda *a, **k: LocalizationHelperTuning.get_raw_text(title))
        dlg.show_dialog()
        return True
    except Exception as e:
        _log("notification failed: %r" % (e,))
        return False


def _money(amount):
    """Add (or take) simoleons from the active household. Never below zero."""
    try:
        import services
        from protocolbuffers import Consts_pb2
        hh = services.active_household()
        if hh is None or not amount:
            return False
        reason = Consts_pb2.TELEMETRY_MONEY_CHEAT
        if amount > 0:
            hh.funds.add(amount, reason, None)
        else:
            take = min(-amount, max(0, int(hh.funds.money)))
            if take:
                hh.funds.try_remove(take, reason, None)
        return True
    except Exception as e:
        _log("money change failed: %r" % (e,))
        return False


def _clean(t, n):
    t = "".join(ch for ch in str(t or "") if ch >= " " or ch == "\n")
    return t[:n]


def check():
    """Show what is new (at most 3 at a time; the rest come at the next check)."""
    box = _read("inbox.json", [])
    if not isinstance(box, list) or not box:
        return 0
    seen = _read("inbox_seen.json", [])
    if not isinstance(seen, list):
        seen = []
    shown = 0
    for item in box:
        if shown >= MAX_PER_CHECK:
            break
        if not isinstance(item, dict):
            continue
        iid = _clean(item.get("id"), 40)
        if not iid or iid in seen:
            continue
        kind, sender, text = item.get("kind"), _clean(item.get("from"), 40), _clean(item.get("text"), 300)
        if kind == "chaos":
            act = item.get("act")
            if act not in ALLOWED:
                seen.append(iid)
                continue
            if ALLOWED[act]:
                _money(ALLOWED[act])
            ok = notify("Chaos from " + sender + " 🎲", text)
        else:
            ok = notify("Twenty-Gen Legacy", text)
        if not ok:
            break                  # not in a lot yet: try again at the next check
        seen.append(iid)
        shown += 1
        _log("shown %s from %s" % (kind, sender))
    _write("inbox_seen.json", seen[-200:])
    return shown


def _inject(target, name):
    def deco(new_fn):
        orig = getattr(target, name, None)
        if orig is None:
            return new_fn

        @functools.wraps(orig)
        def wrapped(*args, **kwargs):
            return new_fn(orig, *args, **kwargs)
        setattr(target, name, wrapped)
        return new_fn
    return deco


_alarm = None


def _start_alarm():
    global _alarm
    try:
        import alarms
        import date_and_time
        import services
        if _alarm is not None:
            try:
                alarms.cancel_alarm(_alarm)
            except Exception:
                pass
        _alarm = alarms.add_alarm(services.time_service().sim_timeline, date_and_time.create_time_span(minutes=30),
                                  lambda _h: check(), repeating=True)
    except Exception:
        _alarm = None


try:
    from zone import Zone

    @_inject(Zone, "on_loading_screen_animation_finished")
    def _on_zone_ready(orig, self, *args, **kwargs):
        result = orig(self, *args, **kwargs)
        _start_alarm()
        try:
            check()
        except Exception:
            pass
        return result
except Exception:
    pass

try:
    import sims4.commands

    @sims4.commands.Command("legacy.inbox", command_type=sims4.commands.CommandType.Live)
    def _cmd_inbox(_connection=None):
        out = sims4.commands.CheatOutput(_connection)
        out("Twenty-Gen: %d new message(s) shown." % check())
except Exception:
    pass

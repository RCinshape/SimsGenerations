# Twenty-Gen Legacy sync - a small read-only script mod for The Sims 4.
#
# Three separate parts (each works without the next one):
#   twentygen_sync  (this file) reads the game and writes <The Sims 4>/LegacySync/snapshot.json:
#                   names, ages, traits, occults, skills, careers, aspiration, money, family tree.
#                   It writes when you save, when a lot finishes loading, and every 3 sim hours.
#   twentygen_log   writes LegacySync/mod.log on this PC.
#   twentygen_net   sends the file + newest log lines to the group's relay (only if settings are found).
#
# What it never does:
#   It changes nothing in the game, starts no other program, and talks only to the relay in its settings.
#   Every read is wrapped in try/except, so a game patch can only make a field go missing.
#
# WHO IS WHO
#   In the game, click your heir and type  legacy.heir  in the cheat console (Ctrl+Shift+C).
#   The mod remembers that sim (by the game's sim ID), her household and this save in
#   LegacySync/legacy.json. From then on it ignores other saves and households, and it
#   follows the heir if she moves to a new household. Do it again for each new heir.
#
# Cheats: legacy.heir (mark the selected sim as heir), legacy.sync (write now), legacy.status

import json
import os
import time
import functools

try:
    import twentygen_log as L
except Exception:                       # the log part is missing: keep going without it
    class L:                            # noqa: N801
        @staticmethod
        def log(*a, **k): pass
        @staticmethod
        def error(*a, **k): pass
        @staticmethod
        def setup(*a, **k): pass
try:
    import twentygen_net as NET
except Exception:                       # the send part is missing or broken: the file is still written
    NET = None

VERSION = 6
_last_error = ""

# ---------------------------------------------------------------- helpers

def _safe(fn, default=None):
    try:
        v = fn()
        return default if v is None else v
    except Exception:
        return default


def _name(obj):
    """Tuning name of a class or instance, e.g. 'trait_Lovebug'."""
    if obj is None:
        return ""
    n = getattr(obj, "__name__", "")          # classes and tuning instances
    if isinstance(n, str) and n:
        return n
    return getattr(type(obj), "__name__", "") or str(obj)


def _sims_folder():
    """<Documents>/Electronic Arts/The Sims 4, found from where this mod lives (inside Mods)."""
    here = os.path.abspath(__file__)
    parts = here.replace("\\", "/").split("/")
    for i in range(len(parts) - 1, -1, -1):
        if parts[i].lower() == "mods":
            return "/".join(parts[:i])
    return os.path.join(os.path.expanduser("~"), "Documents", "Electronic Arts", "The Sims 4")


def _folder():
    folder = os.path.join(_sims_folder(), "LegacySync")
    if not os.path.isdir(folder):
        os.makedirs(folder)
    return folder


def _out_path():
    return os.path.join(_folder(), "snapshot.json")


def _claim_path():
    return os.path.join(_folder(), "legacy.json")


def _read_claim():
    try:
        with open(_claim_path(), "r", encoding="utf-8") as f:
            c = json.load(f)
        return c if isinstance(c, dict) else {}
    except Exception:
        return {}


def _write_claim(c):
    tmp = _claim_path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(c, f)
    os.replace(tmp, _claim_path())


def _slot_id():
    import services
    return str(_safe(lambda: services.get_persistence_service().get_save_slot_proto_buff().slot_id, ""))

# ---------------------------------------------------------------- reading one sim

def _age(si):
    return _safe(lambda: si.age.name, "") or _safe(lambda: str(si.age), "")


def _gender(si):
    return _safe(lambda: si.gender.name, "")


def _traits(si):
    out = []
    traits = _safe(lambda: list(si.trait_tracker.equipped_traits), []) or _safe(lambda: list(si.trait_tracker), [])
    for t in traits:
        n = _name(t)
        if n:
            out.append(n)
    return sorted(set(out))


def _occults(si):
    out = []
    cur = _safe(lambda: si.occult_types, None)
    if cur is None:
        cur = _safe(lambda: si.current_occult_types, None)
    if cur is not None:
        try:
            import sims.occult.occult_enums as oe
            for member in oe.OccultType:
                v = int(member)
                if v and (int(cur) & v) == v and member.name != "HUMAN":
                    out.append(member.name)
        except Exception:
            pass
    return out


def _skills(si):
    out = []
    skills = _safe(lambda: list(si.all_skills()), [])
    for s in skills:
        n = _name(_safe(lambda: s.stat_type, None) or s)
        lv = _safe(lambda: int(s.get_user_value()), None)
        mx = _safe(lambda: int(s.max_level), None)
        if n and lv is not None:
            out.append({"n": n, "lv": lv, "max": mx})
    return out


def _careers(si):
    out = []
    careers = _safe(lambda: list(si.careers.values()), [])
    for c in careers:
        track = _safe(lambda: c.current_track_tuning, None)
        lv = _safe(lambda: int(c.level), 0)            # 0-based level in the current track
        ulv = _safe(lambda: int(c.user_level), None)    # level shown in the game
        n_levels = _safe(lambda: len(track.career_levels), 0)
        branches = _safe(lambda: len(track.branches), 0)
        top = bool(track is not None and n_levels and lv >= n_levels - 1 and not branches)
        out.append({"n": _name(c), "track": _name(track) if track is not None else "", "lv": ulv, "top": top})
    return out


def _aspiration(si):
    asp = _safe(lambda: si.primary_aspiration, None)
    if asp is None:
        return None
    done = _safe(lambda: bool(si.aspiration_tracker.milestone_completed(asp)), None)
    return {"n": _name(asp), "done": done}


def _family_ids(si):
    g = _safe(lambda: si.genealogy, None)
    parents = _safe(lambda: [int(x) for x in g.get_parent_sim_ids_gen()], []) if g else []
    children = _safe(lambda: [int(x) for x in g.get_children_sim_ids_gen()], []) if g else []
    spouse = _safe(lambda: int(si.spouse_sim_id), None)
    return parents, children, (spouse or None)


def _is_dead(si):
    return bool(_safe(lambda: si.is_dead, False) or _safe(lambda: si.death_type is not None and int(si.death_type) != 0, False))


def _species(si):
    n = _safe(lambda: si.species.name, "")
    return n if isinstance(n, str) else ""


def _death_cause(si):
    n = _safe(lambda: si.death_type.name, "")
    return n if isinstance(n, str) and n.upper() != "NONE" else ""


def _sim(si, in_household, full):
    parents, children, spouse = _family_ids(si)
    d = {
        "id": str(_safe(lambda: si.sim_id, "")),
        "first": _safe(lambda: si.first_name, ""),
        "last": _safe(lambda: si.last_name, ""),
        "age": _age(si),
        "gender": _gender(si),
        "inHousehold": in_household,
        "dead": _is_dead(si),
        "species": _species(si),
        "occults": _occults(si),
        "parents": [str(x) for x in parents],
        "children": [str(x) for x in children],
        "spouse": str(spouse) if spouse else None,
    }
    if d["dead"]:
        d["deathCause"] = _death_cause(si)
    if full:
        d["traits"] = _traits(si)
        d["skills"] = _skills(si)
        d["careers"] = _careers(si)
        d["asp"] = _aspiration(si)
    return d

# ---------------------------------------------------------------- snapshot

def _members(hh):
    return _safe(lambda: list(hh.sim_info_gen()), None) or _safe(lambda: list(hh), [])


def build_snapshot():
    import services
    hh = services.active_household()
    if hh is None:
        return None
    members = _members(hh)
    hh_id = str(_safe(lambda: hh.id, ""))
    slot = _slot_id()
    claim = _read_claim()
    heir_id = str(claim.get("heirId") or "")
    if claim.get("householdId"):
        if claim.get("slot") and slot and claim.get("slot") != slot:
            return None                                   # another save: leave the legacy file alone
        if claim.get("householdId") != hh_id:
            ids = [str(_safe(lambda: m.sim_id, "")) for m in members]
            if heir_id and heir_id in ids:                # the heir moved: follow her
                claim["householdId"] = hh_id
                _write_claim(claim)
            else:
                return None                               # another household: leave it alone
    mgr = services.sim_info_manager()
    sims = {}
    for si in members:
        d = _sim(si, True, True)
        d["heir"] = bool(heir_id) and d["id"] == heir_id
        sims[d["id"]] = d
    # relatives: up to 4 steps away (grandparents, great-grandparents, grandchildren...)
    queue = [(sid, 0) for sid in list(sims.keys())]
    while queue and len(sims) < 200:
        sid, depth = queue.pop(0)
        if depth >= 4:
            continue
        s = sims[sid]
        for rid in s["parents"] + s["children"] + ([s["spouse"]] if s["spouse"] else []):
            if rid in sims:
                continue
            rsi = _safe(lambda: mgr.get(int(rid)), None)
            if rsi is None:
                continue
            sims[rid] = _sim(rsi, False, False)
            queue.append((rid, depth + 1))
    return {
        "v": VERSION,
        "modVersion": VERSION,
        "at": int(time.time()),
        "household": {
            "id": str(_safe(lambda: hh.id, "")),
            "name": _safe(lambda: hh.name, ""),
            "funds": _safe(lambda: int(hh.funds.money), None),
            "home": str(_safe(lambda: int(hh.home_zone_id), "") or ""),
        },
        "simNow": _safe(lambda: int(services.time_service().sim_now.absolute_ticks()), None),
        "zone": str(_safe(lambda: services.current_zone_id(), "")),
        "legacy": {"claimed": bool(claim.get("householdId")), "heirId": heir_id or None, "slot": slot},
        "sims": list(sims.values()),
    }


def write_snapshot(reason=""):
    global _last_error
    try:
        snap = build_snapshot()
        if snap is None:
            if reason in ("save", "load", "cheat"):
                L.log("%s: no file written (main menu, or not the legacy save/household)" % reason)
            return None
        snap["reason"] = reason
        text = json.dumps(snap, ensure_ascii=False, separators=(",", ":"))
        path = _out_path()
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
        if reason != "timer" or _last_error:
            L.log("%s: game file written, household %s, %d sims" % (reason, snap["household"].get("name"), len(snap["sims"])))
        _last_error = ""
        if NET is not None:
            try:
                NET.queue_snapshot(text, reason)
            except Exception as e:
                L.error("could not queue the file for sending", e)
        return path
    except Exception as e:
        if repr(e) != _last_error:
            L.error("%s: reading the game failed" % reason, e)
        _last_error = repr(e)
        return None

# ---------------------------------------------------------------- hooks (all optional)

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
        _alarm = alarms.add_alarm(services.time_service().sim_timeline, date_and_time.create_time_span(hours=3),
                                  lambda _h: write_snapshot("timer"), repeating=True)
    except Exception:
        _alarm = None


try:
    from zone import Zone

    @_inject(Zone, "on_loading_screen_animation_finished")
    def _on_zone_ready(orig, self, *args, **kwargs):
        result = orig(self, *args, **kwargs)
        write_snapshot("load")
        _start_alarm()
        return result
except Exception:
    pass

try:
    from services.persistence_service import PersistenceService

    @_inject(PersistenceService, "save_using")
    def _on_save(orig, self, *args, **kwargs):
        result = orig(self, *args, **kwargs)
        write_snapshot("save")
        return result
except Exception:
    pass

try:
    import sims4.commands

    @sims4.commands.Command("legacy.sync", command_type=sims4.commands.CommandType.Live)
    def _cmd_sync(_connection=None):
        out = sims4.commands.CheatOutput(_connection)
        path = write_snapshot("cheat")
        out("Twenty-Gen sync: " + (("saved to " + path) if path else ("not saved. " + (_last_error or "This is not your legacy save/household. Use legacy.heir on your heir."))))

    @sims4.commands.Command("legacy.heir", command_type=sims4.commands.CommandType.Live)
    def _cmd_heir(_connection=None):
        import services
        out = sims4.commands.CheatOutput(_connection)
        try:
            sim = services.get_active_sim()
            si = sim.sim_info
            hh = services.active_household()
            _write_claim({"heirId": str(si.sim_id), "householdId": str(hh.id), "slot": _slot_id(),
                          "heirName": (si.first_name + " " + si.last_name).strip(), "at": int(time.time())})
            path = write_snapshot("heir")
            out("Twenty-Gen: " + si.first_name + " is your heir. This household and save are now your legacy." + ("" if path else " (snapshot failed: " + _last_error + ")"))
        except Exception as e:
            out("Twenty-Gen: select your heir first, then type legacy.heir. (" + repr(e) + ")")

    @sims4.commands.Command("legacy.status", command_type=sims4.commands.CommandType.Live)
    def _cmd_status(_connection=None):
        out = sims4.commands.CheatOutput(_connection)
        c = _read_claim()
        out("Twenty-Gen mod v%d. Sending: %s" % (VERSION, NET.status() if NET is not None else "send part missing"))
        if c:
            out("Twenty-Gen: heir " + str(c.get("heirName")) + ", household " + str(c.get("householdId")) + ", save " + str(c.get("slot")))

    @sims4.commands.Command("legacy.send", command_type=sims4.commands.CommandType.Live)
    def _cmd_send(_connection=None):
        out = sims4.commands.CheatOutput(_connection)
        path = write_snapshot("cheat")
        if NET is None:
            out("Twenty-Gen: the send part is missing. Download your game file from the app again.")
            return
        NET.send_now()
        out("Twenty-Gen: sending now" + ("" if path else " (logs only)") + ". Type legacy.status in a minute to see the result.")
except Exception:
    pass

# ---------------------------------------------------------------- start
try:
    import twentygen_partner  # noqa: F401  (partner control: legacy.partner)
except Exception:
    pass
try:
    import twentygen_inbox  # noqa: F401  (messages + chaos from the group: legacy.inbox)
except Exception:
    pass
try:
    L.setup(_folder())
    L.log("mod v%d loaded from %s" % (VERSION, os.path.basename(os.path.dirname(os.path.abspath(__file__)))))
except Exception:
    pass
if NET is not None:
    try:
        NET.start(_sims_folder())
    except Exception as e:
        L.error("the send part could not start", e)


# Life-event capture (added in v8 as a bytecode import; now in source).
import twentygen_life

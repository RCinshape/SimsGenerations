"""Read-only life-event capture for the existing Twenty-Gen collector (Python 3.7).

Uses game event hooks, retains a per-save/household journal across coalesced uploads,
and writes through the existing collector/transport. Never changes Sim state.
"""
import functools
import hashlib
import importlib
import json
import os
import time
import uuid

SYNC = None
_context = None
_journal = {"events": [], "participants": {}}
_known = {}
_busy = False
_installed = False
_abductions = {}
PRETERM_BUFF_ID = 16083709106694612917
PRETERM_BUFF_NAME = "Pandasama:buff_Pregnancy_InLabor_preterm_labor"
RETURNED_BUFFS = frozenset(("buff_ReturnedFromAbduction_Angry", "buff_ReturnedFromAbduction_Dazed", "buff_ReturnedFromAbduction_Focused"))
ABDUCTION_INTERACTIONS = frozenset(("alienAbduction_BeAbducted",))
DETECTORS = {"rel": True, "milestone": True, "twins": True, "adopt": True, "cause": True}
_DEFAULT_DETECTORS = dict(DETECTORS)
REL_BITS = {"engaged": ["romantic-engaged"],
            "couple": ["romantic-significantother", "romantic-significant_other", "romantic-boyfriendgirlfriend", "romantic-promised"],
            "bff": ["friendship-bff"], "enemy": ["friendship-enemy", "friendship-archenemy"]}
MILESTONES = ["firststep", "firstword", "pottytrain", "firstdayofschool", "firstcrush", "firstkiss", "firstlove",
              "heartbreak", "graduat", "firstjob", "retire", "grandparent"]
PAIR_WINDOW = 10
TWINS_WINDOW = 600
PROBE_MAX = 2 * 1024 * 1024
_pair_seen = {}
_engaged = set()
_births = []
_twins = {}
_counts = {}
_probe = {"at": -1e9, "on": False}
_ready = {"on": False}   # True once the lot has finished loading; False while a lot loads


def _safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def _log(message):
    _safe(lambda: SYNC.L.log("life news: " + message))


def _name(value):
    return getattr(value, "__name__", "") or getattr(type(value), "__name__", "")


def _now():
    return time.time()


def _load_detectors():
    DETECTORS.update(_DEFAULT_DETECTORS)
    try:
        with open(os.path.join(SYNC._folder(), "detectors.json"), "r", encoding="utf-8") as stream:
            data = json.load(stream)
        if isinstance(data, dict):
            for key in DETECTORS:
                if isinstance(data.get(key), bool):
                    DETECTORS[key] = data[key]
    except Exception:
        pass


def _probe_on():
    now = _now()
    if now - _probe["at"] >= 60:
        _probe["at"] = now
        _probe["on"] = bool(_safe(lambda: os.path.exists(os.path.join(SYNC._folder(), "probe.on")), False))
    return _probe["on"]


def _probe_log(category, obj, si):
    """Probe mode only: one TSV line per observation for a family Sim. Never raises."""
    try:
        if si is None or str(si.sim_id) not in _known or not _probe_on():
            return
        name = obj if isinstance(obj, str) else _name(obj)
        guid = "" if isinstance(obj, str) else getattr(obj, "guid64", "")
        clean = lambda v: str(v).replace("\t", " ").replace("\r", " ").replace("\n", " ")
        line = "\t".join((time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(_now())), clean(category), clean(name), clean(guid), clean(si.sim_id))) + "\n"
        path = os.path.join(SYNC._folder(), "probe.log")
        try:
            if os.path.getsize(path) > PROBE_MAX:
                os.replace(path, path + ".1")
        except OSError:
            pass
        with open(path, "a", encoding="utf-8") as stream:
            stream.write(line)
    except Exception:
        pass


def _once(key):
    """True the first time within PAIR_WINDOW seconds: the game adds a pair's bit for both Sims."""
    now = _now()
    if now - _pair_seen.get(key, -1e9) < PAIR_WINDOW:
        return False
    _pair_seen[key] = now
    if len(_pair_seen) > 200:
        for old in [k for k, t in _pair_seen.items() if now - t > PAIR_WINDOW]:
            del _pair_seen[old]
    return True


def _rel_kind(bit):
    name = _name(bit).lower().replace(" ", "")
    for kind, tokens in REL_BITS.items():
        if name and any(token in name for token in tokens):
            return kind
    return None


def _preterm(buff):
    return getattr(buff, "guid64", None) == PRETERM_BUFF_ID or _name(buff).lower() == PRETERM_BUFF_NAME.lower()


def _life(si):
    out = {}
    pregnant = _safe(lambda: si.pregnancy_tracker.is_pregnant)
    if isinstance(pregnant, bool):
        out["pregnant"] = pregnant
    buffs = _safe(lambda: list(si.get_active_buff_types()))
    if buffs is None:
        buffs = _safe(lambda: list(si.Buffs.get_active_buff_types()))
    if buffs is not None:
        out["preterm"] = any(_preterm(buff) for buff in buffs)
        out["abducted"] = any(_name(buff) in RETURNED_BUFFS for buff in buffs)
    return out


def _path():
    token = hashlib.sha256((str(_context[0]) + "|" + str(_context[1])).encode("utf-8")).hexdigest()[:24]
    return os.path.join(SYNC._folder(), "life-events-" + token + ".json")


def _persist():
    path = _path()
    with open(path + ".tmp", "w", encoding="utf-8") as stream:
        json.dump(_journal, stream, ensure_ascii=False, separators=(",", ":"))
    os.replace(path + ".tmp", path)


def _activate(snap):
    global _context, _journal, _known
    legacy = snap.get("legacy") or {}
    if not legacy.get("claimed"):
        _context = None
        _known = {}
        return False
    context = (str(legacy.get("slot") or ""), str((snap.get("household") or {}).get("id") or ""))
    if not all(context):
        _context = None
        return False
    if context != _context:
        _context, _known = context, {}
        try:
            with open(_path(), "r", encoding="utf-8") as stream:
                data = json.load(stream)
            if not isinstance(data, dict) or not isinstance(data.get("events"), list) or not isinstance(data.get("participants"), dict):
                raise ValueError("invalid life journal")
            _journal = data
        except FileNotFoundError:
            _journal = {"events": [], "participants": {}}
        except Exception:
            # Preserve a damaged journal for recovery rather than overwriting it.
            _context = None
            _log("journal could not be read; event capture paused")
            return False
    return True


def _active():
    try:
        if _context is None:
            return False
        import services
        return str(SYNC._slot_id()) == _context[0] and str(_safe(lambda: services.active_household().id, "")) == _context[1]
    except Exception:
        return False


def _sim(si):
    sim_id = str(si.sim_id)
    data = SYNC._sim(si, bool(_known.get(sim_id, {}).get("inHousehold")), False)
    data["life"] = _life(si)
    return data


def _decorate(snap):
    if snap is None or not _activate(snap):
        return snap
    import services
    manager = services.sim_info_manager()
    for data in snap.get("sims", []):
        si = _safe(lambda: manager.get(int(data["id"])))
        if si is not None:
            data["life"] = _life(si)
        _known[str(data["id"])] = dict(data)
    # Retain event participants even if death/divorce removed their current family link.
    ids = {str(data["id"]) for data in snap.get("sims", [])}
    for sim_id, data in _journal["participants"].items():
        if sim_id not in ids and len(snap["sims"]) < 200:
            snap["sims"].append(dict(data))
    snap["lifeEvents"] = list(_journal["events"])
    snap["lifeNewsVersion"] = 1
    return snap


def _record(facts):
    global _busy
    if not facts or _busy or not _active():
        return
    _busy = True
    try:
        for fact in facts:
            kind, si, partner_id = fact[:3]
            data = _sim(si)
            event = {"id": uuid.uuid4().hex, "kind": kind, "simId": str(si.sim_id),
                     "at": int(time.time() * 1000), "hh": _context[1], "slot": _context[0]}
            if partner_id:
                event["partnerId"] = str(partner_id)
            if kind == "ageup":
                event["age"] = data.get("age", "")
            if len(fact) > 3:
                event.update(fact[3])
            _journal["events"].append(event)
            _journal["participants"][str(si.sim_id)] = data
            if partner_id and str(partner_id) in _known:
                _journal["participants"][str(partner_id)] = dict(_known[str(partner_id)])
            _known[str(si.sim_id)] = data
        if DETECTORS["twins"]:
            _twins_check([(str(f[1].sim_id), str(f[2])) for f in facts if f[0] == "baby" and f[2]])
        if len(_journal["events"]) > 256:
            _log("journal retention reached; retaining the latest 256 events")
            _journal["events"] = _journal["events"][-256:]
        retained = {e["simId"] for e in _journal["events"]} | {e.get("partnerId") for e in _journal["events"]}
        _journal["participants"] = {sid: value for sid, value in _journal["participants"].items() if sid in retained}
        _persist()  # Persist before transport; a coalesced snapshot still carries the events.
        SYNC.write_snapshot("life")
    except Exception as error:
        _log("capture/write failed: " + type(error).__name__)
    finally:
        _busy = False


def _twins_check(babies):
    """2-4 births to one parent within TWINS_WINDOW: one extra 'twins' event (later births raise its count)."""
    now = _now()
    for child, parent in babies:
        _births.append((now, parent, child))
    _births[:] = [b for b in _births if now - b[0] <= TWINS_WINDOW][-64:]
    for parent in sorted({p for _, p in babies}):
        group = [b for b in _births if b[1] == parent]
        if not 2 <= len(group) <= 4:
            continue
        prev = _twins.get(parent)
        if prev and now - prev[0] <= TWINS_WINDOW:
            for e in _journal["events"]:
                if e["id"] == prev[1]:
                    e["count"] = len(group)
            continue
        first = group[0][2]
        event = {"id": uuid.uuid4().hex, "kind": "twins", "simId": first, "partnerId": parent, "count": len(group),
                 "at": int(now * 1000), "hh": _context[1], "slot": _context[0]}
        _journal["events"].append(event)
        _twins[parent] = (group[0][0], event["id"])
        if first in _known:
            _journal["participants"].setdefault(first, dict(_known[first]))
        if parent in _known:
            _journal["participants"][parent] = dict(_known[parent])


def _home(si):
    """Only household members' own relationships and milestones are news, and never while a lot is loading."""
    return _ready["on"] and bool(_known.get(str(si.sim_id), {}).get("inHousehold"))


def _bit_changed(adding, tracker, target_id, bit, had=None):
    si = _safe(lambda: tracker._sim_info)
    if si is None or _busy or str(si.sim_id) not in _known:
        return
    _probe_log("relbit_add" if adding else "relbit_remove", bit, si)
    if not _home(si) or (adding and had is True) or (not adding and had is False):
        return
    kind = _rel_kind(bit)
    if kind is None or not DETECTORS["rel"] or not _active():
        return
    me, other_id = str(si.sim_id), str(target_id)
    pair = "-".join(sorted((me, other_id)))
    if kind == "engaged":
        (_engaged.add if adding else _engaged.discard)(pair)
    if adding:
        out = kind
    elif kind == "couple":
        import services
        other = _safe(lambda: services.sim_info_manager().get(int(other_id)))
        if other is None or SYNC._is_dead(si) or SYNC._is_dead(other) or pair in _engaged:
            return
        if _sim(si).get("spouse") == other_id:
            return
        names = _safe(lambda: [_name(b).lower().replace(" ", "") for b in tracker.get_all_bits(target_id)], [])
        if any(t in n for n in names for t in REL_BITS["engaged"]):
            return
        out = "breakup"
    else:
        return
    if _once(out + "|" + pair):
        _record([(out, si, other_id)])


def _milestone_done(tracker, milestone):
    si = _safe(lambda: tracker._sim_info) or _safe(lambda: tracker.sim_info)
    if si is None or _busy or str(si.sim_id) not in _known or not _home(si):
        return
    _probe_log("milestone", milestone, si)
    name = _name(milestone)
    if not DETECTORS["milestone"] or not name or not _active():
        return
    if not any(token in name.lower() for token in MILESTONES):
        return
    if _once("milestone|" + name + "|" + str(si.sim_id)):
        _record([("milestone", si, None, {"name": name})])


def _observe(si, event_name, kwargs):
    if si is None or _busy or not _active():
        return
    sim_id = str(si.sim_id)
    old = _known.get(sim_id)
    if old is None:
        return
    data = _sim(si)
    facts = []
    if event_name == "AgedUp" and data.get("age") != old.get("age"):
        facts.append(("ageup", si, None))
    if event_name == "SpouseEvent" and data.get("spouse") != old.get("spouse"):
        former = old.get("spouse")
        if former:
            import services
            other = _safe(lambda: services.sim_info_manager().get(int(former)))
            if other is not None and not SYNC._is_dead(si) and not SYNC._is_dead(other):
                facts.append(("divorce", si, former))
        if data.get("spouse") and not SYNC._is_dead(si):
            facts.append(("marry", si, data["spouse"]))
    if event_name in ("OffspringCreated", "ChildAdopted"):
        import services
        for child_id in set(data.get("children", [])) - set(old.get("children", [])):
            child = _safe(lambda: services.sim_info_manager().get(int(child_id)))
            if child is not None and str(child_id) not in _known:
                facts.append(("adopt" if event_name == "ChildAdopted" and DETECTORS["adopt"] else "baby", child, sim_id))
    buff = kwargs.get("buff")
    if event_name == "BuffBeganEvent":
        if _preterm(buff) and not old.get("life", {}).get("preterm"):
            facts.append(("preterm", si, None))
        if _name(buff) in RETURNED_BUFFS and time.time() - _abductions.get(sim_id, 0) > 300:
            facts.append(("abduct", si, None))
            _abductions[sim_id] = time.time()
    if event_name == "InteractionStart" and _name(kwargs.get("interaction")) in ABDUCTION_INTERACTIONS:
        facts.append(("abduct", si, None))
        _abductions[sim_id] = time.time()
    _known[sim_id] = data
    _record(facts)


def _wrap(target, name, callback):
    original = getattr(target, name, None)
    if original is None or getattr(original, "_tg_life_v1", False):
        return False
    @functools.wraps(original)
    def wrapped(*args, **kwargs):
        return callback(original, *args, **kwargs)
    wrapped._tg_life_v1 = True
    setattr(target, name, wrapped)
    return True


def install(sync=None):
    global SYNC, _installed
    if _installed:
        return
    if sync is None:
        import twentygen_sync as sync
    SYNC = sync
    def build(original, *args, **kwargs):
        snapshot = original(*args, **kwargs)
        try:
            return _decorate(snapshot)
        except Exception as error:
            _log("snapshot decoration failed: " + type(error).__name__)
            return snapshot
    _wrap(SYNC, "build_snapshot", build)
    try:
        from event_testing.event_manager_service import EventManagerService
        from event_testing.test_events import TestEvent
        watched = {getattr(TestEvent, n): n for n in ("AgedUp", "SpouseEvent", "OffspringCreated", "ChildAdopted", "BuffBeganEvent", "BuffEndedEvent", "InteractionStart") if hasattr(TestEvent, n)}
        def event(original, self, event_type, sim_info=None, **kwargs):
            result = original(self, event_type, sim_info=sim_info, **kwargs)
            try:
                if sim_info is not None and str(sim_info.sim_id) in _known and _probe_on():
                    label = watched.get(event_type) or getattr(event_type, "name", None) or str(event_type)
                    _counts[label] = _counts.get(label, 0) + 1
                    if _counts[label] == 1 or _counts[label] % 100 == 0:
                        _probe_log("event", label, sim_info)
                    if kwargs.get("buff") is not None and watched.get(event_type) == "BuffBeganEvent":
                        _probe_log("buff", kwargs["buff"], sim_info)
            except Exception:
                pass
            if event_type in watched:
                try:
                    _observe(sim_info, watched[event_type], kwargs)
                except Exception as error:
                    _log("event observation failed: " + type(error).__name__)
            return result
        _wrap(EventManagerService, "process_event", event)
    except ImportError:
        _log("game event hook unavailable")
    try:
        from interactions.utils.death import DeathTracker
        def death(original, self, *args, **kwargs):
            si = _safe(lambda: self._sim_info)
            eligible = si is not None and str(si.sim_id) in _known and _active()
            before = _safe(lambda: SYNC._is_dead(si))
            result = original(self, *args, **kwargs)
            after = _safe(lambda: SYNC._is_dead(si))
            cause = _safe(lambda: si.death_type.name, "")
            cause = cause if isinstance(cause, str) and cause.upper() != "NONE" else ""
            if after is True:
                _probe_log("death", cause or "?", si)
            if eligible and isinstance(before, bool) and isinstance(after, bool) and before != after:
                extra = {"cause": cause} if after and cause and DETECTORS["cause"] else {}
                _record([("death" if after else "revive", si, None, extra)])
            return result
        _wrap(DeathTracker, "_set_death_type", death)
        _wrap(DeathTracker, "clear_death_type", death)
    except ImportError:
        _log("death/revival hook unavailable")
    try:
        from interactions.utils.death_interactions import DeathSuperInteraction
        from interactions.utils.outcome_enums import OutcomeResult
        def rescued(original, self, *args, **kwargs):
            result = original(self, *args, **kwargs)
            si = _safe(lambda: self.sim.sim_info)
            success = _safe(lambda: self.global_outcome_result == OutcomeResult.SUCCESS and not self._has_completed_death, False)
            if success and si is not None and str(si.sim_id) in _known and not SYNC._is_dead(si):
                _record([("rescue", si, None)])
            return result
        _wrap(DeathSuperInteraction, "_exited_pipeline", rescued)
    except ImportError:
        _log("escaped-death hook unavailable")
    try:
        from sims.pregnancy.pregnancy_tracker import PregnancyTracker
        def pregnancy(original, self, *args, **kwargs):
            before = _safe(lambda: self.is_pregnant)
            result = original(self, *args, **kwargs)
            if before is False and _safe(lambda: self.is_pregnant) is True and str(self._sim_info.sim_id) in _known:
                _record([("pregnancy", self._sim_info, None)])
            return result
        _wrap(PregnancyTracker, "start_pregnancy", pregnancy)
    except ImportError:
        _log("pregnancy hook unavailable")
    try:
        from relationships.relationship_tracker import RelationshipTracker
        def bit(adding, bit_keys):
            def hook(original, self, *args, **kwargs):
                target = args[0] if args else kwargs.get("target_sim_id")
                which = args[1] if len(args) > 1 else next((kwargs[k] for k in bit_keys if k in kwargs), None)
                had = _safe(lambda: bool(self.has_bit(target, which)))   # an existing bit re-added (load, travel) is not news
                result = original(self, *args, **kwargs)
                try:
                    _bit_changed(adding, self, target, which, had)
                except Exception as error:
                    _log("relationship observation failed: " + type(error).__name__)
                return result
            return hook
        _wrap(RelationshipTracker, "add_relationship_bit", bit(True, ("bit_to_add", "bit")))
        _wrap(RelationshipTracker, "remove_relationship_bit", bit(False, ("bit", "bit_to_remove")))
    except ImportError:
        _log("relationship hook unavailable")
    try:
        from milestones.milestone_tracker import MilestoneTracker
        def milestone(original, self, *args, **kwargs):
            result = original(self, *args, **kwargs)
            try:
                _milestone_done(self, args[0] if args else kwargs.get("milestone"))
            except Exception as error:
                _log("milestone observation failed: " + type(error).__name__)
            return result
        _wrap(MilestoneTracker, "complete_milestone" if hasattr(MilestoneTracker, "complete_milestone") else "_complete_milestone", milestone)
    except ImportError:
        _log("milestone hook unavailable")
    for module_name in ("traits.trait_tracker", "sims.trait_tracker"):
        try:
            tracker = importlib.import_module(module_name).TraitTracker
            def trait(original, self, *args, **kwargs):
                result = original(self, *args, **kwargs)
                _probe_log("trait", args[0] if args else kwargs.get("trait"), _safe(lambda: self._sim_info))
                return result
            _wrap(tracker, "_add_trait" if hasattr(tracker, "_add_trait") else "add_trait", trait)
            break
        except Exception:
            continue
    try:
        from zone import Zone
        def ready(original, self, *args, **kwargs):
            _ready["on"] = False
            result = original(self, *args, **kwargs)
            _ready["on"] = True
            return result
        def leaving(original, self, *args, **kwargs):
            _ready["on"] = False
            return original(self, *args, **kwargs)
        _wrap(Zone, "on_loading_screen_animation_finished", ready)
        _wrap(Zone, "on_teardown", leaving)
    except ImportError:
        _ready["on"] = True
    _load_detectors()
    _probe_on()
    _installed = True
    _log("event hooks installed")


try:
    install()
except Exception:
    # Failure of optional news must not prevent the existing collector from loading.
    pass

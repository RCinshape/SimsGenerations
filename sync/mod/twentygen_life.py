"""Read-only life-event capture for the existing Twenty-Gen collector (Python 3.7).

Uses game event hooks, retains a per-save/household journal across coalesced uploads,
and writes through the existing collector/transport. Never changes Sim state.
"""
import functools
import hashlib
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


def _safe(fn, default=None):
    try:
        return fn()
    except Exception:
        return default


def _log(message):
    _safe(lambda: SYNC.L.log("life news: " + message))


def _name(value):
    return getattr(value, "__name__", "") or getattr(type(value), "__name__", "")


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
    _string_ids(data)
    data["life"] = _life(si)
    return data


def _string_ids(data):
    # Convert integers before JSON reaches JavaScript, where 64-bit IDs may round.
    # Do not fabricate exact IDs from floats or alter existing textual IDs.
    def exact(value):
        return str(value) if isinstance(value, int) and not isinstance(value, bool) else value
    for key in ("id", "spouse"):
        if key in data:
            data[key] = exact(data[key])
    for key in ("parents", "children"):
        if isinstance(data.get(key), list):
            data[key] = [exact(value) for value in data[key]]


def _family_observe(si, data):
    # Read only the particular sim's direct genealogy, never a partner's family.
    # A missing API, exception, or bounded list is partial, not an empty result.
    import itertools
    tracker = _safe(lambda: si.genealogy) or _safe(lambda: si._genealogy_tracker)
    results = {}
    for field, methods, limit in (("parents", ("get_parent_sim_ids_gen", "get_parent_sim_infos_gen"), 10),
                                  ("children", ("get_children_sim_ids_gen", "get_child_sim_infos_gen"), 30)):
        def exact_id(value):
            if not isinstance(value, (int, str)):
                value = _safe(lambda: value.sim_id, _safe(lambda: value.id))
            if isinstance(value, int) and not isinstance(value, bool) and value > 0:
                return str(value)
            if isinstance(value, str) and value.isdigit() and int(value) > 0:
                return value
            return None
        values = None
        for method in methods:
            def read():
                fn = getattr(tracker, method)
                return list(itertools.islice(fn(), limit + 1))
            candidate = _safe(read)
            if candidate is not None:
                converted = [exact_id(value) for value in candidate]
                if all(value is not None for value in converted):
                    values = converted
                    break
        if values is None:
            results[field] = "unknown"
            continue
        data[field] = values[:limit]
        results[field] = "partial" if len(values) > limit else "observed"
    return results


def _capture_sequence():
    # Persist before emitting: failed writes cannot reuse an acknowledged number.
    stream = _journal.get("familyStream")
    if not isinstance(stream, dict) or not isinstance(stream.get("id"), str) or len(stream["id"]) != 32:
        stream = {"id": uuid.uuid4().hex, "sequence": 0}
    seq = stream.get("sequence")
    if not isinstance(seq, int) or isinstance(seq, bool) or seq < 0 or seq >= 9007199254740991:
        raise ValueError("invalid family stream sequence")
    previous = _journal.get("familyStream")
    _journal["familyStream"] = {"id": stream["id"], "sequence": seq + 1}
    try:
        _persist()
    except Exception:
        if previous is None:
            _journal.pop("familyStream", None)
        else:
            _journal["familyStream"] = previous
        raise
    return {"streamId": stream["id"], "sequence": seq + 1, "captureId": uuid.uuid4().hex}


def _romantic_observations(snap):
    # EA's read-only traversal exposes flags, but does not prove when or why
    # an absent edge ended. Inspect only direct edges; never mutate graph nodes.
    import services
    from family_tree.family_tree_enums import FamilyTreeTraversalMode, FamilyRelationBitFlags
    service = services.family_tree_service()
    graph = service.family_tree_graph
    mask = (("spouse", FamilyRelationBitFlags.SPOUSE),
            ("fiance", FamilyRelationBitFlags.FIANCE),
            ("steady", FamilyRelationBitFlags.STEADY))
    sims = snap.get("sims", [])
    roots = [data for data in sims if data.get("inHousehold")][:4] or sims[:1]
    observations, seen, inspected = [], set(), [0]
    def visitor(node):
        return False
    def edge_filter(edge, path):
        inspected[0] += 1
        if inspected[0] > 128:
            return False
        try:
            a, b = str(edge.source_sim_id), str(edge.target_sim_id)
            if not a.isdigit() or not b.isdigit() or not int(a) or not int(b) or len(a)>24 or len(b)>24 or a==b:
                return False
            flags = [name for name, bit in mask if edge.edge_data & bit]
            if flags:
                pair = tuple(sorted((a,b)))
                key = pair + tuple(flags)
                if key not in seen:
                    seen.add(key)
                    observations.append({"a":pair[0],"b":pair[1],"flags":flags})
        except Exception:
            pass
        # No graph traversal beyond the root. An omitted edge means unknown.
        return False
    successes = 0
    for root in roots:
        if inspected[0] >= 128:
            break
        try:
            graph.traverse(int(root["id"]), visitor_function=visitor, max_depth=1,
                           edge_filter_function=edge_filter,
                           traversal_mode=FamilyTreeTraversalMode.TRAVERSAL_BREADTH_FIRST)
            successes += 1
        except Exception:
            continue
    return observations if successes else None


def _decorate(snap):
    if snap is None or not _activate(snap):
        return snap
    import services
    manager = services.sim_info_manager()
    for data in snap.get("sims", []):
        _string_ids(data)
        si = _safe(lambda: manager.get(int(data["id"])))
        if si is not None:
            data["life"] = _life(si)
            data["familyObservation"] = _family_observe(si, data)
        _known[str(data["id"])] = dict(data)
    # Retain event participants even if death/divorce removed their current family link.
    ids = {str(data["id"]) for data in snap.get("sims", [])}
    for sim_id, data in _journal["participants"].items():
        if sim_id not in ids and len(snap["sims"]) < 200:
            snap["sims"].append(dict(data))
    snap["lifeEvents"] = list(_journal["events"])
    snap["lifeNewsVersion"] = 1
    romantic = _safe(lambda: _romantic_observations(snap))
    if romantic is not None:
        snap["familyRelationships"] = romantic
    # The underlying collector bounds traversal and may encounter unavailable Sims.
    # Neither a save slot nor a wall clock proves lineage or ordering across PCs.
    snap["familyCapture"] = {
        "schema": 1, "source": "game-genealogy", "completeness": "partial",
        "saveIdentity": "unverified", "captureOrder": "unverified",
        "capabilities": {"parentLinks": "reported", "household": "reported",
                         "romantic": "spouse-only", "parentRoles": "unknown"}
    }
    try:
        snap["familyCapture"].update(_capture_sequence())
    except Exception:
        _log("family stream unavailable; capture order is unknown")
    return snap


def _record(facts):
    global _busy
    if not facts or _busy or not _active():
        return
    _busy = True
    try:
        for kind, si, partner_id in facts:
            data = _sim(si)
            event = {"id": uuid.uuid4().hex, "kind": kind, "simId": str(si.sim_id),
                     "at": int(time.time() * 1000), "hh": _context[1], "slot": _context[0]}
            if partner_id:
                event["partnerId"] = str(partner_id)
            if kind == "ageup":
                event["age"] = data.get("age", "")
            _journal["events"].append(event)
            _journal["participants"][str(si.sim_id)] = data
            if partner_id and str(partner_id) in _known:
                _journal["participants"][str(partner_id)] = dict(_known[str(partner_id)])
            _known[str(si.sim_id)] = data
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
                facts.append(("baby", child, sim_id))
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
            if eligible and isinstance(before, bool) and isinstance(after, bool) and before != after:
                _record([("death" if after else "revive", si, None)])
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
    _installed = True
    _log("event hooks installed")


try:
    install()
except Exception:
    # Failure of optional news must not prevent the existing collector from loading.
    pass

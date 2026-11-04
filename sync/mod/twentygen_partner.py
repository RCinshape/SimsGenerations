"""Twenty-Gen Legacy: partner control.

Your heir's partner lives in your household. With this part you choose:
  controlled      - you play her/him like any household Sim (the game's normal way)
  not controlled  - she/he lives on her own, like a pet: still in the household, still free will,
                    but you can't select her/him
Cheat console (Ctrl+Shift+C), with your heir selected:
  legacy.partner        switch your heir's partner between controlled and not controlled
  legacy.partner on     control the partner
  legacy.partner off    stop controlling the partner
  legacy.partner list   who is "not controlled" in this household
The choice is kept in Documents/Electronic Arts/The Sims 4/LegacySync/partner.json and comes back after load.
Safety: the selected Sim and the last selectable Sim are never switched off; the game can always add a Sim back
when nobody else is selectable.
"""
import json
import os
import functools

try:
    import twentygen_log as L
except Exception:
    L = None

_ALLOW = [False]          # True while this part itself adds a Sim back


def _log(t):
    try:
        if L is not None:
            L.log("partner: " + t)
    except Exception:
        pass


def _path():
    try:
        import twentygen_sync as S
        return os.path.join(S._folder(), "partner.json")
    except Exception:
        return os.path.join(os.path.expanduser("~"), "Documents", "Electronic Arts", "The Sims 4", "LegacySync", "partner.json")


def _read():
    try:
        with open(_path(), encoding="utf-8") as f:
            d = json.load(f)
        return set(str(x) for x in d.get("off", []))
    except Exception:
        return set()


def _write(ids):
    try:
        p = _path()
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p + ".tmp", "w", encoding="utf-8") as f:
            json.dump({"off": sorted(ids)}, f)
        os.replace(p + ".tmp", p)
    except Exception as e:
        _log("could not save the choice: %r" % (e,))


def _client():
    import services
    return services.client_manager().get_first_client()


def _selectable(client):
    try:
        return [si for si in client.selectable_sims]
    except Exception:
        return []


def _name(si):
    return ("%s %s" % (getattr(si, "first_name", ""), getattr(si, "last_name", ""))).strip() or "?"


def _partner_of(si):
    import services
    pid = getattr(si, "spouse_sim_id", None)
    if not pid:
        return None
    p = services.sim_info_manager().get(pid)
    hh = services.active_household()
    if p is None or hh is None or getattr(p, "household_id", None) != hh.id:
        return None
    return p


def set_control(si, on):
    """Returns a short text for the player."""
    client = _client()
    ids = _read()
    sid = str(si.sim_id)
    if on:
        ids.discard(sid)
        _write(ids)
        _ALLOW[0] = True
        try:
            client.add_selectable_sim_info(si)
        finally:
            _ALLOW[0] = False
        _log("control ON for %s" % _name(si))
        return "%s: you control her/him again." % _name(si)
    import services
    active = services.get_active_sim()
    if active is not None and active.sim_info is si:
        return "Select another Sim first (you can't switch off the Sim you are playing)."
    if len([x for x in _selectable(client) if x is not si]) < 1:
        return "Not possible: nobody else would be left to play."
    ids.add(sid)
    _write(ids)
    client.remove_selectable_sim_info(si)
    _log("control OFF for %s" % _name(si))
    return "%s now lives on her/his own (not controlled). Type legacy.partner on to take control again." % _name(si)


def reapply():
    """After a load the game makes everyone selectable again: switch the saved ones off."""
    ids = _read()
    if not ids:
        return
    try:
        import services
        client = _client()
        active = services.get_active_sim()
        for si in list(_selectable(client)):
            if str(si.sim_id) in ids and not (active is not None and active.sim_info is si):
                if len(_selectable(client)) > 1:
                    client.remove_selectable_sim_info(si)
    except Exception as e:
        _log("reapply failed: %r" % (e,))


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


try:
    from server.client import Client

    @_inject(Client, "add_selectable_sim_info")
    def _on_add(orig, self, sim_info, *args, **kwargs):
        try:
            if not _ALLOW[0] and str(sim_info.sim_id) in _read() and len(_selectable(self)) > 0:
                return None                      # stays "not controlled"
        except Exception:
            pass
        return orig(self, sim_info, *args, **kwargs)
except Exception:
    pass

try:
    from zone import Zone

    @_inject(Zone, "on_loading_screen_animation_finished")
    def _on_zone_ready(orig, self, *args, **kwargs):
        result = orig(self, *args, **kwargs)
        reapply()
        return result
except Exception:
    pass

try:
    import sims4.commands

    @sims4.commands.Command("legacy.partner", command_type=sims4.commands.CommandType.Live)
    def _cmd_partner(what="", _connection=None):
        out = sims4.commands.CheatOutput(_connection)
        try:
            import services
            what = str(what or "").lower()
            if what == "list":
                ids = _read()
                names = [_name(si) for si in services.active_household().sim_info_gen() if str(si.sim_id) in ids]
                out("Not controlled: " + (", ".join(names) if names else "nobody"))
                return
            sim = services.get_active_sim()
            if sim is None:
                out("Select your heir first.")
                return
            p = _partner_of(sim.sim_info)
            if p is None:
                out("%s has no partner in this household." % _name(sim.sim_info))
                return
            if what not in ("on", "off"):
                what = "on" if str(p.sim_id) in _read() else "off"
            out(set_control(p, what == "on"))
        except Exception as e:
            out("Twenty-Gen partner: didn't work (%r)" % (e,))
except Exception:
    pass

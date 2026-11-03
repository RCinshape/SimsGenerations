"""Synthetic game hooks only. Never imports the installed game or opens player saves."""
import copy
import importlib.util
import json
import pathlib
import sys
import tempfile
import types
import unittest


class CollectorTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=str(pathlib.Path(__file__).parent))
        self.addCleanup(self.temp.cleanup)
        self.logs, self.sent, self.calls = [], [], []
        self.slot, self.hh = '77', '900'
        self.sims = {}
        owner = self
        def module(name, **attrs):
            result = types.ModuleType(name)
            result.__dict__.update(attrs)
            previous = sys.modules.get(name)
            sys.modules[name] = result
            self.addCleanup(lambda: sys.modules.pop(name, None) if previous is None else sys.modules.__setitem__(name, previous))
            return result
        class Sim:
            def __init__(self, sim_id):
                self.sim_id, self.dead, self.age, self.spouse = sim_id, False, 'ADULT', None
                self.children, self.buffs = [], []
                self.pregnancy_tracker = types.SimpleNamespace(is_pregnant=False)
            def get_active_buff_types(self):
                return self.buffs
        self.Sim = Sim
        self.sims[1], self.sims[2] = Sim(1), Sim(2)
        def sim_data(si, in_household, full):
            return dict(id=str(si.sim_id),first='Sample'+str(si.sim_id),last='Family',age=si.age,
                        dead=si.dead,inHousehold=in_household,spouse=si.spouse,parents=[],children=list(si.children))
        self.sync = module('twentygen_sync',_slot_id=lambda:self.slot,_folder=lambda:self.temp.name,
            _sim=sim_data,_is_dead=lambda si:si.dead,L=types.SimpleNamespace(log=self.logs.append))
        self.sync.build_snapshot = lambda: dict(at=1700000000,legacy=dict(claimed=True,slot=self.slot),
            household=dict(id=self.hh),sims=[sim_data(si,True,False) for si in self.sims.values()])
        def write(reason):
            self.sent.append(copy.deepcopy(self.sync.build_snapshot()))
        self.sync.write_snapshot = write
        module('services',active_household=lambda:types.SimpleNamespace(id=self.hh),
            sim_info_manager=lambda:types.SimpleNamespace(get=self.sims.get))
        class Events:
            AgedUp='age';SpouseEvent='spouse';OffspringCreated='birth';ChildAdopted='adopt'
            BuffBeganEvent='buff';BuffEndedEvent='unbuff';InteractionStart='interaction'
        self.Events=Events
        class Manager:
            def process_event(self,event_type,sim_info=None,**kwargs):
                owner.calls.append(event_type)
                return 'event-result'
        self.Manager=Manager
        module('event_testing');module('event_testing.test_events',TestEvent=Events)
        module('event_testing.event_manager_service',EventManagerService=Manager)
        class Death:
            def __init__(self, si):self._sim_info=si
            def _set_death_type(self, value):self._sim_info.dead=True;return 'died'
            def clear_death_type(self):self._sim_info.dead=False;return 'revived'
        self.Death=Death
        class DeathInteraction:
            def __init__(self,si):
                self.sim=types.SimpleNamespace(sim_info=si)
                self.global_outcome_result='success'
                self._has_completed_death=False
            def _exited_pipeline(self):return 'completed'
        self.DeathInteraction=DeathInteraction
        module('interactions');module('interactions.utils')
        module('interactions.utils.death',DeathTracker=Death)
        module('interactions.utils.death_interactions',DeathSuperInteraction=DeathInteraction)
        module('interactions.utils.outcome_enums',OutcomeResult=types.SimpleNamespace(SUCCESS='success'))
        class Pregnancy:
            def __init__(self,si):self._sim_info=si;self.is_pregnant=False
            def start_pregnancy(self,*args):self.is_pregnant=True;return 'pregnant'
        self.Pregnancy=Pregnancy
        module('sims');module('sims.pregnancy');module('sims.pregnancy.pregnancy_tracker',PregnancyTracker=Pregnancy)
        path=pathlib.Path(__file__).parent.parent/'sync/mod/twentygen_life.py'
        spec=importlib.util.spec_from_file_location('life_test_module',str(path))
        self.life=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.life)
        self.sync.build_snapshot()

    def kinds(self):
        return [e['kind'] for e in self.sent[-1]['lifeEvents']] if self.sent else []

    def test_death_and_revival_survive_coalescing_and_restart(self):
        death=self.Death(self.sims[1])
        self.assertEqual(death._set_death_type(1),'died')
        self.assertEqual(death.clear_death_type(),'revived')
        self.assertEqual(self.kinds(),['death','revive'])
        path=self.life._path()
        with open(path,encoding='utf8') as stream:data=json.load(stream)
        self.assertEqual([e['kind'] for e in data['events']],['death','revive'])
        self.life._context=None
        self.assertEqual(len(self.sync.build_snapshot()['lifeEvents']),2)
        self.assertFalse(self.sims[1].dead)

    def test_successful_rescue_is_distinct_from_failure(self):
        interaction=self.DeathInteraction(self.sims[1])
        self.assertEqual(interaction._exited_pipeline(),'completed')
        self.assertEqual(self.kinds(),['rescue'])
        interaction.global_outcome_result='failure';interaction._exited_pipeline()
        self.assertEqual(self.kinds(),['rescue'])

    def test_explicit_preterm_signal_and_abduction_without_chance_false_positives(self):
        manager=self.Manager();si=self.sims[1]
        chance=type('buff_AlienAbduction_VeryHigh',(),{})
        spotting=type('Pandasama:buff_Uncomfortable_spotting_1',(),{})
        for buff in [chance,spotting]:manager.process_event(self.Events.BuffBeganEvent,sim_info=si,buff=buff)
        self.assertEqual(self.kinds(),[])
        actual=type(self.life.PRETERM_BUFF_NAME,(),{'guid64':self.life.PRETERM_BUFF_ID})
        si.buffs.append(actual)
        manager.process_event(self.Events.BuffBeganEvent,sim_info=si,buff=actual)
        manager.process_event(self.Events.BuffBeganEvent,sim_info=si,buff=actual)
        self.assertEqual(self.kinds(),['preterm'])
        interaction=type('alienAbduction_BeAbducted',(),{})()
        manager.process_event(self.Events.InteractionStart,sim_info=si,interaction=interaction)
        returned=type('buff_ReturnedFromAbduction_Dazed',(),{})
        si.buffs.append(returned)
        manager.process_event(self.Events.BuffBeganEvent,sim_info=si,buff=returned)
        self.assertEqual(self.kinds(),['preterm','abduct'])

    def test_other_save_and_unknown_sim_do_not_generate_news(self):
        self.slot='88';self.Death(self.sims[1])._set_death_type(1)
        self.assertEqual(self.sent,[])
        self.slot='77';self.Death(self.Sim(99))._set_death_type(1)
        self.assertEqual(self.sent,[])

    def test_hooks_are_idempotent_and_keep_original_return_values(self):
        self.life.install(self.sync);self.life.install(self.sync)
        result=self.Manager().process_event(self.Events.AgedUp,sim_info=self.sims[1])
        self.assertEqual(result,'event-result');self.assertEqual(self.calls,['age'])
        self.sims[1].age='ELDER'
        self.Manager().process_event(self.Events.AgedUp,sim_info=self.sims[1])
        self.assertEqual(self.kinds(),['ageup'])

    def test_corrupt_journal_is_preserved(self):
        path=self.life._path()
        with open(path,'w',encoding='utf8') as stream:stream.write('broken journal')
        self.life._context=None
        self.sync.build_snapshot()
        with open(path,encoding='utf8') as stream:self.assertEqual(stream.read(),'broken journal')
        self.assertIsNone(self.life._context)

    def test_missing_buff_api_does_not_claim_a_known_false_state(self):
        si=types.SimpleNamespace(pregnancy_tracker=types.SimpleNamespace(is_pregnant=True))
        self.assertEqual(self.life._life(si),{'pregnant':True})


if __name__=='__main__':unittest.main()

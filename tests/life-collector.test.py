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
        self.module=module
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

    def test_family_capture_is_partial_and_does_not_claim_save_lineage_or_order(self):
        snap=self.sync.build_snapshot()
        capture=snap['familyCapture']
        self.assertEqual(capture['completeness'],'partial')
        self.assertEqual(capture['saveIdentity'],'unverified')
        self.assertEqual(capture['captureOrder'],'unverified')
        self.assertEqual(len(capture['streamId']),32)
        self.assertEqual(len(capture['captureId']),32)
        self.assertEqual(snap['sims'][0]['id'],'1')

    def test_direct_genealogy_uses_each_sims_own_parents_and_children(self):
        self.sims[1].genealogy=types.SimpleNamespace(get_parent_sim_ids_gen=lambda:iter([18446744073709551615]),
            get_children_sim_ids_gen=lambda:iter([2,3,4]))
        self.sims[2].genealogy=types.SimpleNamespace(get_parent_sim_ids_gen=lambda:iter([]),
            get_children_sim_ids_gen=lambda:iter(range(100,140)))
        snap=self.sync.build_snapshot()
        self.assertEqual(snap['sims'][0]['parents'],['18446744073709551615'])
        self.assertEqual(snap['sims'][0]['children'],['2','3','4'])
        self.assertEqual(snap['sims'][0]['familyObservation']['children'],'observed')
        self.assertEqual(snap['sims'][1]['familyObservation']['children'],'partial')
        self.assertEqual(len(snap['sims'][1]['children']),30)

    def test_official_getters_take_priority_and_community_fallback_is_conservative(self):
        self.sims[1].genealogy=types.SimpleNamespace(get_parent_sim_ids_gen=lambda:iter([11]),
            get_parent_sim_infos_gen=lambda:iter([99]),get_children_sim_ids_gen=lambda:iter([12]),
            get_child_sim_infos_gen=lambda:iter([98]))
        self.sims[2]._genealogy_tracker=types.SimpleNamespace(get_parent_sim_infos_gen=lambda:iter([types.SimpleNamespace(id=18446744073709551615)]),
            get_child_sim_infos_gen=lambda:iter([3]))
        snap=self.sync.build_snapshot()
        self.assertEqual(snap['sims'][0]['parents'],['11']);self.assertEqual(snap['sims'][0]['children'],['12'])
        self.assertEqual(snap['sims'][1]['parents'],['18446744073709551615']);self.assertEqual(snap['sims'][1]['children'],['3'])
        self.sims[2]._genealogy_tracker=types.SimpleNamespace(get_parent_sim_infos_gen=lambda:iter([1.5]))
        snap=self.sync.build_snapshot();self.assertEqual(snap['sims'][1]['familyObservation']['parents'],'unknown')

    def test_read_only_graph_capture_reports_flags_without_guessing_end_or_parent_direction(self):
        self.module('family_tree')
        self.module('family_tree.family_tree_enums',FamilyTreeTraversalMode=types.SimpleNamespace(TRAVERSAL_BREADTH_FIRST=1),
            FamilyRelationBitFlags=types.SimpleNamespace(SPOUSE=4,FIANCE=8,STEADY=16))
        calls=[]
        class Graph:
            def traverse(self,root,visitor_function,max_depth,edge_filter_function,traversal_mode):
                calls.append((root,max_depth,traversal_mode));visitor_function(object())
                for a,b,flags in [(1,8,4),(1,9,8),(1,10,16),(1,11,1)]:
                    self.assert_false(edge_filter_function(types.SimpleNamespace(source_sim_id=a,target_sim_id=b,edge_data=flags),[]))
            @staticmethod
            def assert_false(value):
                if value is not False:raise AssertionError('must not traverse')
        sys.modules['services'].family_tree_service=lambda:types.SimpleNamespace(family_tree_graph=Graph())
        snap=self.sync.build_snapshot();rels=snap['familyRelationships']
        self.assertEqual(len(calls),2);self.assertTrue(all(call[1]==1 for call in calls))
        self.assertEqual({(x['a'],x['b'],tuple(x['flags'])) for x in rels}, {('1','8',('spouse',)),('1','9',('fiance',)),('1','10',('steady',))})

    def test_stream_sequence_survives_restart_and_failed_write_is_not_emitted(self):
        first=self.sync.build_snapshot()['familyCapture']
        self.life._context=None
        second=self.sync.build_snapshot()['familyCapture']
        self.assertEqual(second['streamId'],first['streamId'])
        self.assertEqual(second['sequence'],first['sequence']+1)
        self.assertNotEqual(second['captureId'],first['captureId'])
        old=self.life._persist
        self.life._persist=lambda: (_ for _ in ()).throw(OSError('disk'))
        try: failed=self.sync.build_snapshot()['familyCapture']
        finally: self.life._persist=old
        self.assertNotIn('sequence',failed)
        self.assertEqual(self.sync.build_snapshot()['familyCapture']['sequence'],second['sequence']+1)

    def test_family_metadata_does_not_appear_for_unclaimed_save(self):
        snap={'legacy':{'claimed':False},'household':{'id':'900'},'sims':[]}
        self.assertNotIn('familyCapture',self.life._decorate(snap))


if __name__=='__main__':unittest.main()

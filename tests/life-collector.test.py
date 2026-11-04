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
        self.extra={}
        module('services',active_household=lambda:types.SimpleNamespace(id=self.hh),
            sim_info_manager=lambda:types.SimpleNamespace(get=lambda i:self.sims.get(i) or self.extra.get(i)))
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
        class Rel:
            def __init__(self,si):self._sim_info=si;self.bits=[]
            def add_relationship_bit(self,target_sim_id,bit_to_add,*a,**k):self.bits.append(bit_to_add);return 'added'
            def remove_relationship_bit(self,target_sim_id,bit,*a,**k):return 'removed'
            def get_all_bits(self,target):return list(self.bits)
        self.Rel=Rel
        module('relationships');module('relationships.relationship_tracker',RelationshipTracker=Rel)
        class Milestones:
            def __init__(self,si):self._sim_info=si
            def complete_milestone(self,milestone,*a):return 'done'
        self.Milestones=Milestones
        module('milestones');module('milestones.milestone_tracker',MilestoneTracker=Milestones)
        class Traits:
            def __init__(self,si):self._sim_info=si
            def _add_trait(self,trait,*a):return 'trait'
        self.Traits=Traits
        module('traits');module('traits.trait_tracker',TraitTracker=Traits)
        path=pathlib.Path(__file__).parent.parent/'sync/mod/twentygen_life.py'
        spec=importlib.util.spec_from_file_location('life_test_module',str(path))
        self.life=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.life)
        self.clock=[1000.0];self.life._now=lambda:self.clock[0];self.life._probe['at']=-1e9
        self.sync.build_snapshot()

    def bit(self,name,guid=7):return type(name,(),{'guid64':guid})

    def events(self,kind=None):
        ev=self.sent[-1]['lifeEvents'] if self.sent else []
        return [e for e in ev if kind is None or e['kind']==kind]

    def probe_lines(self):
        try:
            with open(pathlib.Path(self.temp.name)/'probe.log',encoding='utf8') as f:return [l.rstrip('\n').split('\t') for l in f]
        except FileNotFoundError:return []

    def probe_on(self):
        (pathlib.Path(self.temp.name)/'probe.on').write_text('1');self.clock[0]+=61

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

    # ---- v2: name fix, species, cause
    def load_real_sync(self):
        src=(pathlib.Path(__file__).parent.parent/'sync/mod/twentygen_sync.py').read_text(encoding='utf8')
        ns={'__file__':str(pathlib.Path(self.temp.name)/'x.py'),'__name__':'real_sync_under_test'}
        exec(compile(src.split('# ---------------------------------------------------------------- start')[0],'sync','exec'),ns)
        return ns

    def test_name_fix_for_instances_and_classes(self):
        ns=self.load_real_sync();_name=ns['_name']
        class Blueprint:pass
        inst=Blueprint();inst.__name__='trait_Lovebug'
        self.assertEqual(_name(inst),'trait_Lovebug')
        self.assertEqual(_name(Blueprint),'Blueprint')
        self.assertEqual(_name(Blueprint()),'Blueprint')
        self.assertEqual(_name(None),'')

    def test_species_and_death_cause_in_sim_dict(self):
        ns=self.load_real_sync()
        si=types.SimpleNamespace(sim_id=5,first_name='A',last_name='B',species=types.SimpleNamespace(name='DOG'),
            is_dead=True,death_type=types.SimpleNamespace(name='ELECTROCUTION'))
        d=ns['_sim'](si,True,False)
        self.assertEqual((d['species'],d['dead'],d['deathCause']),('DOG',True,'ELECTROCUTION'))
        bare=types.SimpleNamespace(sim_id=6)
        d=ns['_sim'](bare,True,False)
        self.assertEqual(d['species'],'');self.assertNotIn('deathCause',d)
        si.death_type=None
        self.assertEqual(ns['_sim'](si,True,False)['deathCause'],'')

    def test_death_carries_cause_only_when_known(self):
        self.sims[1].death_type=types.SimpleNamespace(name='LAUGHTER')
        self.Death(self.sims[1])._set_death_type(1)
        self.assertEqual(self.events('death')[0]['cause'],'LAUGHTER')
        self.Death(self.sims[2])._set_death_type(1)
        self.assertNotIn('cause',self.events('death')[1])

    def test_cause_detector_off_omits_cause(self):
        self.life.DETECTORS['cause']=False;self.sims[1].death_type=types.SimpleNamespace(name='LAUGHTER')
        self.Death(self.sims[1])._set_death_type(1)
        self.assertEqual(self.kinds(),['death']);self.assertNotIn('cause',self.events('death')[0])

    # ---- adoption and twins
    def birth(self,parent,child_id):
        child=self.Sim(child_id);self.extra[child_id]=child;self.sims[parent].children.append(str(child_id));return child

    def test_adoption_is_adopt_and_birth_stays_baby(self):
        m=self.Manager();self.birth(1,10)
        m.process_event(self.Events.ChildAdopted,sim_info=self.sims[1])
        self.birth(2,11)
        m.process_event(self.Events.OffspringCreated,sim_info=self.sims[2])
        self.assertEqual(self.kinds(),['adopt','baby'])
        self.assertEqual(self.events('adopt')[0]['partnerId'],'1')

    def test_adopt_switch_off_falls_back_to_baby(self):
        self.life.DETECTORS['adopt']=False;self.birth(1,10)
        self.Manager().process_event(self.Events.ChildAdopted,sim_info=self.sims[1])
        self.assertEqual(self.kinds(),['baby'])

    def test_single_birth_is_not_twins_two_births_are(self):
        m=self.Manager();self.birth(1,10)
        m.process_event(self.Events.OffspringCreated,sim_info=self.sims[1])
        self.assertEqual(self.kinds(),['baby'])
        self.clock[0]+=60;self.birth(1,11)
        m.process_event(self.Events.OffspringCreated,sim_info=self.sims[1])
        self.assertEqual(self.kinds(),['baby','baby','twins'])
        t=self.events('twins')[0];self.assertEqual((t['count'],t['partnerId']),(2,'1'))
        self.clock[0]+=60;self.birth(1,12)
        m.process_event(self.Events.OffspringCreated,sim_info=self.sims[1])
        self.assertEqual(self.kinds().count('twins'),1);self.assertEqual(self.events('twins')[0]['count'],3)

    def test_births_far_apart_or_other_parents_are_not_twins(self):
        m=self.Manager();self.birth(1,10)
        m.process_event(self.Events.OffspringCreated,sim_info=self.sims[1])
        self.clock[0]+=601;self.birth(1,11)
        m.process_event(self.Events.OffspringCreated,sim_info=self.sims[1])
        self.birth(2,12)
        m.process_event(self.Events.OffspringCreated,sim_info=self.sims[2])
        self.assertNotIn('twins',self.kinds())

    def test_twins_switch_off(self):
        self.life.DETECTORS['twins']=False;m=self.Manager()
        for c in (10,11):
            self.birth(1,c);m.process_event(self.Events.OffspringCreated,sim_info=self.sims[1])
        self.assertEqual(self.kinds(),['baby','baby'])

    # ---- relationship bits
    def add(self,owner,target,name):
        return self.Rel(self.sims[owner] if isinstance(owner,int) else owner).add_relationship_bit(target,self.bit(name))

    def test_each_relationship_kind_records_with_partner(self):
        cases=[('romantic-Engaged','engaged'),('romantic-SignificantOther','couple'),('romantic-Promised','couple'),
               ('friendship-BFF','bff'),('friendship-ArchEnemy','enemy'),('friendship-Enemy','enemy')]
        for name,kind in cases:
            self.clock[0]+=100;self.sent.clear()
            self.assertEqual(self.add(1,2,name),'added')
            self.assertEqual(self.kinds()[-1:],[kind],name)
            self.assertEqual(self.events(kind)[-1]['partnerId'],'2')

    def test_unrelated_bit_and_outsider_do_not_record(self):
        self.add(1,2,'romantic-Flirty');self.add(1,2,'friendship-Friend')
        self.add(self.Sim(99),1,'romantic-Engaged')
        self.assertEqual(self.sent,[])

    def test_double_add_is_deduped_then_allowed_after_ten_seconds(self):
        self.add(1,2,'romantic-Engaged');self.add(2,1,'romantic-Engaged')
        self.assertEqual(self.kinds(),['engaged'])
        self.clock[0]+=11;self.add(2,1,'romantic-Engaged')
        self.assertEqual(self.kinds(),['engaged','engaged'])

    def test_breakup_when_couple_bit_removed_with_both_alive(self):
        self.Rel(self.sims[1]).remove_relationship_bit(2,self.bit('romantic-SignificantOther'))
        self.assertEqual(self.kinds(),['breakup']);self.assertEqual(self.events('breakup')[0]['partnerId'],'2')
        self.Rel(self.sims[2]).remove_relationship_bit(1,self.bit('romantic-SignificantOther'))
        self.assertEqual(self.kinds(),['breakup'])

    def test_breakup_false_positives(self):
        r=self.Rel(self.sims[1]);couple=self.bit('romantic-SignificantOther')
        self.sims[2].dead=True;r.remove_relationship_bit(2,couple)
        self.sims[2].dead=False;self.sims[1].dead=True;r.remove_relationship_bit(2,couple)
        self.sims[1].dead=False;r.remove_relationship_bit(77,couple)  # partner unknown to the game
        self.sims[1].spouse='2';r.remove_relationship_bit(2,couple)  # married now
        self.sims[1].spouse=None;r.remove_relationship_bit(2,self.bit('friendship-BFF'))
        r.remove_relationship_bit(2,self.bit('romantic-Flirty'))
        self.assertEqual(self.sent,[])
        r.bits=[self.bit('romantic-Engaged')];r.remove_relationship_bit(2,couple)  # became engaged
        self.assertEqual(self.sent,[])
        self.add(1,2,'romantic-Engaged')  # remembered as engaged
        self.clock[0]+=100;self.Rel(self.sims[1]).remove_relationship_bit(2,couple)
        self.assertEqual(self.kinds(),['engaged'])

    def test_rel_switch_off(self):
        self.life.DETECTORS['rel']=False;self.add(1,2,'romantic-Engaged')
        self.assertEqual(self.sent,[])

    # ---- milestones
    def test_whitelisted_milestone_records_raw_name_others_do_not(self):
        m=self.Milestones(self.sims[1])
        self.assertEqual(m.complete_milestone(self.bit('milestone_FirstWord_Toddler')),'done')
        self.assertEqual(self.events('milestone')[0]['name'],'milestone_FirstWord_Toddler')
        m.complete_milestone(self.bit('milestone_ReachedSkillLevel5'))
        m.complete_milestone(self.bit('milestone_FirstWord_Toddler'))  # repeat inside the dedupe window
        self.assertEqual(self.kinds(),['milestone'])
        self.clock[0]+=20;self.Milestones(self.Sim(99)).complete_milestone(self.bit('milestone_FirstStep'))
        self.assertEqual(self.kinds(),['milestone'])

    def test_milestone_private_method_fallback(self):
        class Only:
            def __init__(s,si):s._sim_info=si
            def _complete_milestone(s,milestone):return 'private'
        sys.modules['milestones.milestone_tracker'].MilestoneTracker=Only
        spec=importlib.util.spec_from_file_location('life_b',str(pathlib.Path(__file__).parent.parent/'sync/mod/twentygen_life.py'))
        life=importlib.util.module_from_spec(spec);spec.loader.exec_module(life)
        self.assertTrue(getattr(Only._complete_milestone,'_tg_life_v1',False))
        self.assertEqual(Only(self.sims[1])._complete_milestone(self.bit('FirstStep')),'private')

    def test_milestone_switch_off(self):
        self.life.DETECTORS['milestone']=False
        self.Milestones(self.sims[1]).complete_milestone(self.bit('milestone_FirstWord'))
        self.assertEqual(self.sent,[])

    # ---- loading and household gates
    def test_existing_bit_readded_on_load_is_not_news(self):
        r=self.Rel(self.sims[1]);r.has_bit=lambda t,b:True
        r.add_relationship_bit(2,self.bit('romantic-Engaged'));self.assertEqual(self.sent,[])
    def test_relationship_of_a_relative_outside_the_household_is_not_news(self):
        self.life._known['1']['inHousehold']=False
        self.add(1,2,'romantic-Engaged');self.assertEqual(self.sent,[])
    def test_nothing_while_a_lot_is_loading(self):
        self.life._ready['on']=False
        self.add(1,2,'romantic-Engaged');self.Milestones(self.sims[1]).complete_milestone(self.bit('milestone_FirstWord'))
        self.assertEqual(self.sent,[])

    # ---- detectors.json
    def test_detectors_json_overrides_at_install(self):
        (pathlib.Path(self.temp.name)/'detectors.json').write_text(json.dumps({'rel':False,'twins':'no','bogus':True}))
        self.life._load_detectors()
        self.assertEqual(self.life.DETECTORS,{'rel':False,'milestone':True,'twins':True,'adopt':True,'cause':True})
        self.add(1,2,'romantic-Engaged');self.assertEqual(self.sent,[])
        (pathlib.Path(self.temp.name)/'detectors.json').write_text('not json')
        self.life._load_detectors();self.assertTrue(self.life.DETECTORS['rel'])

    # ---- probe
    def test_probe_log_format_and_normal_capture_continues(self):
        self.probe_on();m=self.Manager();si=self.sims[1]
        buff=self.bit('buff_Happy',123)
        m.process_event(self.Events.BuffBeganEvent,sim_info=si,buff=buff)
        self.Rel(si).add_relationship_bit(2,self.bit('romantic-Engaged',55))
        self.Rel(si).remove_relationship_bit(2,self.bit('romantic-SignificantOther',56))
        self.Traits(si)._add_trait(self.bit('trait_Lovebug',9))
        self.Milestones(si).complete_milestone(self.bit('milestone_Other',3))
        si.death_type=types.SimpleNamespace(name='DROWN');self.Death(si)._set_death_type(1)
        m.process_event(self.Events.AgedUp,sim_info=self.Sim(99))  # not family: not logged
        self.assertEqual([e['kind'] for e in self.sent[-1]['lifeEvents']],['engaged','death']);self.assertEqual(self.calls,['buff','age'])
        rows=self.probe_lines()
        cats=[r[1] for r in rows]
        self.assertEqual(cats,['event','buff','relbit_add','relbit_remove','trait','milestone','death'])
        for r in rows:
            self.assertEqual(len(r),5);self.assertRegex(r[0],r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$');self.assertEqual(r[4],'1')
        self.assertEqual(rows[1][2:],['buff_Happy','123','1']);self.assertEqual(rows[2][2:],['romantic-Engaged','55','1'])
        self.assertEqual(rows[6][2],'DROWN');self.assertEqual(rows[0][2],'BuffBeganEvent')
        self.assertTrue(list(pathlib.Path(self.temp.name).glob('life-events-*.json')))

    def test_probe_event_names_logged_first_then_every_hundredth(self):
        self.probe_on();m=self.Manager()
        for _ in range(201):m.process_event(self.Events.AgedUp,sim_info=self.sims[1])
        n=[r for r in self.probe_lines() if r[1]=='event']
        self.assertEqual(len(n),3)  # 1st, 100th, 200th

    def test_probe_off_without_file_and_rechecked_at_most_every_60s(self):
        self.Rel(self.sims[1]).add_relationship_bit(2,self.bit('romantic-Flirty'))
        self.assertEqual(self.probe_lines(),[])
        (pathlib.Path(self.temp.name)/'probe.on').write_text('1');self.clock[0]+=30
        self.Rel(self.sims[1]).add_relationship_bit(2,self.bit('romantic-Flirty'))
        self.assertEqual(self.probe_lines(),[])
        self.clock[0]+=31
        self.Rel(self.sims[1]).add_relationship_bit(2,self.bit('romantic-Flirty'))
        self.assertEqual(len(self.probe_lines()),1)

    def test_probe_log_rotates_at_2mb(self):
        self.probe_on();log=pathlib.Path(self.temp.name)/'probe.log'
        log.write_bytes(b'x'*(2*1024*1024+1))
        self.Rel(self.sims[1]).add_relationship_bit(2,self.bit('romantic-Flirty'))
        self.assertEqual((pathlib.Path(self.temp.name)/'probe.log.1').stat().st_size,2*1024*1024+1)
        self.assertEqual(len(self.probe_lines()),1)

    def test_missing_game_modules_never_break_install(self):
        for name in ('relationships.relationship_tracker','milestones.milestone_tracker','traits.trait_tracker'):sys.modules[name]=None
        spec=importlib.util.spec_from_file_location('life_c',str(pathlib.Path(__file__).parent.parent/'sync/mod/twentygen_life.py'))
        life=importlib.util.module_from_spec(spec);spec.loader.exec_module(life)
        self.assertTrue(life._installed)


if __name__=='__main__':unittest.main()

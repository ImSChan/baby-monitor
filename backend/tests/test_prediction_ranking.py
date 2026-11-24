"""Run the production pure fusion functions without importing model download/GPU dependencies.

The AST boundary excludes only heavy imports and model-loading functions; the
actual fusion/helpers/constants are compiled unchanged from model_runtime.py.
"""
import ast
from pathlib import Path
from typing import Any


def fusion():
    path=Path(__file__).parents[1]/'app/services/model_runtime.py'
    tree=ast.parse(path.read_text(encoding='utf-8'))
    functions={'fuse_results','build_state_candidates','is_quiet_audio','normal_candidate',
               'prediction_copy','parse_float','parse_bool','clamp_confidence'}
    constants={'NORMAL_CONFIDENCE_THRESHOLD','QUIET_RMS_DBFS_THRESHOLD','QUIET_PEAK_DBFS_THRESHOLD'}
    nodes=[node for node in tree.body if
        isinstance(node,ast.FunctionDef) and node.name in functions or
        isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id in constants for target in node.targets)]
    scope={'Any':Any}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(path),'exec'),scope)
    return scope['fuse_results']


def test_actual_runtime_keeps_three_ranked_candidates_and_primary_score():
    result=fusion()({'label':'hungry','confidence':.9},{'label':'unhappy','confidence':.8})
    assert [row['need'] for row in result['topPredictions']]==['feeding','care','sleep']
    assert result['confidence']==result['topPredictions'][0]['confidence']
    assert result['topPredictions'][1]['confidence']>=result['topPredictions'][2]['confidence']
    assert result['normalOverride'] is False
    assert result['fusion_method']=='worker_late_fusion_top3'


def test_low_confidence_override_keeps_stable_and_two_real_alternatives():
    result=fusion()({'label':'hungry','confidence':.2},{'label':'unhappy','confidence':.2})
    assert [row['need'] for row in result['topPredictions']]==['stable','feeding','care']
    assert result['normalOverride'] is True


def test_quiet_override_does_not_invent_missing_candidates():
    result=fusion()({'label':'hungry','confidence':1},{'label':'unhappy','confidence':1},{'quiet_audio':True})
    assert result['need']=='stable' and len(result['topPredictions'])==1

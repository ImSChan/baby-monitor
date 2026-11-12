import hashlib
import json
import sys
from types import SimpleNamespace, ModuleType
from pathlib import Path
import pytest

torch = pytest.importorskip('torch')
Image = pytest.importorskip('PIL.Image')
from app.workers import train_personalized_heads as trainer
from app.services import personalized_head_store as store
from app.services.training_policy import TrainingPolicy, LABELS, job_spec
from app.models import TrainingJob


@pytest.fixture
def head_env(tmp_path, monkeypatch):
    stage = tmp_path / 'candidates'; stage.mkdir()
    weights = tmp_path / 'approved'; weights.mkdir()
    monkeypatch.setattr(trainer, 'STAGING', stage)
    monkeypatch.setattr(store, 'USER_WEIGHTS_DIR', weights)
    monkeypatch.setattr(store, 'TRAINING_DATA_DIR', stage)
    monkeypatch.setenv('TRAINING_MIN_PER_CLASS', '3')
    return stage, weights


def args(modality='audio'):
    return SimpleNamespace(job_id=1, user_id=1, modality=modality, device='cpu',
        stable_vision_as_normal=modality == 'vision', seed=17, epochs=4, batch_size=4,
        lr=.001, anchor=.1, max_audio_seconds=10)


def audio_rows():
    return [{'id': str(i), 'label': 'feeding' if i < 3 else 'sleep',
             'audio': Path('fixture.wav'), 'vision': Path('fixture.png')} for i in range(6)]


def features(*_):
    return (torch.tensor([[3., 0.]] * 3 + [[0., 3.]] * 3), torch.tensor([4]*3 + [6]*3),
            [str(i) for i in range(6)], torch.zeros(7, 2), torch.zeros(7))


def test_head_only_cpu_training_writes_candidate_and_preserves_approved_weights(head_env, monkeypatch):
    stage, weights = head_env
    active = weights / '1_audio_head.pt'
    torch.save({'weight': torch.zeros(7, 2), 'bias': torch.zeros(7)}, active)
    archive = weights / '1/audio/head_job_99.pt'
    archive.parent.mkdir(parents=True)
    archive.write_bytes(active.read_bytes())
    current = archive.parent / 'current.json'
    current.write_text('{"active_job_id": 99}', encoding='utf-8')
    before = hashlib.sha256(active.read_bytes()).hexdigest()
    versions_before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in weights.rglob('*') if p.is_file()}
    monkeypatch.setattr(trainer, 'extract', features)
    monkeypatch.setattr(store, 'promote_candidate', lambda *_: pytest.fail('automatic promotion prohibited'))
    trainer.train(args(), audio_rows(), TrainingPolicy())
    candidate = stage / 'job_1/candidate_audio_head.pt'
    report = json.loads((stage / 'job_1/candidate_audio_report.json').read_text())
    checkpoint = torch.load(candidate, weights_only=True)
    assert checkpoint['weight'].shape == (7, 2)
    assert report['training_policy']['min_per_class'] == 3
    assert report['train_n'] == 4 and report['val_n'] == 2
    assert hashlib.sha256(active.read_bytes()).hexdigest() == before
    assert {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in weights.rglob('*') if p.is_file()} == versions_before
    with pytest.raises(RuntimeError, match='already exists'):
        trainer.train(args(), audio_rows(), TrainingPolicy())
    assert hashlib.sha256(active.read_bytes()).hexdigest() == before


@pytest.mark.parametrize('ys', [[0,0,0,1,1,1], [0,0,0,0,1,1,1,1]])
def test_stratified_split_is_disjoint_and_has_every_class_in_both_sets(head_env, ys):
    y = torch.tensor(ys)
    tr, va = trainer.stratified_split(y, 17)
    assert set(tr).isdisjoint(va) and set(tr + va) == set(range(len(ys)))
    assert set(y[tr].tolist()) == set(y[va].tolist()) == {0, 1}


@pytest.mark.parametrize('ys', [[0,0,0,1,1], [0,0,0], []])
def test_stratified_split_retains_safety_exceptions(head_env, ys):
    with pytest.raises(RuntimeError): trainer.stratified_split(torch.tensor(ys), 17)


def test_split_and_preflight_honor_higher_persisted_minimum(head_env):
    with pytest.raises(RuntimeError): trainer.stratified_split(torch.tensor([0,0,0,1,1,1]), 17, 4)
    old = TrainingJob(user_id=1)
    assert job_spec(old)[1].min_per_class == 4


def test_decoding_loss_of_a_class_or_sample_rejects_candidate(head_env, monkeypatch):
    stage, _ = head_env
    def lost(*_):
        x, y, ids, w, b = features()
        return x[:-1], y[:-1], ids[:-1], w, b
    monkeypatch.setattr(trainer, 'extract', lost)
    with pytest.raises(RuntimeError, match='Decoded samples'):
        trainer.train(args(), audio_rows(), TrainingPolicy())
    assert not list(stage.rglob('*.pt'))


def test_real_image_decode_failure_stops_training_without_candidate(head_env, tmp_path, monkeypatch):
    # Actual PIL decoding, with a tiny stand-in for the unavailable EfficientNet
    # checkpoint/backbone. This tests decoder drops and post-decode policy, not model quality.
    stage, _ = head_env
    class FakeModel(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.classifier = torch.nn.Sequential(torch.nn.Identity(), torch.nn.Linear(2, 3))
            self.avgpool = torch.nn.Identity()
        def load_state_dict(self, *_a, **_k): pass
        def features(self, x): return torch.ones(x.shape[0], 2, 1, 1)
    vision = ModuleType('torchvision')
    vision.models = SimpleNamespace(efficientnet_v2_s=lambda **_: FakeModel())
    vision.transforms = SimpleNamespace(
        Compose=lambda _: lambda im: torch.zeros(3, 2, 2), Resize=lambda *_: None,
        ToTensor=lambda: None, Normalize=lambda **_: None)
    monkeypatch.setitem(sys.modules, 'torchvision', vision)
    monkeypatch.setattr(torch, 'load', lambda *a, **k: {})
    rows = []
    for i in range(6):
        path = tmp_path / f'{i}.png'
        if i == 5: path.write_bytes(b'not an image')
        else: Image.new('RGB', (2, 2)).save(path)
        rows.append({'id': str(i), 'label': 'care' if i < 3 else 'stable', 'vision': path, 'audio': None})
    with pytest.raises(RuntimeError, match='Decoded samples'):
        trainer.train(args('vision'), rows, TrainingPolicy(3, True))
    assert not list(stage.rglob('*.pt'))

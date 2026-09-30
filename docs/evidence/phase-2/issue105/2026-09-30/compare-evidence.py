"""Evidence-only full-image counts and DOM contribution analysis; never writes a baseline."""
import json
from hashlib import sha256
from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
REFERENCE = ROOT / 'docs/evidence/basic-design-runtime-20260922/reference'
BASELINES = {
    'app-create': '16-submit.png',
    'app-create-validation-error': '17-submit-error.png',
    'app-edit': '13-edit.png',
    'app-detail-private': '12-detail-private.png',
}


def compare(actual, expected):
    a, b = Image.open(actual).convert('RGBA'), Image.open(expected).convert('RGBA')
    result = {'actual': list(a.size), 'expected': list(b.size), 'differentPixels': None}
    if a.size == b.size:
        delta = ImageChops.difference(a, b)
        result['differentPixels'] = sum(any(pixel) for pixel in delta.get_flattened_data())
        result['bounds'] = delta.convert('RGB').getbbox()
    return result


def main():
    source = json.loads((HERE / 'source/dom.json').read_text())
    before = json.loads((HERE / 'before/dom.json').read_text())
    after = json.loads((HERE / 'normalized/dom.json').read_text())
    rows = []
    for original in source:
        state, viewport = original['state'], original['viewport']
        tag = f"{viewport['width']}x{viewport['height']}"
        old = next(row for row in before if row['state'] == state and row['viewport'] == viewport)
        new = next(row for row in after if row['state'] == state and row['viewport'] == viewport)
        replay = ROOT / original['actualArtifact']
        counterfactual = ROOT / new['counterfactualArtifact']
        assert sha256(replay.read_bytes()).hexdigest() == original['actualSha256'], replay
        assert sha256(counterfactual.read_bytes()).hexdigest() == new['counterfactualSha256'], counterfactual
        row = {
            'state': state, 'viewport': viewport,
            'originalHeight': original['height'], 'beforeHeight': old['height'], 'afterHeight': new['height'],
            'sourceReplayVsPreserved': compare(replay, REFERENCE / tag / BASELINES[state]),
            'counterfactualVsSourceReplay': compare(counterfactual, replay),
        }
        sections = lambda record: [element for element in record['elements'] if element['tag'] == 'SECTION']
        row['sections'] = [
            {'name': s['text'][:25], 'source': s['height'], 'before': o['height'], 'after': n['height'],
             'sourceY': s['y'], 'beforeY': o['y'], 'afterY': n['y']}
            for s, o, n in zip(sections(original), sections(old), sections(new))
        ]
        rows.append(row)
    (HERE / 'cause-analysis.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    print('20 cause records; full-image counterfactual pixels:', [row['counterfactualVsSourceReplay']['differentPixels'] for row in rows])


if __name__ == '__main__':
    main()

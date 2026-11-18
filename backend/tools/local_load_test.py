"""Bounded loopback-only API/signaling load test using disposable synthetic data.

python tools/local_load_test.py --output C:/path/to/results --seconds 10
Never accepts a remote target, reads production .env, runs inference/training, or sends FCM.
"""
import argparse
import asyncio
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from uuid import uuid4
import httpx
import websockets

READS = ['/api/dashboard', '/api/emotions/history?limit=20', '/api/push/events?limit=20',
         '/api/reviews?limit=20', '/api/training/status', '/api/training/analysis-status', '/api/live/sessions']


def percentile(values, quantile):
    values = sorted(values)
    return round(values[min(len(values)-1, max(0, math.ceil(len(values)*quantile)-1))], 2) if values else None


def summarize(samples, elapsed):
    statuses = Counter(str(row['status']) for row in samples)
    unexpected = [row for row in samples if row['status'] != 200]
    grouped = defaultdict(list)
    for row in samples:
        grouped[row['endpoint']].append(row)
    def timing(rows):
        values = [row['ms'] for row in rows]
        return {'requests': len(rows), 'p50Ms': percentile(values, .5), 'p95Ms': percentile(values, .95),
                'p99Ms': percentile(values, .99), 'maxMs': round(max(values), 2) if values else None}
    return {**timing(samples), 'elapsedSeconds': round(elapsed, 2),
        'requestsPerSecond': round(len(samples)/elapsed, 2), 'statuses': dict(statuses),
        'unexpectedResponses': len(unexpected), 'unexpectedRate': round(len(unexpected)/len(samples), 4) if samples else 0,
        'byEndpoint': {key: timing(rows) for key, rows in grouped.items()}}


async def timed(client, method, endpoint, uid, samples, **kwargs):
    start = time.perf_counter()
    try:
        response = await client.request(method, endpoint, **kwargs)
        status = response.status_code
    except httpx.HTTPError as error:
        response = None
        status = type(error).__name__
    samples.append({'endpoint': endpoint.split('?')[0], 'status': status,
                    'ms': (time.perf_counter()-start)*1000, 'account': uid})
    return response


async def read_stage(client, users, vus, seconds, label='read'):
    samples = []; start = time.perf_counter(); deadline = start + seconds
    before = (await client.get('/load/metrics')).json()
    stop = asyncio.Event()
    async def user(index):
        identity = users[index % len(users)]; n = index
        headers = {'Authorization': 'Bearer ' + identity['token']}
        while time.perf_counter() < deadline and not stop.is_set():
            await timed(client, 'GET', READS[n % len(READS)], identity['id'], samples, headers=headers)
            n += 1
            # A bounded closed-loop workload, not an open-loop production capacity estimate.
            if len(samples) >= 100 and sum(row['status'] != 200 for row in samples[-100:]) > 20:
                stop.set()
            await asyncio.sleep(.03)
    await asyncio.gather(*(user(i) for i in range(vus)))
    elapsed = time.perf_counter()-start
    after = (await client.get('/load/metrics')).json()
    return {'phase': label, 'virtualUsers': vus, 'thinkTimeMs': 30, 'stoppedEarly': stop.is_set(),
        **summarize(samples, elapsed), 'serverCpuSeconds': round(after['cpuSeconds']-before['cpuSeconds'], 2),
        'serverRssBytes': after['rssBytes'], 'serverPeakRssBytes': after['peakRssBytes'],
        'systemAvailableRamBytes': after['availableRamBytes']}


async def login_stage(client, users, vus, seconds):
    samples = []; start = time.perf_counter(); deadline = start + seconds
    before = (await client.get('/load/metrics')).json()
    async def user(index):
        identity = users[index % len(users)]
        while time.perf_counter() < deadline:
            await timed(client, 'POST', '/api/auth/login', identity['id'], samples,
                json={'email': identity['email'], 'password': 'local-load-fixture-only-password'})
            await asyncio.sleep(.1)
    await asyncio.gather(*(user(i) for i in range(vus)))
    after = (await client.get('/load/metrics')).json()
    return {'phase': 'login', 'virtualUsers': vus, 'thinkTimeMs': 100, **summarize(samples, time.perf_counter()-start),
        'serverCpuSeconds': round(after['cpuSeconds']-before['cpuSeconds'], 2),
        'serverRssBytes': after['rssBytes'], 'serverPeakRssBytes': after['peakRssBytes']}


async def feedback_stage(client, users):
    samples = []; start = time.perf_counter()
    counters = Counter()
    async def user(identity):
        headers = {'Authorization': 'Bearer ' + identity['token']}
        for index in range(12):
            endpoint = '/api/reviews/events/' + str(identity['eventId']) + '/feedback'
            summary = await timed(client, 'GET', endpoint, identity['id'], samples, headers=headers)
            if summary is None or summary.status_code != 200:
                break
            payload = {'event_id': identity['eventId'], 'action_id': str(uuid4()),
                'label': ['sleep','feeding','stable','uncertain'][index % 4],
                'scope_signature': summary.json()['scopeSignature']}
            saved = await timed(client, 'POST', '/api/reviews/feedback', identity['id'], samples, headers=headers, json=payload)
            if saved is not None and saved.status_code == 200:
                counters['saved'] += 1
                if index == 0:
                    replay = await timed(client, 'POST', '/api/reviews/feedback', identity['id'], samples, headers=headers, json=payload)
                    if replay is not None and replay.status_code == 200 and replay.json() == saved.json():
                        counters['idempotentReplays'] += 1
            await asyncio.sleep(.05)
    before = (await client.get('/load/metrics')).json()
    await asyncio.gather(*(user(identity) for identity in users))
    after = (await client.get('/load/metrics')).json()
    own = users[0]; other = users[1]
    denied = await client.get('/api/reviews/events/' + str(other['eventId']) + '/feedback',
        headers={'Authorization': 'Bearer ' + own['token']})
    invariants = {'savedActions': counters['saved'], 'newActionRows': after['actions']-before['actions'],
        'idempotentReplays': counters['idempotentReplays'], 'expectedReplays': len(users),
        'uniqueFeedbackRequestIds': after['feedback'] == after['uniqueRequestIds'],
        'otherAccountRejected': denied.status_code == 404}
    invariants['passed'] = (invariants['savedActions'] == invariants['newActionRows'] and
        invariants['idempotentReplays'] == len(users) and invariants['uniqueFeedbackRequestIds'] and invariants['otherAccountRejected'])
    return {'phase': 'feedback', 'virtualUsers': len(users), 'iterationsPerAccount': 12,
        **summarize(samples, time.perf_counter()-start), 'invariants': invariants,
        'serverRssBytes': after['rssBytes']}


async def signaling_stage(client, users, rooms, seconds):
    sockets = []; tasks = []; heartbeat = Counter(); setup_start = time.perf_counter()
    base = str(client.base_url).rstrip('/').replace('http://', 'ws://')
    async def make_room(index):
        identity = users[index % len(users)]
        headers = {'Authorization': 'Bearer ' + identity['token']}
        result = await client.post('/api/live/sessions', headers=headers, json={'camera_name': 'load fixture'})
        result.raise_for_status(); sid = result.json()['sessionId']
        for role in ('host', 'viewer'):
            connection = await websockets.connect(base + '/api/live/ws/' + sid + '/' + role,
                origin='http://127.0.0.1', open_timeout=10)
            sockets.append(connection)
            await connection.send(json.dumps({'type': 'authenticate', 'token': identity['token']}))
            ack = json.loads(await asyncio.wait_for(connection.recv(), 10))
            assert ack['type'] == 'authenticated' and ack['sessionId'] == sid
            async def pump(socket=connection):
                try:
                    while True:
                        await socket.send(json.dumps({'type': 'ping'}))
                        while True:
                            message = json.loads(await asyncio.wait_for(socket.recv(), 5))
                            if message.get('type') == 'pong':
                                heartbeat['pong'] += 1; break
                        await asyncio.sleep(1)
                except asyncio.CancelledError:
                    raise
                except Exception:
                    heartbeat['errors'] += 1
            tasks.append(asyncio.create_task(pump()))
    try:
        await asyncio.gather(*(make_room(i) for i in range(rooms)))
        setup = time.perf_counter()-setup_start
        result = await read_stage(client, users, 20, seconds, label='reads_with_signaling')
        result.update(rooms=rooms, sockets=len(sockets), setupSeconds=round(setup, 2),
                      heartbeatPongs=heartbeat['pong'], heartbeatErrors=heartbeat['errors'])
    finally:
        for task in tasks: task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.gather(*(connection.close() for connection in sockets), return_exceptions=True)
    # Give the real server's disconnect cleanup a bounded chance to finish.
    remaining = None
    for _ in range(30):
        remaining = (await client.get('/load/metrics')).json()['activeSessions']
        if remaining == 0: break
        await asyncio.sleep(.1)
    result['remainingSessionsAfterClose'] = remaining
    return result


async def run(args, state, port, process):
    base = f'http://127.0.0.1:{port}'
    async with httpx.AsyncClient(base_url=base, timeout=10,
            limits=httpx.Limits(max_connections=80, max_keepalive_connections=60), trust_env=False) as client:
        info = None
        for _ in range(600):
            if process.poll() is not None: raise RuntimeError('Fixture server exited during startup')
            try:
                reply = await client.get('/load/info')
                if reply.status_code == 200:
                    info = reply.json(); break
            except httpx.HTTPError: pass
            await asyncio.sleep(.1)
        if not info or info.get('kind') != state['kind'] or info.get('runId') != state['runId']:
            raise RuntimeError('Loopback fixture identity was not verified')
        users = info.pop('users')  # Do not persist fixture JWTs.
        report = {'scope': 'isolated local API and signaling only', 'runId': state['runId'],
            'startedAtUtc': datetime.now(timezone.utc).isoformat(),
            'environment': info['environment'], 'fixture': {key: info[key] for key in ('accounts','analysesPerAccount')},
            'initialResources': info['resources'], 'phases': [], 'limitations': [
                'Temporary SQLite replaces production PostgreSQL; database lock and capacity conclusions do not transfer.',
                'Generator and API share one development PC; closed-loop results are not production capacity limits.',
                'No GPU inference, Redis queue load, actual video/audio bitrate, Android endurance, or real FCM transport.',
                'Seeded synthetic data is not personal training data; no production writes or deployments.']}
        # Warm the endpoints without including warmup in measured phases.
        for path in READS:
            response = await client.get(path, headers={'Authorization': 'Bearer '+users[0]['token']})
            response.raise_for_status()
        login_check = await client.post('/api/auth/login', json={'email': users[0]['email'], 'password': 'local-load-fixture-only-password'})
        login_check.raise_for_status()
        assert login_check.json()['user']['id'] == users[0]['id']
        async def record(task):
            phase = await task; report['phases'].append(phase)
            print(json.dumps({key: phase.get(key) for key in ('phase','virtualUsers','requests','requestsPerSecond','p95Ms','unexpectedResponses')}, ensure_ascii=True), flush=True)
            (args.output/'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        for vus in (1,5,20,50):
            await record(read_stage(client, users, vus, args.seconds))
        if args.hold:
            await record(read_stage(client, users, 20, args.hold, label='read_hold'))
        available = info['resources']['availableRamBytes']
        login_levels = (1,4,8) if available is None or available > 2*1024**3 else (1,2)
        for vus in login_levels:
            await record(login_stage(client, users, vus, min(8,args.seconds)))
        await record(feedback_stage(client, users))
        await record(signaling_stage(client, users, min(20, len(users)*8), args.seconds))
        report['finishedAtUtc'] = datetime.now(timezone.utc).isoformat()
        report['finalResources'] = (await client.get('/load/metrics')).json()
        report['passed'] = all(phase['unexpectedResponses'] == 0 for phase in report['phases']) and all(
            phase.get('invariants',{}).get('passed',True) for phase in report['phases']) and all(
            phase.get('heartbeatErrors',0) == 0 and phase.get('remainingSessionsAfterClose',0) == 0 for phase in report['phases'])
        (args.output/'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        await client.post('/load/shutdown', headers={'x-load-run': state['runId']})
        return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--seconds', type=int, default=10, choices=range(2,31))
    parser.add_argument('--hold', type=int, default=0, choices=(0,30,60,120), help='Additional bounded 20-VU hold in seconds')
    parser.add_argument('--accounts', type=int, default=8, choices=range(2,9))
    parser.add_argument('--analyses', type=int, default=240, choices=range(24,1001))
    args = parser.parse_args(); args.output = args.output.resolve(); args.output.mkdir(parents=True, exist_ok=True)
    state = {'kind': 'babyeye-local-load-fixture', 'runId': str(uuid4()),
             'accounts': args.accounts, 'analysesPerAccount': args.analyses}
    with tempfile.TemporaryDirectory(prefix='babyeye-local-load-') as temporary:
        directory = Path(temporary)
        (directory/'fixture.json').write_text(json.dumps(state))
        with socket.socket() as available:
            available.bind(('127.0.0.1',0)); port=available.getsockname()[1]
        with (args.output/'server.log').open('w',encoding='utf-8') as log:
            process = subprocess.Popen([sys.executable,str(Path(__file__).with_name('load_server.py')),
                '--state-dir',str(directory),'--port',str(port)],stdout=log,stderr=log)
            try:
                report=asyncio.run(run(args,state,port,process))
            finally:
                if process.poll() is None:
                    try: process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.terminate()
                        try: process.wait(timeout=10)
                        except subprocess.TimeoutExpired: process.kill();process.wait()
        print(json.dumps({'passed':report['passed'],'results':str(args.output/'results.json')},ensure_ascii=True))
        if not report['passed']:
            raise SystemExit(1)


if __name__ == '__main__':
    main()

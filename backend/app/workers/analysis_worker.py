import time

from app.services.model_runtime import load_models


def run_worker():
    print('Analysis worker started.')
    print('Loading models...')

    load_models()

    print('Models loaded successfully.')

    while True:
        print('Analysis worker heartbeat...')
        time.sleep(30)


if __name__ == '__main__':
    run_worker()

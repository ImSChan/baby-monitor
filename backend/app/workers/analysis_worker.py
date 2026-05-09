import time


def run_worker():
    print("Analysis worker started.")

    while True:
        # TODO:
        # 1. DB에서 analysis_enabled=true인 카메라 조회
        # 2. RTSP 또는 업로드 프레임 수집
        # 3. AI 모델 추론
        # 4. emotion_events / alerts 테이블에 결과 저장
        print("Analysis worker heartbeat...")
        time.sleep(10)


if __name__ == "__main__":
    run_worker()

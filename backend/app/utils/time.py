from datetime import datetime
from zoneinfo import ZoneInfo


KST = ZoneInfo("Asia/Seoul")


def kst_now() -> datetime:
    # DB에는 한국시간 기준 naive datetime으로 저장
    # 예: 2026-05-10 18:30:00
    return datetime.now(KST).replace(tzinfo=None)

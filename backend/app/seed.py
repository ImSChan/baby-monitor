from sqlmodel import Session, select

from app.database import create_db_and_tables, engine
from app.models import Alert, Camera, DeviceState, EmotionEvent, EnvironmentState


def seed():
    create_db_and_tables()

    with Session(engine) as session:
        existing_camera = session.exec(select(Camera)).first()

        if existing_camera:
            print("Seed data already exists.")
            return

        camera = Camera(
            name="아기 방 카메라",
            location="침실",
            stream_url=None,
            status="online",
            resolution="1080p",
            fps=30,
            analysis_enabled=True,
        )

        session.add(camera)
        session.commit()
        session.refresh(camera)

        session.add(
            EmotionEvent(
                camera_id=camera.id,
                emotion="수면 중",
                confidence=0.97,
                need="stable",
                message="아이가 편안하게 잠을 자고 있습니다.",
            )
        )

        session.add(
            EnvironmentState(
                temperature=24.0,
                humidity=45.0,
                light="적정",
                air_quality="좋음",
            )
        )

        session.add(
            Alert(
                level="normal",
                title="수면 상태 안정",
                message="특이 상황 없이 안정적인 수면 상태입니다.",
            )
        )

        session.add(
            DeviceState(
                name="수면 조명",
                type="light",
                status="on",
                description="은은한 밝기로 켜짐",
            )
        )

        session.add(
            DeviceState(
                name="가습기",
                type="humidifier",
                status="on",
                description="습도 유지 중",
            )
        )

        session.commit()

    print("Seed data inserted.")


if __name__ == "__main__":
    seed()

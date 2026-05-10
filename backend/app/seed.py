from sqlmodel import Session, select

from app.database import create_db_and_tables, engine
from app.models import Alert, AppUser, Camera, DeviceState, EmotionEvent, EnvironmentState


def seed():
    create_db_and_tables()

    with Session(engine) as session:
        user = session.exec(
            select(AppUser).where(AppUser.email == "demo@local")
        ).first()

        if user is None:
            user = AppUser(
                id=1,
                email="demo@local",
                password_hash=None,
                name="Demo User",
                role="parent",
                is_active=True,
            )
            session.add(user)
            session.commit()
            session.refresh(user)

        existing_camera = session.exec(
            select(Camera).where(Camera.user_id == user.id)
        ).first()

        if existing_camera:
            print("Seed data already exists.")
            return

        camera = Camera(
            user_id=user.id,
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
                user_id=user.id,
                camera_id=camera.id,
                emotion="수면 중",
                confidence=0.97,
                need="stable",
                message="아이가 편안하게 잠을 자고 있습니다.",
            )
        )

        session.add(
            EnvironmentState(
                user_id=user.id,
                temperature=24.0,
                humidity=45.0,
                light="적정",
                air_quality="좋음",
            )
        )

        session.add(
            Alert(
                user_id=user.id,
                level="normal",
                title="수면 상태 안정",
                message="특이 상황 없이 안정적인 수면 상태입니다.",
            )
        )

        session.add(
            DeviceState(
                user_id=user.id,
                name="수면 조명",
                type="light",
                status="on",
                description="은은한 밝기로 켜짐",
            )
        )

        session.add(
            DeviceState(
                user_id=user.id,
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

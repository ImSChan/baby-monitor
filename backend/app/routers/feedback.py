
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field as PydanticField, model_validator
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.database import get_session
from app.deps import get_current_user_id
from app.models import EmotionEvent, InferenceFeedback
from app.routers.inference import get_owned_request_metadata
from app.utils.time import kst_now


router = APIRouter()

FeedbackType = Literal["correct", "incorrect", "uncertain"]


# ============================================================
# Request / Response schemas
# ============================================================

class FeedbackCreate(BaseModel):
    request_id: str
    feedback_type: FeedbackType
    corrected_label: Optional[str] = PydanticField(
        default=None,
        max_length=100,
    )
    comment: Optional[str] = PydanticField(
        default=None,
        max_length=1000,
    )

    @model_validator(mode="after")
    def validate_feedback(self):
        if self.feedback_type == "incorrect":
            if not self.corrected_label or not self.corrected_label.strip():
                raise ValueError(
                    "incorrect 피드백에는 corrected_label이 필요합니다."
                )
        return self


class FeedbackUpdate(BaseModel):
    feedback_type: FeedbackType
    corrected_label: Optional[str] = PydanticField(
        default=None,
        max_length=100,
    )
    comment: Optional[str] = PydanticField(
        default=None,
        max_length=1000,
    )

    @model_validator(mode="after")
    def validate_feedback(self):
        if self.feedback_type == "incorrect":
            if not self.corrected_label or not self.corrected_label.strip():
                raise ValueError(
                    "incorrect 피드백에는 corrected_label이 필요합니다."
                )
        return self


class FeedbackResponse(BaseModel):
    id: int
    user_id: int
    request_id: str
    emotion_event_id: Optional[int]
    predicted_label: str
    corrected_label: Optional[str]
    feedback_type: str
    comment: Optional[str]
    training_status: str
    created_at: str
    updated_at: str


# ============================================================
# Helpers
# ============================================================

def serialize_feedback(
    feedback: InferenceFeedback,
) -> dict:
    return {
        "id": feedback.id,
        "user_id": feedback.user_id,
        "request_id": feedback.request_id,
        "emotion_event_id": feedback.emotion_event_id,
        "predicted_label": feedback.predicted_label,
        "corrected_label": feedback.corrected_label,
        "feedback_type": feedback.feedback_type,
        "comment": feedback.comment,
        "training_status": feedback.training_status,
        "created_at": feedback.created_at.isoformat(),
        "updated_at": feedback.updated_at.isoformat(),
    }


def normalize_feedback(
    feedback_type: str,
    corrected_label: Optional[str],
    predicted_label: str,
):
    if feedback_type == "correct":
        return predicted_label, "pending"

    if feedback_type == "uncertain":
        return None, "excluded"

    label = (corrected_label or "").strip()

    if not label:
        raise HTTPException(
            status_code=422,
            detail="수정할 정답을 입력해주세요.",
        )

    if label == predicted_label:
        raise HTTPException(
            status_code=422,
            detail="예측과 정답이 같으면 correct를 선택해주세요.",
        )

    return label, "pending"


def get_user_feedback(
    feedback_id: int,
    user_id: int,
    session: Session,
) -> InferenceFeedback:
    feedback = session.exec(
        select(InferenceFeedback)
        .where(InferenceFeedback.id == feedback_id)
        .where(InferenceFeedback.user_id == user_id)
    ).first()

    if feedback is None:
        raise HTTPException(
            status_code=404,
            detail="Feedback not found",
        )

    return feedback


# ============================================================
# Create feedback
# ============================================================

@router.post(
    "",
    response_model=FeedbackResponse,
    status_code=201,
)
def create_feedback(
    payload: FeedbackCreate,
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    # 1. 추론 요청 소유권 검증
    metadata = get_owned_request_metadata(
        payload.request_id,
        current_user_id,
    )

    # 2. 분석 완료 여부 검증
    if metadata.get("status") != "completed":
        raise HTTPException(
            status_code=409,
            detail="아직 완료되지 않은 추론 요청입니다.",
        )

    result = metadata.get("result")

    if not isinstance(result, dict):
        raise HTTPException(
            status_code=409,
            detail="추론 결과가 존재하지 않습니다.",
        )

    predicted_label = result.get("emotion")

    if not isinstance(predicted_label, str) or not predicted_label.strip():
        raise HTTPException(
            status_code=409,
            detail="AI 예측값을 확인할 수 없습니다.",
        )

    # 3. 중복 제출 확인
    existing = session.exec(
        select(InferenceFeedback)
        .where(
            InferenceFeedback.request_id == payload.request_id
        )
    ).first()

    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="이미 피드백이 등록된 추론 요청입니다.",
        )

    # 4. EmotionEvent 연결 확인
    event_id = result.get("emotionEventId")
    valid_event_id = None

    if event_id is not None:
        event = session.exec(
            select(EmotionEvent)
            .where(EmotionEvent.id == event_id)
            .where(EmotionEvent.user_id == current_user_id)
        ).first()

        if event is not None:
            valid_event_id = event.id

    # 5. 피드백 정규화
    corrected_label, training_status = normalize_feedback(
        payload.feedback_type,
        payload.corrected_label,
        predicted_label,
    )

    # 6. DB 저장
    feedback = InferenceFeedback(
        user_id=current_user_id,
        request_id=payload.request_id,
        emotion_event_id=valid_event_id,
        predicted_label=predicted_label,
        corrected_label=corrected_label,
        feedback_type=payload.feedback_type,
        comment=payload.comment,
        training_status=training_status,
    )

    session.add(feedback)

    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="이미 피드백이 등록된 추론 요청입니다.",
        )

    session.refresh(feedback)

    return serialize_feedback(feedback)


# ============================================================
# Get feedback list
# ============================================================

@router.get(
    "",
)
def list_feedback(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    query = (
        select(InferenceFeedback)
        .where(
            InferenceFeedback.user_id == current_user_id
        )
        .order_by(
            InferenceFeedback.created_at.desc(),
            InferenceFeedback.id.desc(),
        )
    )

    feedbacks = session.exec(
        query.offset(offset).limit(limit)
    ).all()

    return {
        "items": [
            serialize_feedback(item)
            for item in feedbacks
        ],
        "limit": limit,
        "offset": offset,
    }


# ============================================================
# Update feedback
# ============================================================

@router.patch(
    "/{feedback_id}",
    response_model=FeedbackResponse,
)
def update_feedback(
    feedback_id: int,
    payload: FeedbackUpdate,
    session: Session = Depends(get_session),
    current_user_id: int = Depends(get_current_user_id),
):
    feedback = get_user_feedback(
        feedback_id,
        current_user_id,
        session,
    )

    # 이미 학습 작업에서 사용 중인 데이터는 수정 금지
    if feedback.training_status not in (
        "pending",
        "excluded",
    ):
        raise HTTPException(
            status_code=409,
            detail="이미 학습에 반영되었거나 처리 중인 피드백입니다.",
        )

    corrected_label, training_status = normalize_feedback(
        payload.feedback_type,
        payload.corrected_label,
        feedback.predicted_label,
    )

    feedback.feedback_type = payload.feedback_type
    feedback.corrected_label = corrected_label
    feedback.comment = payload.comment
    feedback.training_status = training_status
    feedback.updated_at = kst_now()

    session.add(feedback)
    session.commit()
    session.refresh(feedback)

    return serialize_feedback(feedback)

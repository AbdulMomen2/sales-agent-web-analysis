from pydantic import BaseModel


class HoverData(BaseModel):
    element_id: str
    duration_ms: int


class ClickData(BaseModel):
    element_id: str
    rapid_click_count: int


class HesitationData(BaseModel):
    stopped_duration_ms: int


class RawMouseData(BaseModel):
    session_id: str
    hovers: list[HoverData]
    rage_clicks: list[ClickData]
    hesitations: list[HesitationData]
    movement_speed_px_sec: float

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- STRICTLY WHAT IT CAPTURES (Raw Data Models) ---
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

@app.post("/log_raw_signals")
def log_raw_signals(payload: RawMouseData):
    print(f"\n--- [RAW DATA BATCH] Session: {payload.session_id[:8]} ---")
    
    # 1. Capture: Hover position + duration
    if payload.hovers:
        for h in payload.hovers:
            print(f"Captured Hover: Cursor lingered on '{h.element_id}' for {h.duration_ms}ms")
            
    # 2. Capture: Hesitation patterns
    if payload.hesitations:
        for h in payload.hesitations:
            print(f"Captured Hesitation: Cursor stopped entirely for {h.stopped_duration_ms}ms")
            
    # 3. Capture: Movement speed
    if payload.movement_speed_px_sec > 0:
        print(f"Captured Speed: Mouse moving at {payload.movement_speed_px_sec:.2f} pixels/sec")
        
    # 4. Capture: Rage clicks
    if payload.rage_clicks:
        for rc in payload.rage_clicks:
            print(f"Captured Rage Clicks: Clicked '{rc.element_id}' {rc.rapid_click_count} times rapidly")

    return {"status": "raw_data_logged"}
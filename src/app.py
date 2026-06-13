from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src.api.ws import ConnectionManager, register_ws
from src.api.rest import register_rest
from src.pipeline.aggregator import BehaviorAggregator

app = FastAPI(title="Friend Sales Intelligence", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

aggregator = BehaviorAggregator()
manager = ConnectionManager(aggregator)

register_ws(app, manager)
register_rest(app, manager)

BASE = Path(__file__).resolve().parent.parent

app.mount("/client", StaticFiles(directory=str(BASE / "client" / "dist")), name="client")
app.mount("/dashboard", StaticFiles(directory=str(BASE / "dashboard"), html=True), name="dashboard")
app.mount("/examples", StaticFiles(directory=str(BASE / "examples")), name="examples")


@app.get("/tracking.js")
async def serve_tracker():
    return FileResponse(str(BASE / "client" / "dist" / "tracking.js"))


@app.get("/element-map.js")
async def serve_element_map():
    return FileResponse(str(BASE / "client" / "dist" / "element-map.js"))


@app.get("/dashboard.html")
async def serve_dashboard():
    return FileResponse(str(BASE / "dashboard" / "index.html"))


@app.get("/nike.html")
async def serve_nike():
    return FileResponse(str(BASE / "examples" / "nike.html"))

import json

from fastapi import WebSocket, WebSocketDisconnect

from src.pipeline.aggregator import BehaviorAggregator


class ConnectionManager:
    def __init__(self, aggregator: BehaviorAggregator):
        self.active_dashboards: list[WebSocket] = []
        self.aggregator = aggregator

    async def connect_dashboard(self, websocket: WebSocket):
        await websocket.accept()
        self.active_dashboards.append(websocket)
        print(f"[+] Agency Dashboard Connected. (Total watchers: {len(self.active_dashboards)})")

    def disconnect_dashboard(self, websocket: WebSocket):
        if websocket in self.active_dashboards:
            self.active_dashboards.remove(websocket)
            print(f"[-] Agency Dashboard Disconnected. (Total watchers: {len(self.active_dashboards)})")

    async def broadcast(self, message: str):
        for dashboard in self.active_dashboards:
            try:
                await dashboard.send_text(message)
            except Exception as e:
                print(f"Error sending to dashboard: {e}")

    async def broadcast_summary(self, raw_message: str):
        final_signals = self.aggregator.build_final_signals(raw_message)
        if not final_signals:
            return

        summary_json = json.dumps(final_signals)
        for dashboard in self.active_dashboards:
            try:
                await dashboard.send_text(summary_json)
            except Exception as e:
                print(f"Error sending summary to dashboard: {e}")


def register_ws(app, manager: ConnectionManager):

    @app.websocket("/ws/track")
    async def track_endpoint(websocket: WebSocket):
        token = websocket.query_params.get("token", "")
        if not token or len(token) < 5:
            print(f"[-] Rejected connection: Invalid Token ({token})")
            await websocket.close(code=1008)
            return

        await websocket.accept()
        print(f"[+] Authorized Track: Website using Token: {token}")

        try:
            while True:
                raw_data = await websocket.receive_text()
                await manager.broadcast(raw_data)
                await manager.broadcast_summary(raw_data)
        except WebSocketDisconnect:
            print(f"[-] Token {token} disconnected.")

    @app.websocket("/ws/dashboard")
    async def dashboard_endpoint(websocket: WebSocket):
        await manager.connect_dashboard(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect_dashboard(websocket)

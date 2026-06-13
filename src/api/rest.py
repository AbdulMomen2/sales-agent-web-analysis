import json

from fastapi.responses import FileResponse

from src.pipeline.enrichment import extract_session_features


def register_rest(app, manager):

    @app.get("/")
    def health_check():
        return {"status": "Server is running", "dashboards_connected": len(manager.active_dashboards)}

    @app.get("/export/{token}")
    async def export_session(token: str):
        session = manager.aggregator._session_state(token)
        windows = manager.aggregator._get_windows(token)
        sales_intent = manager.aggregator._get_sales_intent(token)
        features = extract_session_features(session["events"])
        element_map = manager.aggregator._get_element_map(token)

        export_data = {
            "windows": windows,
            "sales_intent": sales_intent.to_dict(),
            "features": features,
        }
        if element_map:
            export_data["element_map"] = element_map

        with open(f"/tmp/session_{token[:8]}.json", "w") as f:
            json.dump(export_data, f, indent=2)

        return FileResponse(f"/tmp/session_{token[:8]}.json", media_type="application/json")

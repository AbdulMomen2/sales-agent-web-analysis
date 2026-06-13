import json
import time

from src.core.sales_intent import SalesIntentSummary
from src.pipeline.enrichment import (
    enrich_from_map,
    parse_raw_lines,
    normalize_timestamps,
    extract_session_features,
    format_window_line,
    is_low_activity,
)
from src import config


class BehaviorAggregator:
    def __init__(self):
        self.sessions = {}
        self.windows_store = {}
        self.formatted_lines_store = {}
        self.sales_intent_store = {}

    def _session_state(self, token):
        session = self.sessions.setdefault(token, {"events": [], "last_seen": 0})
        if len(session["events"]) > config.MAX_EVENTS_PER_SESSION:
            session["events"] = session["events"][-config.MAX_EVENTS_PER_SESSION + 2000:]
        return session

    def _get_windows(self, token):
        return self.windows_store.setdefault(token, [])

    def _get_formatted_lines(self, token):
        return self.formatted_lines_store.setdefault(token, [])

    def _get_sales_intent(self, token):
        return self.sales_intent_store.setdefault(token, SalesIntentSummary())

    def _get_element_map(self, token):
        return self.sessions.setdefault(token, {}).setdefault("element_map", None)

    def _set_element_map(self, token, map_data):
        session = self._session_state(token)
        session["element_map"] = {
            "url": map_data.get("url"),
            "title": map_data.get("title"),
            "viewport": map_data.get("viewport"),
            "page": map_data.get("page"),
            "total": map_data.get("total", 0),
            "categories": map_data.get("categories", {}),
            "elements": map_data.get("elements", []),
            "received_at": int(time.time()),
        }

    def build_final_signals(self, raw_message):
        raw_events = parse_raw_lines(raw_message)
        if not raw_events:
            try:
                raw_events = [json.loads(raw_message)]
            except json.JSONDecodeError:
                return None
        if not raw_events:
            return None

        token = raw_events[0].get("token", "anonymous")
        session = self._session_state(token)

        events = normalize_timestamps(raw_events)
        if not events:
            return None

        session["events"].extend(events)
        session["last_seen"] = max((event.get("timestamp", 0) for event in session["events"]), default=0)

        windows = self._get_windows(token)
        formatted_lines = self._get_formatted_lines(token)
        sales_intent = self._get_sales_intent(token)

        for event in events:
            if event.get("type") == "window_500ms":
                data = event.get("data", {})
                window_entry = {
                    "timestamp": event.get("timestamp", 0),
                    "x": data.get("x"),
                    "y": data.get("y"),
                    "scroll_y": data.get("scroll_y", 0),
                    "element": data.get("element"),
                    "hovered_elements": data.get("hovered_elements", []),
                    "clicks": data.get("clicks", []),
                    "num_events": data.get("num_events", 0),
                    "avg_speed": data.get("avg_speed_px_sec", 0),
                    "max_hover_duration_ms": data.get("max_hover_duration_ms", 0),
                    "actions": data.get("actions", []),
                    "hesitation": data.get("hesitation", False),
                    "input_type": data.get("input_type", "unknown"),
                    "reading": data.get("reading"),
                }

                element_map = self._get_element_map(token)
                window_entry = enrich_from_map(window_entry, element_map)

                windows.append(window_entry)
                sales_intent.update(window_entry)

                if not is_low_activity(window_entry):
                    line = format_window_line(window_entry)
                    formatted_lines.append(line)

            elif event.get("type") == "click":
                data = event.get("data", {})
                session.setdefault("clicks", []).append({
                    "timestamp": event.get("timestamp", 0),
                    "x": data.get("x"),
                    "y": data.get("y"),
                    "scroll_y": data.get("scroll_y", 0),
                    "source": data.get("source", "unknown"),
                    "element": data.get("element"),
                })

            elif event.get("type") == "reading_start":
                data = event.get("data", {})
                session["last_reading"] = {
                    "started_at": event.get("timestamp", 0),
                    "x": data.get("x"),
                    "y": data.get("y"),
                    "scroll_y": data.get("scroll_y", 0),
                    "element": data.get("element"),
                    "viewport_texts": data.get("viewport_texts", []),
                }

            elif event.get("type") == "reading_end":
                data = event.get("data", {})
                if session.get("last_reading"):
                    session["last_reading"]["duration_ms"] = data.get("duration_ms", 0)
                    session["last_reading"]["ended_at"] = event.get("timestamp", 0)
                    session.setdefault("reading_sessions", []).append(session["last_reading"])
                    session["last_reading"] = None

            elif event.get("type") == "element_map":
                map_data = event.get("data", {})
                if map_data and isinstance(map_data, dict) and map_data.get("elements"):
                    self._set_element_map(token, map_data)
                    print(f"[+] Element map stored for {token[:8]}: {len(map_data['elements'])} elements, categories: {map_data.get('categories', {})}")
                    session["has_element_map"] = True
                elif isinstance(map_data, list) and len(map_data) > 0:
                    self._set_element_map(token, {"elements": map_data, "total": len(map_data), "categories": {}, "url": None, "title": None, "viewport": None, "page": None})
                    print(f"[+] Element map stored for {token[:8]}: {len(map_data)} elements (array format)")
                    session["has_element_map"] = True

        windows[:] = windows[-config.MAX_WINDOWS_PER_SESSION:]
        formatted_lines[:] = formatted_lines[-config.MAX_WINDOWS_PER_SESSION:]

        session_features = extract_session_features(session["events"])

        result = {
            "type": "behavior_pipeline",
            "token": token,
            "timestamp": session["last_seen"],
            "windows": windows,
            "formatted_lines": formatted_lines,
            "sales_intent": sales_intent.to_dict(),
            "session_features": session_features,
        }

        element_map = self._get_element_map(token)
        if element_map:
            result["element_map_summary"] = {
                "total": element_map["total"],
                "categories": element_map["categories"],
                "url": element_map["url"],
            }

        return result

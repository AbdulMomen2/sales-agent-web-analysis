import json


def format_window_line(window_entry):
    ts = window_entry.get("timestamp", 0)
    x = window_entry.get("x")
    y = window_entry.get("y")
    scroll_y = window_entry.get("scroll_y", 0)
    num_events = window_entry.get("num_events", 0)
    avg_speed = window_entry.get("avg_speed", 0)
    max_hover = window_entry.get("max_hover_duration_ms", 0)
    clicks = window_entry.get("clicks", [])
    hesitation = window_entry.get("hesitation", False)
    reading = window_entry.get("reading")
    actions = window_entry.get("actions", [])
    element = window_entry.get("element") or {}
    hovered = window_entry.get("hovered_elements", [])
    input_type = window_entry.get("input_type", "?")

    el_cat = element.get("category") or element.get("type") or "unknown"
    el_text = element.get("text") or ""
    parent_chain = element.get("parent_chain", [])

    role = el_cat
    if el_text and len(el_text) > 3:
        role = el_text[:60]

    path_parts = []
    for p in parent_chain[:4]:
        tag = p.get("tag", "?")
        cat = p.get("category", "")
        cls = p.get("classes", "")
        if cat and cat != "container":
            path_parts.append(f"{tag}.{cat}")
        elif cls:
            path_parts.append(f"{tag}.{cls.split()[0]}")
        else:
            path_parts.append(tag)
    path_str = " > ".join(path_parts) if path_parts else "—"

    click_count = len(clicks)
    hes_str = "yes" if hesitation else "no"

    ts_rounded = (ts // 500) * 500

    return f"TS:{ts_rounded} | pos({x},{y}) | scr:{scroll_y} | ev:{num_events} | spd:{avg_speed}px/s | hov:{max_hover}ms | el:{role} | path:{path_str} | cls:{click_count} | hes:{hes_str} | input:{input_type}"


def is_low_activity(window_entry):
    num_events = window_entry.get("num_events", 0)
    avg_speed = window_entry.get("avg_speed", 0)
    max_hover = window_entry.get("max_hover_duration_ms", 0)
    clicks = window_entry.get("clicks", [])
    hesitation = window_entry.get("hesitation", False)
    reading = window_entry.get("reading")
    if num_events <= 1 and avg_speed == 0 and max_hover == 0 and not clicks and not hesitation and not reading:
        return True
    return False


def enrich_from_map(window_entry, element_map):
    if not element_map or not element_map.get("elements"):
        return window_entry

    x = window_entry.get("x")
    y = window_entry.get("y")
    scroll_y = window_entry.get("scroll_y", 0)
    if x is None or y is None:
        return window_entry

    doc_y = y + scroll_y
    best = None
    best_area = float("inf")

    for el in element_map["elements"]:
        r = el.get("rect", {})
        rx, ry, rw, rh = r.get("x"), r.get("y"), r.get("w"), r.get("h")
        if rx is None or ry is None or not rw or not rh:
            continue
        if x >= rx and x <= rx + rw and doc_y >= ry and doc_y <= ry + rh:
            area = rw * rh
            if area < best_area:
                best_area = area
                best = el

    if best:
        entry = dict(window_entry)
        map_info = {
            "map_category": best.get("category"),
            "map_text": best.get("text"),
            "map_price": best.get("price"),
            "map_selector": best.get("selector"),
            "map_section": best.get("section"),
        }
        if "map_enrich" not in entry:
            entry["map_enrich"] = map_info
        else:
            entry["map_enrich"].update(map_info)

        current_el = entry.get("element") or {}
        if current_el and (not current_el.get("text") or not current_el.get("type") or current_el.get("type") == "unknown"):
            new_el = dict(current_el)
            if not new_el.get("text") and best.get("text"):
                new_el["text"] = best["text"][:80]
            if (not new_el.get("type") or new_el.get("type") == "unknown") and best.get("category"):
                new_el["type"] = best["category"]
            if not new_el.get("price") and best.get("price"):
                new_el["price"] = best["price"]
            if best.get("section"):
                new_el["section"] = best["section"]
            entry["element"] = new_el

        return entry

    return window_entry


def parse_raw_lines(raw_message):
    raw_message = (raw_message or "").strip()
    if not raw_message:
        return []
    events = []
    for line in raw_message.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, list):
            events.extend(payload)
        else:
            events.append(payload)
    return events


def normalize_timestamps(events):
    normalized = []
    for event in events:
        safe_event = dict(event)
        data = safe_event.get("data") or {}
        timestamp = safe_event.get("timestamp")
        if timestamp is None:
            timestamp = data.get("ts") or data.get("timestamp_ms") or data.get("time_ms") or 0
        try:
            safe_event["timestamp"] = int(timestamp)
        except (TypeError, ValueError):
            safe_event["timestamp"] = 0
        normalized.append(safe_event)
    return normalized


def extract_session_features(events):
    from collections import Counter
    event_types = Counter(event.get("type") for event in events if event.get("type"))
    elements = set()
    speeds = []
    hover_durations = []
    max_scroll = 0

    for event in events:
        data = event.get("data") or {}
        element = data.get("element") or {}
        eid = element.get("element_id")
        if eid:
            elements.add(str(eid))

        speed = data.get("avg_speed_px_sec") or data.get("speed_px_sec") or data.get("average_speed_px_sec") or 0
        try:
            speeds.append(float(speed))
        except (TypeError, ValueError):
            pass

        hover_duration = data.get("max_hover_duration_ms") or data.get("duration_ms") or 0
        try:
            hover_durations.append(int(hover_duration))
        except (TypeError, ValueError):
            pass

        scroll_y = data.get("scroll_y") or 0
        try:
            max_scroll = max(max_scroll, float(scroll_y))
        except (TypeError, ValueError):
            pass

    return {
        "total_events": len(events),
        "unique_event_types": len(event_types),
        "unique_elements": len(elements),
        "avg_speed_px_sec": round(sum(speeds) / max(1, len(speeds)), 1),
        "max_hover_duration_ms": max(hover_durations, default=0),
        "max_scroll_y": round(max_scroll, 1),
    }

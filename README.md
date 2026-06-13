# Friend — Sales Intelligence Pipeline

Real-time visitor behavior tracking with sales intent scoring. Works on **any website** without hardcoded selectors.

## Project Structure

```
friend/
├── src/                    # Python backend
│   ├── app.py              # FastAPI entry point
│   ├── config.py           # Settings
│   ├── api/
│   │   ├── ws.py           # WebSocket endpoints + ConnectionManager
│   │   └── rest.py         # REST endpoints (health, export)
│   ├── core/
│   │   ├── classifier.py   # 64-category universal classification
│   │   └── sales_intent.py # SalesIntentSummary (6-metric scoring)
│   ├── pipeline/
│   │   ├── aggregator.py   # BehaviorAggregator (session mgmt + pipeline)
│   │   └── enrichment.py   # Element map enrichment + parsing
│   └── models/
│       └── events.py       # Pydantic data models
│
├── client/                 # Browser tracking scripts
│   ├── src/                # Source (IIFE modules)
│   │   ├── element-map.js  # DOM scanner + 64-category system + spatial index
│   │   └── tracking.js     # Event capture, buffer, WebSocket client
│   └── dist/               # Served to browsers
│
├── dashboard/              # Live sales intelligence dashboard
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
│
├── examples/               # Test/demo pages
│   └── nike.html
│
├── legacy/                 # Original prototype files
├── scripts/                # Dev tooling
├── pyproject.toml
└── requirements.txt
```

## Quick Start

```bash
# Start the server
uvicorn src.app:app --reload --host 0.0.0.0 --port 8000

# Open dashboard
open http://localhost:8000/dashboard/

# Load test page
open http://localhost:8000/examples/nike.html
```

## Architecture

- **Client**: element-map.js pre-scans the DOM (64 categories, 50px spatial grid), tracking.js captures mouse/touch/click/reading/scroll into 500ms buffered windows
- **Server**: BehaviorAggregator stores sessions, enriches windows from element map, feeds SalesIntentSummary for scoring
- **Dashboard**: WebSocket connection to server shows live per-window data with intent metrics

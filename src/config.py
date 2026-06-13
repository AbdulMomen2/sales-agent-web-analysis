import os


HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
RELOAD = os.getenv("RELOAD", "true").lower() == "true"

MAX_WINDOWS_PER_SESSION = 30
MAX_EVENTS_PER_SESSION = 10_000

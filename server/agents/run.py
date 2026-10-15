"""Start the agent backend: python -m agents.run  (from server/).

HTTPS: set CLAYMIND_TLS_CERT and CLAYMIND_TLS_KEY (PEM files) and it serves https://.
"""

import os

import uvicorn

from .app import create_app
from .config import load_settings

if __name__ == "__main__":
    settings = load_settings()
    cert, key = os.environ.get("CLAYMIND_TLS_CERT"), os.environ.get("CLAYMIND_TLS_KEY")
    uvicorn.run(create_app(settings), host=os.environ.get("CLAYMIND_AGENTS_HOST", "127.0.0.1"), port=settings.port, ssl_certfile=cert, ssl_keyfile=key, log_level="info")

"""whatsapp-agent-cli — run a coding CLI behind a WhatsApp number."""

from importlib.metadata import version, PackageNotFoundError

try:
    __version__ = version("whatsapp-agent-cli")
except PackageNotFoundError:
    __version__ = "0.0.0"

from .cli import main

__all__ = ["__version__", "main"]

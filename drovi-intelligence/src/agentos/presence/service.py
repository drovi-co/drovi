from __future__ import annotations

from .base import AgentPresenceBase
from .identity_service import AgentPresenceIdentityMixin
from .inbox_service import AgentPresenceInboxMixin
from .outbound_service import AgentPresenceOutboundMixin


class AgentPresenceService(
    AgentPresenceOutboundMixin,
    AgentPresenceInboxMixin,
    AgentPresenceIdentityMixin,
    AgentPresenceBase,
):
    """Facade service that composes identity, inbox, and outbound channel logic."""

    pass

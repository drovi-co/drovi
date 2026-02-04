"""Sensor schemas for reality instrumentation."""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class SensorCategory(str, Enum):
    COMMUNICATION = "communication"
    DOCUMENTS = "documents"
    MEETINGS = "meetings"
    CRM = "crm"
    ENGINEERING = "engineering"
    CALENDAR = "calendar"
    DESKTOP = "desktop"
    SYSTEM = "system"


class SensorStatus(str, Enum):
    EXPERIMENTAL = "experimental"
    BETA = "beta"
    STABLE = "stable"


class PermissionScope(str, Enum):
    READ_CONTENT = "read_content"
    READ_METADATA = "read_metadata"
    SCREEN_CAPTURE = "screen_capture"
    ACCESSIBILITY = "accessibility"
    OCR = "ocr"
    CALENDAR = "calendar"
    CONTACTS = "contacts"


class SensorCapability(BaseModel):
    name: str
    description: str
    scopes: list[PermissionScope] = Field(default_factory=list)


class SensorDefinition(BaseModel):
    id: str
    name: str
    category: SensorCategory
    description: str
    status: SensorStatus = SensorStatus.EXPERIMENTAL
    capabilities: list[SensorCapability] = Field(default_factory=list)
    requires_local_agent: bool = False
    requires_user_consent: bool = True
    data_types: list[str] = Field(default_factory=list)
    contexts: list[str] = Field(default_factory=list)
    origin: Literal["cloud", "desktop", "connector"] = "connector"

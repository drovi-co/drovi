"""Actuation package initialization."""

from __future__ import annotations

from src.actuation.registry import register_driver
from src.actuation.drivers.email import EmailDriver
from src.actuation.drivers.docs import DocsDriver
from src.actuation.drivers.calendar import CalendarDriver
from src.actuation.drivers.slack import SlackDriver
from src.actuation.drivers.crm import CRMDriver
from src.actuation.drivers.repo import RepoDriver


def load_builtin_drivers() -> None:
    register_driver(EmailDriver())
    register_driver(DocsDriver())
    register_driver(CalendarDriver())
    register_driver(SlackDriver())
    register_driver(CRMDriver())
    register_driver(RepoDriver())


__all__ = ["load_builtin_drivers"]

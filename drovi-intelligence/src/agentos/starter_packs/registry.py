from __future__ import annotations

from collections.abc import Iterable

from .hr import HR_TEMPLATES
from .models import StarterPackTemplateSpec, TemplateGroup
from .professional_services import PROFESSIONAL_SERVICES_TEMPLATES
from .sales import SALES_TEMPLATES


ALL_STARTER_PACKS: tuple[StarterPackTemplateSpec, ...] = tuple(
    SALES_TEMPLATES + HR_TEMPLATES + PROFESSIONAL_SERVICES_TEMPLATES
)
_STARTER_PACK_BY_KEY: dict[TemplateGroup, StarterPackTemplateSpec] = {
    template.key: template for template in ALL_STARTER_PACKS
}


def list_starter_packs() -> list[StarterPackTemplateSpec]:
    return list(ALL_STARTER_PACKS)


def get_starter_pack(template_key: TemplateGroup) -> StarterPackTemplateSpec:
    template = _STARTER_PACK_BY_KEY.get(template_key)
    if template is None:
        raise KeyError(f"Unknown starter pack template: {template_key}")
    return template


def filter_starter_packs(template_keys: Iterable[TemplateGroup] | None) -> list[StarterPackTemplateSpec]:
    if template_keys is None:
        return list_starter_packs()
    return [get_starter_pack(key) for key in template_keys]

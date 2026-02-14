from __future__ import annotations

from fastapi import APIRouter

from .agents_browser import router as browser_router
from .agents_control_plane import router as control_plane_router
from .agents_desktop import router as desktop_router
from .agents_governance import router as governance_router
from .agents_quality_optimization import router as quality_optimization_router
from .agents_presence import router as presence_router
from .agents_playbooks_deployments import router as playbooks_deployments_router
from .agents_roles_profiles import router as roles_profiles_router
from .agents_runs_quality import router as runs_quality_router
from .agents_starter_packs import router as starter_packs_router
from .agents_teams import router as teams_router
from .agents_tools_policy import router as tools_policy_router
from .agents_work_products import router as work_products_router

router = APIRouter(prefix="/agents", tags=["Agents"])
router.include_router(roles_profiles_router)
router.include_router(playbooks_deployments_router)
router.include_router(runs_quality_router)
router.include_router(teams_router)
router.include_router(control_plane_router)
router.include_router(tools_policy_router)
router.include_router(governance_router)
router.include_router(presence_router)
router.include_router(browser_router)
router.include_router(desktop_router)
router.include_router(work_products_router)
router.include_router(starter_packs_router)
router.include_router(quality_optimization_router)

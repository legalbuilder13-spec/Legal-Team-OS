import logging
from datetime import datetime, timezone

import httpx

from ..config import settings
from ..schemas import ContextCard

logger = logging.getLogger(__name__)

_access_token: str | None = None


async def _get_access_token() -> str | None:
    global _access_token
    if _access_token:
        return _access_token
    if not all(
        [
            settings.salesforce_instance_url,
            settings.salesforce_client_id,
            settings.salesforce_client_secret,
            settings.salesforce_username,
            settings.salesforce_password,
        ]
    ):
        return None

    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.post(
            f"{settings.salesforce_instance_url}/services/oauth2/token",
            data={
                "grant_type": "password",
                "client_id": settings.salesforce_client_id,
                "client_secret": settings.salesforce_client_secret,
                "username": settings.salesforce_username,
                "password": settings.salesforce_password,
            },
        )
    if resp.status_code != 200:
        logger.error("salesforce auth failed: %s", resp.text)
        return None
    _access_token = resp.json()["access_token"]
    return _access_token


async def lookup_counterparty(name: str | None, domain: str | None) -> ContextCard | None:
    if not name and not domain:
        return None

    token = await _get_access_token()
    if not token or not settings.salesforce_instance_url:
        logger.info("Salesforce not configured, returning empty context")
        return ContextCard(
            source="salesforce",
            fetched_at=datetime.now(timezone.utc).isoformat(),
            data={"configured": False, "name": name, "domain": domain},
        )

    where = []
    if name:
        escaped = name.replace("'", "\\'")
        where.append(f"Name LIKE '%{escaped}%'")
    if domain:
        escaped = domain.replace("'", "\\'")
        where.append(f"Website LIKE '%{escaped}%'")
    soql = (
        "SELECT Id, Name, Website, Owner.Name, Industry, AnnualRevenue "
        f"FROM Account WHERE {' OR '.join(where)} LIMIT 5"
    )

    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.get(
            f"{settings.salesforce_instance_url}/services/data/v60.0/query",
            params={"q": soql},
            headers={"Authorization": f"Bearer {token}"},
        )

    if resp.status_code != 200:
        logger.error("salesforce query failed: %s", resp.text)
        return None

    body = resp.json()
    return ContextCard(
        source="salesforce",
        fetched_at=datetime.now(timezone.utc).isoformat(),
        data={"records": body.get("records", []), "name": name, "domain": domain},
    )

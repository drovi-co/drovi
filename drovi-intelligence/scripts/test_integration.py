#!/usr/bin/env python
"""
Integration test script for Drovi Intelligence API.

Run this script to test the API endpoints after starting the server.
"""

import asyncio
import httpx
import json
import sys


BASE_URL = "http://localhost:8000"


async def test_health():
    """Test health endpoints."""
    async with httpx.AsyncClient() as client:
        # Health check
        response = await client.get(f"{BASE_URL}/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print("✓ Health check passed")

        # Ready check
        response = await client.get(f"{BASE_URL}/ready")
        assert response.status_code == 200
        print("✓ Ready check passed")

        # Live check
        response = await client.get(f"{BASE_URL}/live")
        assert response.status_code == 200
        print("✓ Live check passed")


async def test_analyze():
    """Test analyze endpoint."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        request_data = {
            "content": """
            Hi John,

            I wanted to follow up on our meeting yesterday. As discussed, I'll send you
            the Q4 report by Friday. Can you please review the budget proposal and get
            back to me by next Wednesday?

            Also, we've decided to move forward with the new vendor for the cloud
            migration project. Please coordinate with Sarah on the implementation timeline.

            Thanks,
            Alice
            """,
            "organization_id": "test_org_123",
            "source_type": "email",
            "user_email": "alice@example.com",
            "user_name": "Alice",
        }

        response = await client.post(
            f"{BASE_URL}/analyze",
            json=request_data,
        )

        if response.status_code == 200:
            data = response.json()
            print("✓ Analyze endpoint passed")
            print(f"  - Analysis ID: {data.get('analysis_id')}")
            print(f"  - Has intelligence: {data.get('classification', {}).get('has_intelligence')}")
            print(f"  - Commitments found: {len(data.get('extracted', {}).get('commitments', []))}")
            print(f"  - Decisions found: {len(data.get('extracted', {}).get('decisions', []))}")
        else:
            print(f"✗ Analyze endpoint failed: {response.status_code}")
            print(f"  Response: {response.text}")


async def test_search():
    """Test search endpoint."""
    async with httpx.AsyncClient() as client:
        request_data = {
            "query": "Q4 report",
            "organization_id": "test_org_123",
            "limit": 10,
        }

        response = await client.post(
            f"{BASE_URL}/search",
            json=request_data,
        )

        if response.status_code == 200:
            data = response.json()
            print("✓ Search endpoint passed")
            print(f"  - Results found: {data.get('count', 0)}")
        else:
            print(f"✗ Search endpoint failed: {response.status_code}")


async def test_memory():
    """Test memory search endpoint."""
    async with httpx.AsyncClient() as client:
        request_data = {
            "query": "meeting",
            "organization_id": "test_org_123",
            "limit": 50,
        }

        response = await client.post(
            f"{BASE_URL}/memory/search",
            json=request_data,
        )

        if response.status_code == 200:
            data = response.json()
            print("✓ Memory search endpoint passed")
            print(f"  - Results found: {data.get('count', 0)}")
        else:
            print(f"✗ Memory search endpoint failed: {response.status_code}")


async def main():
    """Run all integration tests."""
    print("\n" + "=" * 50)
    print("Drovi Intelligence Integration Tests")
    print("=" * 50 + "\n")

    try:
        await test_health()
        print()
        await test_analyze()
        print()
        await test_search()
        print()
        await test_memory()
        print()

        print("=" * 50)
        print("All integration tests passed!")
        print("=" * 50)

    except httpx.ConnectError:
        print("✗ Cannot connect to the server.")
        print("  Make sure the server is running at", BASE_URL)
        sys.exit(1)
    except AssertionError as e:
        print(f"✗ Test assertion failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"✗ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
